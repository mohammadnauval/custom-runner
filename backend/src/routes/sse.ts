import { FastifyInstance, FastifyRequest } from 'fastify';
import { addConnection, removeConnection } from '../services/sse-manager.js';

export async function sseRoutes(app: FastifyInstance) {
  // SSE endpoint for run progress
  app.get('/runs/:runId', async (request: FastifyRequest<{ Params: { runId: string } }>, reply) => {
    const { runId } = request.params;
    
    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    
    // Send initial connection message
    reply.raw.write(`data: ${JSON.stringify({ type: 'connected', runId })}\n\n`);
    
    // Add connection to manager
    addConnection(runId, reply);
    
    // Handle client disconnect
    request.raw.on('close', () => {
      removeConnection(runId, reply);
    });
    
    // Keep connection alive with periodic pings
    const pingInterval = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n');
      } catch {
        clearInterval(pingInterval);
        removeConnection(runId, reply);
      }
    }, 30000);
    
    // Cleanup on close
    request.raw.on('close', () => {
      clearInterval(pingInterval);
    });
    
    // Don't end the response - keep it open for SSE
    return reply;
  });
}
