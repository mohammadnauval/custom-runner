import type { FlattenedRequest } from '../types/postman.js';

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  timeMs: number;
}

// Private IP ranges to block (SSRF protection)
const PRIVATE_IP_PATTERNS = [
  /^127\./,                         // 127.0.0.0/8 (localhost)
  /^10\./,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,// 172.16.0.0/12
  /^192\.168\./,                    // 192.168.0.0/16
  /^169\.254\./,                    // 169.254.0.0/16 (link-local)
  /^0\./,                           // 0.0.0.0/8
  /^::1$/,                          // IPv6 localhost
  /^fc00:/i,                        // IPv6 unique local
  /^fe80:/i,                        // IPv6 link-local
];

const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  '169.254.169.254',
];

/**
 * Check if a URL is targeting a private/internal IP address
 */
function isPrivateTarget(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    
    // Check blocked hostnames
    if (BLOCKED_HOSTS.includes(host)) {
      return true;
    }
    
    // Check private IP patterns
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(host)) {
        return true;
      }
    }
    
    return false;
  } catch {
    return true; // Invalid URL, block it
  }
}

/**
 * Execute an HTTP request
 */
export async function executeRequest(request: FlattenedRequest): Promise<HttpResponse> {
  const startTime = performance.now();
  
  // Build URL with query params
  let url = request.url;
  if (Object.keys(request.queryParams).length > 0) {
    const params = new URLSearchParams(request.queryParams);
    url = url.includes('?') ? `${url}&${params}` : `${url}?${params}`;
  }
  
  // SSRF protection: block requests to private/internal IPs
  if (isPrivateTarget(url)) {
    throw new Error('Requests to private/internal IP addresses are not allowed');
  }
  
  // Build request options
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout
  
  const options: RequestInit = {
    method: request.method,
    headers: request.headers,
    signal: controller.signal,
  };
  
  // Add body for non-GET requests
  if (request.body && !['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    const { body, contentType } = buildRequestBody(request);
    options.body = body;
    
    // Set content-type if not already set
    if (contentType && !Object.keys(request.headers).some(k => k.toLowerCase() === 'content-type')) {
      (options.headers as Record<string, string>)['Content-Type'] = contentType;
    }
  }
  
  try {
    const response = await fetch(url, options);
    clearTimeout(timeout);
    const endTime = performance.now();
    
    // Get response body
    let body: string;
    try {
      body = await response.text();
    } catch {
      body = '';
    }
    
    // Get response headers
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    
    return {
      status: response.status,
      headers,
      body,
      timeMs: Math.round(endTime - startTime),
    };
  } catch (error) {
    clearTimeout(timeout);
    const endTime = performance.now();
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout (30s exceeded)');
    }
    throw new Error(`Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Build request body based on mode
 */
function buildRequestBody(request: FlattenedRequest): { body: string | FormData; contentType?: string } {
  if (!request.body) {
    return { body: '' };
  }
  
  switch (request.body.mode) {
    case 'raw':
      return {
        body: request.body.content as string,
        contentType: detectRawContentType(request.body.content as string, request.headers),
      };
    
    case 'urlencoded':
      const params = new URLSearchParams(request.body.content as Record<string, string>);
      return {
        body: params.toString(),
        contentType: 'application/x-www-form-urlencoded',
      };
    
    case 'formdata':
      const formData = new FormData();
      const content = request.body.content as Record<string, string>;
      for (const [key, value] of Object.entries(content)) {
        formData.append(key, value);
      }
      return { body: formData as unknown as string }; // FormData handles content-type
    
    case 'graphql':
      return {
        body: request.body.content as string,
        contentType: 'application/json',
      };
    
    default:
      return { body: '' };
  }
}

/**
 * Try to detect content type for raw body
 */
function detectRawContentType(content: string, headers: Record<string, string>): string {
  // Check if already set in headers
  const existingContentType = Object.entries(headers)
    .find(([k]) => k.toLowerCase() === 'content-type')?.[1];
  
  if (existingContentType) {
    return existingContentType;
  }
  
  // Try to detect from content
  const trimmed = content.trim();
  
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'application/json';
    } catch {
      // Not valid JSON
    }
  }
  
  if (trimmed.startsWith('<')) {
    if (trimmed.toLowerCase().includes('<!doctype html') || trimmed.toLowerCase().includes('<html')) {
      return 'text/html';
    }
    return 'application/xml';
  }
  
  return 'text/plain';
}
