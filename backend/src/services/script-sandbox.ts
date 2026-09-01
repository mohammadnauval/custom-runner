import vm from 'node:vm';

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export interface ScriptContext {
  responseStatus: number;
  responseBody: string;
  responseHeaders: Record<string, string>;
  responseTime: number;
}

/**
 * Execute Postman test scripts in a sandboxed environment
 * Supports a basic subset of the Postman pm.* API
 */
export function executeTestScript(
  scriptLines: string[],
  context: ScriptContext
): TestResult[] {
  const results: TestResult[] = [];
  
  // Parse response body as JSON if possible
  let jsonBody: unknown;
  try {
    jsonBody = JSON.parse(context.responseBody);
  } catch {
    jsonBody = null;
  }

  // Create a mock pm object
  const pm = {
    response: {
      code: context.responseStatus,
      status: getStatusText(context.responseStatus),
      text: () => context.responseBody,
      json: () => jsonBody,
      headers: {
        get: (name: string) => context.responseHeaders[name.toLowerCase()] || null,
      },
      responseTime: context.responseTime,
      to: {
        have: {
          status: (code: number) => {
            const passed = context.responseStatus === code;
            if (!passed) {
              throw new Error(`Expected status ${code} but got ${context.responseStatus}`);
            }
          },
          header: (name: string, value?: string) => {
            const headerValue = context.responseHeaders[name.toLowerCase()];
            if (!headerValue) {
              throw new Error(`Expected header "${name}" to exist`);
            }
            if (value !== undefined && headerValue !== value) {
              throw new Error(`Expected header "${name}" to be "${value}" but got "${headerValue}"`);
            }
          },
          body: (text: string) => {
            if (!context.responseBody.includes(text)) {
              throw new Error(`Expected body to contain "${text}"`);
            }
          },
          jsonBody: (path: string, value?: unknown) => {
            if (!jsonBody) {
              throw new Error('Response is not valid JSON');
            }
            const actual = getJsonPath(jsonBody, path);
            if (actual === undefined) {
              throw new Error(`JSON path "${path}" not found`);
            }
            if (value !== undefined && actual !== value) {
              throw new Error(`Expected ${path} to be ${JSON.stringify(value)} but got ${JSON.stringify(actual)}`);
            }
          },
        },
      },
    },
    test: (name: string, fn: () => void) => {
      try {
        fn();
        results.push({ name, passed: true });
      } catch (error) {
        results.push({
          name,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    expect: (value: unknown) => createExpect(value),
  };

  // Environment/variable storage (in-memory for this execution)
  const variables: Record<string, string> = {};
  const environment = {
    get: (key: string) => variables[key],
    set: (key: string, value: string) => {
      variables[key] = value;
    },
  };

  // Create sandbox context
  const sandbox = {
    pm,
    console: {
      log: (...args: unknown[]) => {
        // Silently ignore console.log in scripts
      },
    },
    // Add some commonly used globals
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    // Expose environment
    environment,
  };

  const script = scriptLines.join('\n');
  
  try {
    const context = vm.createContext(sandbox);
    vm.runInContext(script, context, {
      timeout: 5000, // 5 second timeout
      displayErrors: true,
    });
  } catch (error) {
    // If the script itself throws (outside of pm.test), record it
    if (results.length === 0) {
      results.push({
        name: 'Script Execution',
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * Create an expect-like assertion helper
 */
function createExpect(actual: unknown) {
  return {
    to: {
      equal: (expected: unknown) => {
        if (actual !== expected) {
          throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
        }
      },
      eql: (expected: unknown) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
        }
      },
      be: {
        true: () => {
          if (actual !== true) {
            throw new Error(`Expected true but got ${JSON.stringify(actual)}`);
          }
        },
        false: () => {
          if (actual !== false) {
            throw new Error(`Expected false but got ${JSON.stringify(actual)}`);
          }
        },
        null: () => {
          if (actual !== null) {
            throw new Error(`Expected null but got ${JSON.stringify(actual)}`);
          }
        },
        undefined: () => {
          if (actual !== undefined) {
            throw new Error(`Expected undefined but got ${JSON.stringify(actual)}`);
          }
        },
        a: (type: string) => {
          if (typeof actual !== type) {
            throw new Error(`Expected type ${type} but got ${typeof actual}`);
          }
        },
        an: (type: string) => {
          if (typeof actual !== type) {
            throw new Error(`Expected type ${type} but got ${typeof actual}`);
          }
        },
        above: (value: number) => {
          if (typeof actual !== 'number' || actual <= value) {
            throw new Error(`Expected ${actual} to be above ${value}`);
          }
        },
        below: (value: number) => {
          if (typeof actual !== 'number' || actual >= value) {
            throw new Error(`Expected ${actual} to be below ${value}`);
          }
        },
      },
      have: {
        property: (name: string, value?: unknown) => {
          if (typeof actual !== 'object' || actual === null) {
            throw new Error(`Expected an object but got ${typeof actual}`);
          }
          if (!(name in actual)) {
            throw new Error(`Expected property "${name}" to exist`);
          }
          if (value !== undefined && (actual as Record<string, unknown>)[name] !== value) {
            throw new Error(`Expected property "${name}" to be ${JSON.stringify(value)}`);
          }
        },
        length: (length: number) => {
          if (Array.isArray(actual)) {
            if (actual.length !== length) {
              throw new Error(`Expected array length ${length} but got ${actual.length}`);
            }
          } else if (typeof actual === 'string') {
            if (actual.length !== length) {
              throw new Error(`Expected string length ${length} but got ${actual.length}`);
            }
          } else {
            throw new Error('Expected an array or string');
          }
        },
      },
      include: (value: unknown) => {
        if (Array.isArray(actual)) {
          if (!actual.includes(value)) {
            throw new Error(`Expected array to include ${JSON.stringify(value)}`);
          }
        } else if (typeof actual === 'string') {
          if (!actual.includes(String(value))) {
            throw new Error(`Expected string to include ${JSON.stringify(value)}`);
          }
        } else {
          throw new Error('Expected an array or string');
        }
      },
    },
  };
}

/**
 * Get value at a JSON path (simple dot notation)
 */
function getJsonPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  
  return current;
}

/**
 * Get HTTP status text
 */
function getStatusText(code: number): string {
  const statusTexts: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  };
  return statusTexts[code] || 'Unknown';
}
