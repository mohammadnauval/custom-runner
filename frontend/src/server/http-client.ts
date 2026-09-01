import type { FlattenedRequest } from './types/postman';

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  timeMs: number;
}

/** Per-request timeout. Must stay well under the function's maxDuration. */
export const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 20_000);

/** Response bodies are truncated before being stored to keep rows small. */
export const MAX_STORED_BODY_BYTES = Number(process.env.MAX_STORED_BODY_BYTES ?? 200_000);

// Private IP ranges blocked to limit SSRF against internal infrastructure.
const PRIVATE_IP_PATTERNS = [
  /^127\./, // 127.0.0.0/8 (localhost)
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // 169.254.0.0/16 (link-local, cloud metadata)
  /^0\./, // 0.0.0.0/8
  /^::1$/, // IPv6 localhost
  /^\[?::1\]?$/,
  /^fc00:/i, // IPv6 unique local
  /^fe80:/i, // IPv6 link-local
];

const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  'metadata.goog',
  '169.254.169.254',
];

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/**
 * Reject URLs pointing at localhost, private ranges or cloud metadata
 * endpoints. Note this validates the hostname only; a hostname that resolves
 * to a private address via DNS is not caught here.
 */
function isBlockedTarget(url: string): boolean {
  try {
    const parsed = new URL(url);

    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
      return true;
    }

    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (BLOCKED_HOSTS.includes(host)) {
      return true;
    }

    return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(host));
  } catch {
    return true; // Invalid URL
  }
}

/**
 * Truncate a response body to a byte budget, flagging that it was cut.
 */
function truncateBody(body: string): string {
  if (body.length <= MAX_STORED_BODY_BYTES) {
    return body;
  }
  return `${body.slice(0, MAX_STORED_BODY_BYTES)}\n\n…[truncated, original length ${body.length} chars]`;
}

/**
 * Execute a single HTTP request.
 */
export async function executeRequest(request: FlattenedRequest): Promise<HttpResponse> {
  const startTime = Date.now();

  // Append query params
  let url = request.url;
  if (Object.keys(request.queryParams).length > 0) {
    const params = new URLSearchParams(request.queryParams);
    url = url.includes('?') ? `${url}&${params}` : `${url}?${params}`;
  }

  if (isBlockedTarget(url)) {
    throw new Error(
      'Blocked target: only public http(s) URLs are allowed (localhost, private ranges and metadata endpoints are denied)'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const headers: Record<string, string> = { ...request.headers };
  const options: RequestInit = {
    method: request.method,
    headers,
    signal: controller.signal,
    redirect: 'follow',
    cache: 'no-store',
  };

  if (request.body && !['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    const { body, contentType } = buildRequestBody(request);
    options.body = body;

    if (contentType && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = contentType;
    }
  }

  try {
    const response = await fetch(url, options);
    clearTimeout(timeout);

    let body: string;
    try {
      body = await response.text();
    } catch {
      body = '';
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      status: response.status,
      headers: responseHeaders,
      body: truncateBody(body),
      timeMs: Date.now() - startTime,
    };
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout (${REQUEST_TIMEOUT_MS}ms exceeded)`);
    }
    throw new Error(
      `Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Build the request body payload and its default content type.
 */
function buildRequestBody(request: FlattenedRequest): {
  body: string | FormData;
  contentType?: string;
} {
  if (!request.body) {
    return { body: '' };
  }

  switch (request.body.mode) {
    case 'raw':
      return {
        body: request.body.content as string,
        contentType: detectRawContentType(request.body.content as string, request.headers),
      };

    case 'urlencoded': {
      const params = new URLSearchParams(request.body.content as Record<string, string>);
      return { body: params.toString(), contentType: 'application/x-www-form-urlencoded' };
    }

    case 'formdata': {
      const formData = new FormData();
      const content = request.body.content as Record<string, string>;
      for (const [key, value] of Object.entries(content)) {
        formData.append(key, value);
      }
      // fetch sets the multipart boundary itself
      return { body: formData };
    }

    case 'graphql':
      return { body: request.body.content as string, contentType: 'application/json' };

    default:
      return { body: '' };
  }
}

/**
 * Guess a content type for a raw body when none was supplied.
 */
function detectRawContentType(content: string, headers: Record<string, string>): string {
  const existing = Object.entries(headers).find(
    ([k]) => k.toLowerCase() === 'content-type'
  )?.[1];

  if (existing) {
    return existing;
  }

  const trimmed = content.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'application/json';
    } catch {
      // fall through
    }
  }

  if (trimmed.startsWith('<')) {
    const lower = trimmed.toLowerCase();
    if (lower.includes('<!doctype html') || lower.includes('<html')) {
      return 'text/html';
    }
    return 'application/xml';
  }

  return 'text/plain';
}
