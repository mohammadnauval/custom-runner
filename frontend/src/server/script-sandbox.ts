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

const SCRIPT_TIMEOUT_MS = 3_000;

/**
 * Execute Postman test scripts against a response.
 * Supports a useful subset of the Postman `pm.*` API — not the full sandbox.
 */
export function executeTestScript(
  scriptLines: string[],
  ctx: ScriptContext
): TestResult[] {
  const results: TestResult[] = [];

  let jsonBody: unknown;
  try {
    jsonBody = JSON.parse(ctx.responseBody);
  } catch {
    jsonBody = null;
  }

  // Header lookups in Postman are case-insensitive
  const lowerHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(ctx.responseHeaders)) {
    lowerHeaders[key.toLowerCase()] = value;
  }

  const pm = {
    response: {
      code: ctx.responseStatus,
      status: getStatusText(ctx.responseStatus),
      responseTime: ctx.responseTime,
      text: () => ctx.responseBody,
      json: () => {
        if (jsonBody === null) {
          throw new Error('Response body is not valid JSON');
        }
        return jsonBody;
      },
      headers: {
        get: (name: string) => lowerHeaders[name.toLowerCase()] ?? null,
        has: (name: string) => name.toLowerCase() in lowerHeaders,
      },
      to: {
        have: {
          status: (code: number | string) => {
            if (typeof code === 'string') {
              if (getStatusText(ctx.responseStatus) !== code) {
                throw new Error(
                  `Expected status "${code}" but got "${getStatusText(ctx.responseStatus)}"`
                );
              }
              return;
            }
            if (ctx.responseStatus !== code) {
              throw new Error(`Expected status ${code} but got ${ctx.responseStatus}`);
            }
          },
          header: (name: string, value?: string) => {
            const headerValue = lowerHeaders[name.toLowerCase()];
            if (headerValue === undefined) {
              throw new Error(`Expected header "${name}" to exist`);
            }
            if (value !== undefined && headerValue !== value) {
              throw new Error(
                `Expected header "${name}" to be "${value}" but got "${headerValue}"`
              );
            }
          },
          body: (text: string) => {
            if (!ctx.responseBody.includes(text)) {
              throw new Error(`Expected body to contain "${text}"`);
            }
          },
          jsonBody: (path?: string, value?: unknown) => {
            if (jsonBody === null) {
              throw new Error('Response is not valid JSON');
            }
            if (path === undefined) {
              return;
            }
            const actual = getJsonPath(jsonBody, path);
            if (actual === undefined) {
              throw new Error(`JSON path "${path}" not found`);
            }
            if (value !== undefined && actual !== value) {
              throw new Error(
                `Expected ${path} to be ${JSON.stringify(value)} but got ${JSON.stringify(actual)}`
              );
            }
          },
        },
        be: {
          ok: () => {
            if (ctx.responseStatus < 200 || ctx.responseStatus >= 300) {
              throw new Error(`Expected 2xx status but got ${ctx.responseStatus}`);
            }
          },
          success: () => {
            if (ctx.responseStatus < 200 || ctx.responseStatus >= 300) {
              throw new Error(`Expected 2xx status but got ${ctx.responseStatus}`);
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

  // Variables set by scripts live only for this request
  const variables: Record<string, string> = {};
  const variableStore = {
    get: (key: string) => variables[key],
    set: (key: string, value: string) => {
      variables[key] = value;
    },
    unset: (key: string) => {
      delete variables[key];
    },
  };

  const sandbox = {
    pm: { ...pm, environment: variableStore, variables: variableStore, globals: variableStore },
    console: { log: () => undefined, warn: () => undefined, error: () => undefined },
    JSON,
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
  };

  const script = scriptLines.join('\n');

  try {
    const sandboxContext = vm.createContext(sandbox);
    vm.runInContext(script, sandboxContext, {
      timeout: SCRIPT_TIMEOUT_MS,
      displayErrors: true,
    });
  } catch (error) {
    // Errors thrown outside pm.test still count as a failure
    results.push({
      name: 'Script execution',
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return results;
}

/**
 * Minimal chai-style assertion helper.
 */
function createExpect(actual: unknown) {
  const fail = (message: string): never => {
    throw new Error(message);
  };

  return {
    to: {
      equal: (expected: unknown) => {
        if (actual !== expected) {
          fail(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
        }
      },
      eql: (expected: unknown) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          fail(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
        }
      },
      be: {
        true: () => {
          if (actual !== true) fail(`Expected true but got ${JSON.stringify(actual)}`);
        },
        false: () => {
          if (actual !== false) fail(`Expected false but got ${JSON.stringify(actual)}`);
        },
        null: () => {
          if (actual !== null) fail(`Expected null but got ${JSON.stringify(actual)}`);
        },
        undefined: () => {
          if (actual !== undefined) fail(`Expected undefined but got ${JSON.stringify(actual)}`);
        },
        empty: () => {
          const isEmpty =
            actual === '' ||
            (Array.isArray(actual) && actual.length === 0) ||
            (typeof actual === 'object' && actual !== null && Object.keys(actual).length === 0);
          if (!isEmpty) fail(`Expected empty but got ${JSON.stringify(actual)}`);
        },
        a: (type: string) => {
          if (typeof actual !== type) fail(`Expected type ${type} but got ${typeof actual}`);
        },
        an: (type: string) => {
          if (typeof actual !== type) fail(`Expected type ${type} but got ${typeof actual}`);
        },
        above: (value: number) => {
          if (typeof actual !== 'number' || actual <= value) {
            fail(`Expected ${JSON.stringify(actual)} to be above ${value}`);
          }
        },
        below: (value: number) => {
          if (typeof actual !== 'number' || actual >= value) {
            fail(`Expected ${JSON.stringify(actual)} to be below ${value}`);
          }
        },
        oneOf: (values: unknown[]) => {
          if (!values.includes(actual)) {
            fail(`Expected ${JSON.stringify(actual)} to be one of ${JSON.stringify(values)}`);
          }
        },
      },
      have: {
        property: (name: string, value?: unknown) => {
          if (typeof actual !== 'object' || actual === null) {
            fail(`Expected an object but got ${typeof actual}`);
          }
          if (!(name in (actual as object))) {
            fail(`Expected property "${name}" to exist`);
          }
          if (value !== undefined && (actual as Record<string, unknown>)[name] !== value) {
            fail(`Expected property "${name}" to be ${JSON.stringify(value)}`);
          }
        },
        lengthOf: (length: number) => {
          if (Array.isArray(actual) || typeof actual === 'string') {
            if (actual.length !== length) {
              fail(`Expected length ${length} but got ${actual.length}`);
            }
          } else {
            fail('Expected an array or string');
          }
        },
        length: (length: number) => {
          if (Array.isArray(actual) || typeof actual === 'string') {
            if (actual.length !== length) {
              fail(`Expected length ${length} but got ${actual.length}`);
            }
          } else {
            fail('Expected an array or string');
          }
        },
      },
      include: (value: unknown) => {
        if (Array.isArray(actual)) {
          if (!actual.includes(value)) {
            fail(`Expected array to include ${JSON.stringify(value)}`);
          }
        } else if (typeof actual === 'string') {
          if (!actual.includes(String(value))) {
            fail(`Expected string to include ${JSON.stringify(value)}`);
          }
        } else {
          fail('Expected an array or string');
        }
      },
      not: {
        equal: (expected: unknown) => {
          if (actual === expected) {
            fail(`Expected value not to equal ${JSON.stringify(expected)}`);
          }
        },
      },
    },
  };
}

/**
 * Read a value using simple dot notation (supports numeric array indexes).
 */
function getJsonPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function getStatusText(code: number): string {
  const statusTexts: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  };
  return statusTexts[code] || 'Unknown';
}
