import { FastifyReply } from 'fastify';

// Store SSE connections by run ID
const connections = new Map<string, Set<FastifyReply>>();

/**
 * Add an SSE connection for a run
 */
export function addConnection(runId: string, reply: FastifyReply): void {
  if (!connections.has(runId)) {
    connections.set(runId, new Set());
  }
  connections.get(runId)!.add(reply);
}

/**
 * Remove an SSE connection
 */
export function removeConnection(runId: string, reply: FastifyReply): void {
  const runConnections = connections.get(runId);
  if (runConnections) {
    runConnections.delete(reply);
    if (runConnections.size === 0) {
      connections.delete(runId);
    }
  }
}

/**
 * Publish progress update to all connections for a run
 */
export function publishProgress(runId: string, data: ProgressEvent): void {
  const runConnections = connections.get(runId);
  if (!runConnections) {
    return;
  }
  
  const message = `data: ${JSON.stringify(data)}\n\n`;
  
  for (const reply of runConnections) {
    try {
      reply.raw.write(message);
    } catch {
      // Connection might be closed, remove it
      runConnections.delete(reply);
    }
  }
}

// Progress event types
export type ProgressEvent =
  | { type: 'run_started'; runId: string }
  | { type: 'run_completed'; runId: string; totalPassed: number; totalFailed: number }
  | { type: 'run_failed'; runId: string; error: string }
  | { type: 'iteration_started'; runId: string; iterationIndex: number; totalIterations: number }
  | { type: 'iteration_completed'; runId: string; iterationIndex: number; passedCount: number; failedCount: number }
  | { type: 'request_started'; runId: string; iterationIndex: number; requestIndex: number; requestName: string }
  | { type: 'request_completed'; runId: string; iterationIndex: number; requestIndex: number; requestName: string; passed: boolean; responseStatus?: number; responseTimeMs?: number };
