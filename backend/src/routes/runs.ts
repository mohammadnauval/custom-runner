import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { enqueueRun } from '../lib/queue.js';

const createRunSchema = z.object({
  collectionId: z.string().min(1),
  csvFileId: z.string().min(1),
  environmentId: z.string().optional(),
  variableMapping: z.record(z.string()), // { csvColumn: collectionVar }
});

export async function runRoutes(app: FastifyInstance) {
  // Create and start a new run
  app.post('/', async (request: FastifyRequest, reply) => {
    const result = createRunSchema.safeParse(request.body);
    
    if (!result.success) {
      return reply.status(400).send({
        error: 'Validation error',
        details: result.error.issues,
      });
    }
    
    const { collectionId, csvFileId, environmentId, variableMapping } = result.data;
    
    // Verify collection exists
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId },
    });
    
    if (!collection) {
      return reply.status(404).send({ error: 'Collection not found' });
    }
    
    // Verify CSV file exists
    const csvFile = await prisma.csvFile.findUnique({
      where: { id: csvFileId },
    });
    
    if (!csvFile) {
      return reply.status(404).send({ error: 'CSV file not found' });
    }
    
    // Verify environment exists (if provided)
    if (environmentId) {
      const environment = await prisma.environment.findUnique({
        where: { id: environmentId },
      });
      
      if (!environment) {
        return reply.status(404).send({ error: 'Environment not found' });
      }
    }
    
    // Create run
    const run = await prisma.run.create({
      data: {
        collectionId,
        csvFileId,
        environmentId,
        variableMapping,
        totalIterations: csvFile.rowCount,
      },
    });
    
    // Add to queue
    await enqueueRun(run.id);
    
    return {
      id: run.id,
      status: run.status,
      totalIterations: run.totalIterations,
      createdAt: run.createdAt,
    };
  });
  
  // List all runs
  app.get('/', async (request: FastifyRequest<{ Querystring: { limit?: string; offset?: string } }>) => {
    const limit = parseInt(request.query.limit || '20', 10);
    const offset = parseInt(request.query.offset || '0', 10);
    
    const [runs, total] = await Promise.all([
      prisma.run.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          collection: {
            select: { name: true },
          },
          csvFile: {
            select: { name: true, rowCount: true },
          },
          environment: {
            select: { name: true },
          },
        },
      }),
      prisma.run.count(),
    ]);
    
    return {
      runs: runs.map(run => ({
        id: run.id,
        collectionName: run.collection.name,
        csvFileName: run.csvFile.name,
        environmentName: run.environment?.name,
        status: run.status,
        totalIterations: run.totalIterations,
        completedIterations: run.completedIterations,
        passedRequests: run.passedRequests,
        failedRequests: run.failedRequests,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        createdAt: run.createdAt,
      })),
      total,
      limit,
      offset,
    };
  });
  
  // Get a single run
  app.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const run = await prisma.run.findUnique({
      where: { id: request.params.id },
      include: {
        collection: {
          select: { id: true, name: true },
        },
        csvFile: {
          select: { id: true, name: true, rowCount: true },
        },
        environment: {
          select: { id: true, name: true },
        },
      },
    });
    
    if (!run) {
      return reply.status(404).send({ error: 'Run not found' });
    }
    
    return {
      id: run.id,
      collection: run.collection,
      csvFile: run.csvFile,
      environment: run.environment,
      variableMapping: run.variableMapping,
      status: run.status,
      totalIterations: run.totalIterations,
      completedIterations: run.completedIterations,
      passedRequests: run.passedRequests,
      failedRequests: run.failedRequests,
      errorMessage: run.errorMessage,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
    };
  });
  
  // Get run iterations
  app.get('/:id/iterations', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const run = await prisma.run.findUnique({
      where: { id: request.params.id },
    });
    
    if (!run) {
      return reply.status(404).send({ error: 'Run not found' });
    }
    
    const iterations = await prisma.iteration.findMany({
      where: { runId: run.id },
      orderBy: { rowIndex: 'asc' },
      select: {
        id: true,
        rowIndex: true,
        rowData: true,
        status: true,
        passedCount: true,
        failedCount: true,
        startedAt: true,
        completedAt: true,
      },
    });
    
    return iterations;
  });
  
  // Get iteration requests
  app.get('/:id/iterations/:iterationId/requests', async (
    request: FastifyRequest<{ Params: { id: string; iterationId: string } }>,
    reply
  ) => {
    const iteration = await prisma.iteration.findUnique({
      where: { id: request.params.iterationId },
      include: {
        run: { select: { id: true } },
      },
    });
    
    if (!iteration || iteration.run.id !== request.params.id) {
      return reply.status(404).send({ error: 'Iteration not found' });
    }
    
    const requests = await prisma.requestResult.findMany({
      where: { iterationId: iteration.id },
      orderBy: { requestIndex: 'asc' },
    });
    
    return requests;
  });
  
  // Cancel a run
  app.post('/:id/cancel', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const run = await prisma.run.findUnique({
      where: { id: request.params.id },
    });
    
    if (!run) {
      return reply.status(404).send({ error: 'Run not found' });
    }
    
    if (run.status !== 'PENDING' && run.status !== 'RUNNING') {
      return reply.status(400).send({
        error: 'Cannot cancel run',
        details: `Run is already ${run.status.toLowerCase()}`,
      });
    }
    
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
      },
    });
    
    return { success: true };
  });
  
  // Delete a run
  app.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const run = await prisma.run.findUnique({
      where: { id: request.params.id },
    });
    
    if (!run) {
      return reply.status(404).send({ error: 'Run not found' });
    }
    
    if (run.status === 'RUNNING') {
      return reply.status(400).send({
        error: 'Cannot delete running run',
        details: 'Cancel the run first before deleting',
      });
    }
    
    // Delete cascades to iterations and request results
    await prisma.run.delete({
      where: { id: run.id },
    });
    
    return { success: true };
  });
  
  // Export run results as JSON
  app.get('/:id/export/json', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const run = await prisma.run.findUnique({
      where: { id: request.params.id },
      include: {
        collection: true,
        csvFile: true,
        environment: true,
        iterations: {
          include: {
            requests: true,
          },
          orderBy: { rowIndex: 'asc' },
        },
      },
    });
    
    if (!run) {
      return reply.status(404).send({ error: 'Run not found' });
    }
    
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="run-${run.id}.json"`);
    
    return {
      run: {
        id: run.id,
        status: run.status,
        totalIterations: run.totalIterations,
        passedRequests: run.passedRequests,
        failedRequests: run.failedRequests,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      },
      collection: {
        name: run.collection.name,
      },
      csvFile: {
        name: run.csvFile.name,
        rowCount: run.csvFile.rowCount,
      },
      environment: run.environment ? { name: run.environment.name } : null,
      iterations: run.iterations.map(iter => ({
        rowIndex: iter.rowIndex,
        rowData: iter.rowData,
        status: iter.status,
        passedCount: iter.passedCount,
        failedCount: iter.failedCount,
        requests: iter.requests.map(req => ({
          requestName: req.requestName,
          method: req.method,
          url: req.url,
          passed: req.passed,
          responseStatus: req.responseStatus,
          responseTimeMs: req.responseTimeMs,
          errorMessage: req.errorMessage,
        })),
      })),
    };
  });
  
  // Export run results as CSV
  app.get('/:id/export/csv', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const run = await prisma.run.findUnique({
      where: { id: request.params.id },
      include: {
        iterations: {
          include: {
            requests: true,
          },
          orderBy: { rowIndex: 'asc' },
        },
      },
    });
    
    if (!run) {
      return reply.status(404).send({ error: 'Run not found' });
    }
    
    // Build CSV
    const headers = ['Iteration', 'Request Name', 'Method', 'URL', 'Status', 'Response Code', 'Response Time (ms)', 'Error'];
    const rows: string[][] = [];
    
    for (const iter of run.iterations) {
      for (const req of iter.requests) {
        rows.push([
          String(iter.rowIndex + 1),
          req.requestName,
          req.method,
          req.url,
          req.passed ? 'PASS' : 'FAIL',
          req.responseStatus ? String(req.responseStatus) : '',
          req.responseTimeMs ? String(req.responseTimeMs) : '',
          req.errorMessage || '',
        ]);
      }
    }
    
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\n');
    
    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', `attachment; filename="run-${run.id}.csv"`);
    
    return csv;
  });
}
