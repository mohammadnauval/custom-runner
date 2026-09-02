const API_BASE = '/api';

/** An error carrying the HTTP status and any structured detail from the API. */
export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/**
 * Build an ApiError from a failed response.
 *
 * Handles non-JSON bodies too: a platform-level failure (a 413 from the host,
 * or a gateway error page) returns HTML, and blindly calling response.json()
 * would throw and mask the real status.
 */
async function toApiError(response: Response): Promise<ApiError> {
  const body = await response.text().catch(() => '');

  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: string; details?: unknown };
      if (parsed?.error) {
        return new ApiError(parsed.error, response.status, parsed.details);
      }
    } catch {
      // Not JSON - fall through to the status-based messages below
    }
  }

  if (response.status === 413) {
    return new ApiError('File is too large to upload (server limit)', response.status);
  }

  if (response.status === 504) {
    return new ApiError('The server took too long to respond', response.status);
  }

  return new ApiError(`Request failed with status ${response.status}`, response.status);
}

/** Flatten an error into something displayable, including validation detail. */
export function formatApiError(error: unknown): string {
  if (error instanceof ApiError) {
    const { details } = error;

    if (typeof details === 'string' && details.length > 0) {
      return `${error.message} — ${details}`;
    }

    if (Array.isArray(details)) {
      const issues = details
        .map((d) => {
          const issue = d as { path?: unknown[]; message?: string };
          const path = Array.isArray(issue.path) ? issue.path.join('.') : '';
          return path ? `${path}: ${issue.message}` : issue.message;
        })
        .filter(Boolean)
        .join('; ');
      if (issues) {
        return `${error.message} — ${issues}`;
      }
    }

    return error.message;
  }

  if (error instanceof Error) {
    // A rejected fetch (offline, DNS failure, request blocked) has no status
    return error.message === 'Failed to fetch'
      ? 'Could not reach the server. Check your connection and try again.'
      : error.message;
  }

  return 'Something went wrong';
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  return response.json();
}

/** Shared multipart upload used by both the collection and CSV endpoints. */
async function uploadFile<T>(endpoint: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  return response.json();
}

// Collections API
export const collectionsApi = {
  list: () => fetchApi<Collection[]>('/collections'),
  get: (id: string) => fetchApi<Collection>(`/collections/${id}`),
  upload: (file: File) => uploadFile<Collection>('/collections/upload', file),
  delete: (id: string) => fetchApi<{ success: boolean }>(`/collections/${id}`, { method: 'DELETE' }),
  getRequests: (id: string) => fetchApi<{ requests: RequestPreview[] }>(`/collections/${id}/requests`),
};

// CSV API
export const csvApi = {
  list: () => fetchApi<CsvFile[]>('/csv'),
  get: (id: string) => fetchApi<CsvFile>(`/csv/${id}`),
  upload: (file: File) => uploadFile<CsvFile>('/csv/upload', file),
  delete: (id: string) => fetchApi<{ success: boolean }>(`/csv/${id}`, { method: 'DELETE' }),
  getPreview: (id: string) => fetchApi<CsvPreview>(`/csv/${id}/preview`),
};

// Environments API
export const environmentsApi = {
  list: () => fetchApi<Environment[]>('/environments'),
  get: (id: string) => fetchApi<Environment>(`/environments/${id}`),
  create: (data: { name: string; variables: Record<string, string> }) =>
    fetchApi<Environment>('/environments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: { name?: string; variables?: Record<string, string> }) =>
    fetchApi<Environment>(`/environments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => fetchApi<{ success: boolean }>(`/environments/${id}`, { method: 'DELETE' }),
};

// Runs API
export const runsApi = {
  list: (params?: { limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    return fetchApi<RunsListResponse>(`/runs?${query}`);
  },
  get: (id: string) => fetchApi<Run>(`/runs/${id}`),
  create: (data: CreateRunRequest) =>
    fetchApi<{ id: string; status: string; totalIterations: number }>('/runs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  /**
   * Advance a run by one chunk of work. Serverless functions are time-limited,
   * so this must be called repeatedly until the response has `done: true`.
   */
  execute: (id: string) =>
    fetchApi<ExecuteChunkResult>(`/runs/${id}/execute`, { method: 'POST' }),
  cancel: (id: string) => fetchApi<{ success: boolean }>(`/runs/${id}/cancel`, { method: 'POST' }),
  delete: (id: string) => fetchApi<{ success: boolean }>(`/runs/${id}`, { method: 'DELETE' }),
  getIterations: (id: string) => fetchApi<Iteration[]>(`/runs/${id}/iterations`),
  getIterationRequests: (runId: string, iterationId: string) =>
    fetchApi<RequestResult[]>(`/runs/${runId}/iterations/${iterationId}/requests`),
};

// Types
export interface Collection {
  id: string;
  name: string;
  originalName: string;
  variableNames: string[];
  requestCount: number;
  createdAt: string;
}

export interface CsvFile {
  id: string;
  name: string;
  originalName: string;
  columnNames: string[];
  rowCount: number;
  createdAt: string;
}

export interface CsvPreview {
  columns: string[];
  rows: Record<string, string>[];
  totalRows: number;
}

export interface Environment {
  id: string;
  name: string;
  variables: Record<string, string>;
  createdAt: string;
}

export interface RequestPreview {
  index: number;
  name: string;
  method: string;
  url: string;
}

export interface Run {
  id: string;
  collection: { id: string; name: string };
  csvFile: { id: string; name: string; rowCount: number };
  environment?: { id: string; name: string };
  variableMapping: Record<string, string>;
  status: RunStatus;
  totalIterations: number;
  completedIterations: number;
  passedRequests: number;
  failedRequests: number;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface RunsListResponse {
  runs: RunSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface RunSummary {
  id: string;
  collectionName: string;
  csvFileName: string;
  environmentName?: string;
  status: RunStatus;
  totalIterations: number;
  completedIterations: number;
  passedRequests: number;
  failedRequests: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export type RunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * Outcome of one execution chunk.
 * - `busy`: another tab/invocation holds the run's lease
 * - `not_runnable`: the run already reached a terminal state
 * - `progress`: work remains, call execute again
 * - `finished`: the run is complete
 */
export type ExecuteChunkResult =
  | { status: 'busy'; done: false }
  | { status: 'not_runnable'; done: true; runStatus: RunStatus }
  | {
      status: 'progress';
      done: false;
      completedIterations: number;
      totalIterations: number;
      passedRequests: number;
      failedRequests: number;
    }
  | {
      status: 'finished';
      done: true;
      runStatus: RunStatus;
      completedIterations: number;
      totalIterations: number;
      passedRequests: number;
      failedRequests: number;
    };

export interface CreateRunRequest {
  collectionId: string;
  csvFileId: string;
  environmentId?: string;
  variableMapping: Record<string, string>;
}

export interface Iteration {
  id: string;
  rowIndex: number;
  rowData: Record<string, string>;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  passedCount: number;
  failedCount: number;
  startedAt?: string;
  completedAt?: string;
}

export interface RequestResult {
  id: string;
  requestIndex: number;
  requestName: string;
  method: string;
  url: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseTimeMs?: number;
  passed: boolean;
  errorMessage?: string;
  createdAt: string;
}
