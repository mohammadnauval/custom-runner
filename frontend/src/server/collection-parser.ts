import type {
  PostmanCollection,
  PostmanItem,
  PostmanRequest,
  PostmanUrl,
  FlattenedRequest,
} from './types/postman';

// Regex to find {{variableName}} patterns
const VARIABLE_PATTERN = /\{\{([^}]+)\}\}/g;

/**
 * Parse a Postman Collection JSON and extract information
 */
export function parseCollection(json: string): {
  name: string;
  requests: FlattenedRequest[];
  variableNames: string[];
} {
  const collection: PostmanCollection = JSON.parse(json);

  if (!collection.info || !collection.item) {
    throw new Error('Invalid Postman Collection format');
  }

  const requests = flattenRequests(collection.item);
  const variableNames = extractVariableNames(collection);

  return {
    name: collection.info.name,
    requests,
    variableNames: [...new Set(variableNames)],
  };
}

/**
 * Flatten nested items (folders) into a flat list of requests
 */
function flattenRequests(items: PostmanItem[], parentPath = ''): FlattenedRequest[] {
  const requests: FlattenedRequest[] = [];

  for (const item of items) {
    const currentPath = parentPath ? `${parentPath}/${item.name}` : item.name;

    if (item.request) {
      requests.push(convertRequest(item.name, item.request, item.event));
    }

    if (item.item && item.item.length > 0) {
      requests.push(...flattenRequests(item.item, currentPath));
    }
  }

  return requests;
}

/**
 * Convert a Postman request to our flattened format
 */
function convertRequest(
  name: string,
  request: PostmanRequest,
  events?: PostmanItem['event']
): FlattenedRequest {
  const url = resolveUrl(request.url);

  const headers: Record<string, string> = {};
  if (request.header) {
    for (const h of request.header) {
      if (!h.disabled) {
        headers[h.key] = h.value;
      }
    }
  }

  const queryParams: Record<string, string> = {};
  // Only collect query params when the URL was built from parts. When `raw`
  // already contains the query string, re-appending would duplicate params.
  if (typeof request.url === 'object' && request.url.query && !request.url.raw?.includes('?')) {
    for (const q of request.url.query) {
      if (!q.disabled) {
        queryParams[q.key] = q.value;
      }
    }
  }

  let body: FlattenedRequest['body'];
  if (request.body) {
    body = convertBody(request.body);
  }

  let preRequestScript: string[] | undefined;
  let testScript: string[] | undefined;

  if (events) {
    for (const event of events) {
      if (event.listen === 'prerequest' && event.script.exec) {
        preRequestScript = event.script.exec;
      }
      if (event.listen === 'test' && event.script.exec) {
        testScript = event.script.exec;
      }
    }
  }

  return {
    name,
    method: request.method,
    url,
    headers,
    queryParams,
    body,
    preRequestScript,
    testScript,
  };
}

/**
 * Resolve URL from Postman format to string
 */
function resolveUrl(url: PostmanUrl | string): string {
  if (typeof url === 'string') {
    return url;
  }

  if (url.raw) {
    return url.raw;
  }

  let result = '';

  if (url.protocol) {
    result += url.protocol + '://';
  }

  if (url.host) {
    result += url.host.join('.');
  }

  if (url.path) {
    result += '/' + url.path.join('/');
  }

  return result;
}

/**
 * Convert Postman body to our format
 */
function convertBody(body: NonNullable<PostmanRequest['body']>): FlattenedRequest['body'] {
  switch (body.mode) {
    case 'raw':
      return {
        mode: 'raw',
        content: body.raw || '',
      };

    case 'urlencoded': {
      const urlencoded: Record<string, string> = {};
      if (body.urlencoded) {
        for (const param of body.urlencoded) {
          if (!param.disabled) {
            urlencoded[param.key] = param.value;
          }
        }
      }
      return { mode: 'urlencoded', content: urlencoded };
    }

    case 'formdata': {
      const formdata: Record<string, string> = {};
      if (body.formdata) {
        for (const param of body.formdata) {
          if (!param.disabled && param.type !== 'file') {
            formdata[param.key] = param.value || '';
          }
        }
      }
      return { mode: 'formdata', content: formdata };
    }

    case 'graphql':
      return {
        mode: 'graphql',
        content: JSON.stringify({
          query: body.graphql?.query || '',
          variables: body.graphql?.variables || '',
        }),
      };

    default:
      return { mode: body.mode, content: '' };
  }
}

/**
 * Extract all variable names ({{varName}}) from the collection
 */
function extractVariableNames(collection: PostmanCollection): string[] {
  const variables: string[] = [];

  if (collection.variable) {
    for (const v of collection.variable) {
      variables.push(v.key);
    }
  }

  // Scan the whole collection body for {{var}} occurrences
  const searchText = JSON.stringify(collection);
  const pattern = new RegExp(VARIABLE_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(searchText)) !== null) {
    variables.push(match[1].trim());
  }

  return variables;
}

/**
 * Substitute {{variable}} placeholders in a string.
 * Unknown variables are left untouched so failures are visible in results.
 */
export function substituteVariables(text: string, variables: Record<string, string>): string {
  return text.replace(new RegExp(VARIABLE_PATTERN.source, 'g'), (match, varName: string) => {
    const value = variables[varName.trim()];
    return value ?? match;
  });
}

/**
 * Substitute variables across every part of a request:
 * name, URL, header keys/values, query params and body.
 */
export function substituteRequestVariables(
  request: FlattenedRequest,
  variables: Record<string, string>
): FlattenedRequest {
  const substituted: FlattenedRequest = {
    name: substituteVariables(request.name, variables),
    method: request.method,
    url: substituteVariables(request.url, variables),
    headers: {},
    queryParams: {},
    testScript: request.testScript,
    preRequestScript: request.preRequestScript,
  };

  for (const [key, value] of Object.entries(request.headers)) {
    substituted.headers[substituteVariables(key, variables)] = substituteVariables(value, variables);
  }

  for (const [key, value] of Object.entries(request.queryParams)) {
    substituted.queryParams[substituteVariables(key, variables)] = substituteVariables(
      value,
      variables
    );
  }

  if (request.body) {
    if (typeof request.body.content === 'string') {
      substituted.body = {
        mode: request.body.mode,
        content: substituteVariables(request.body.content, variables),
      };
    } else {
      const content: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.body.content)) {
        content[substituteVariables(key, variables)] = substituteVariables(value, variables);
      }
      substituted.body = { mode: request.body.mode, content };
    }
  }

  return substituted;
}
