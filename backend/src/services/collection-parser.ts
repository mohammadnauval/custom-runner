import type { PostmanCollection, PostmanItem, PostmanRequest, PostmanUrl, FlattenedRequest } from '../types/postman.js';

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
    variableNames: [...new Set(variableNames)], // Unique names
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
      // This is a request
      requests.push(convertRequest(item.name, item.request, item.event));
    }
    
    if (item.item && item.item.length > 0) {
      // This is a folder, recurse
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
  if (typeof request.url === 'object' && request.url.query) {
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
  
  // Build URL from parts
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
    
    case 'urlencoded':
      const urlencoded: Record<string, string> = {};
      if (body.urlencoded) {
        for (const param of body.urlencoded) {
          if (!param.disabled) {
            urlencoded[param.key] = param.value;
          }
        }
      }
      return {
        mode: 'urlencoded',
        content: urlencoded,
      };
    
    case 'formdata':
      const formdata: Record<string, string> = {};
      if (body.formdata) {
        for (const param of body.formdata) {
          if (!param.disabled && param.type !== 'file') {
            formdata[param.key] = param.value || '';
          }
        }
      }
      return {
        mode: 'formdata',
        content: formdata,
      };
    
    case 'graphql':
      return {
        mode: 'graphql',
        content: JSON.stringify({
          query: body.graphql?.query || '',
          variables: body.graphql?.variables || '',
        }),
      };
    
    default:
      return {
        mode: body.mode,
        content: '',
      };
  }
}

/**
 * Extract all variable names ({{varName}}) from the collection
 */
function extractVariableNames(collection: PostmanCollection): string[] {
  const variables: string[] = [];
  
  // Extract from collection variables
  if (collection.variable) {
    for (const v of collection.variable) {
      variables.push(v.key);
    }
  }
  
  // Extract from all requests
  const searchText = JSON.stringify(collection);
  let match;
  while ((match = VARIABLE_PATTERN.exec(searchText)) !== null) {
    variables.push(match[1]);
  }
  
  return variables;
}

/**
 * Substitute variables in a string with values from a map
 */
export function substituteVariables(
  text: string,
  variables: Record<string, string>
): string {
  return text.replace(VARIABLE_PATTERN, (match, varName) => {
    return variables[varName] ?? match;
  });
}

/**
 * Substitute variables in request
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
  };
  
  // Substitute headers
  for (const [key, value] of Object.entries(request.headers)) {
    substituted.headers[substituteVariables(key, variables)] = substituteVariables(value, variables);
  }
  
  // Substitute query params
  for (const [key, value] of Object.entries(request.queryParams)) {
    substituted.queryParams[substituteVariables(key, variables)] = substituteVariables(value, variables);
  }
  
  // Substitute body
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
      substituted.body = {
        mode: request.body.mode,
        content,
      };
    }
  }
  
  return substituted;
}
