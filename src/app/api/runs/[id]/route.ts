import { prisma } from '@/server/prisma';
import { conflict, handle, notFound, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const run = await prisma.run.findUnique({
      where: { id: params.id },
      include: {
        collection: { select: { id: true, name: true } },
        csvFile: { select: { id: true, name: true, rowCount: true } },
        environment: { select: { id: true, name: true } },
      },
    });

    if (!run) {
      return notFound('Run not found');
    }

    return ok({
      id: run.id,
      collection: run.collection,
      csvFile: run.csvFile,
      environment: run.environment,
      variableMapping: run.variableMapping,
      delayMs: run.delayMs,
      status: run.status,
      totalIterations: run.totalIterations,
      completedIterations: run.completedIterations,
      passedRequests: run.passedRequests,
      failedRequests: run.failedRequests,
      errorMessage: run.errorMessage,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
    });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const run = await prisma.run.findUnique({
      where: { id: params.id },
      select: { id: true, status: true, leaseUntil: true },
    });

    if (!run) {
      return notFound('Run not found');
    }

    const leaseActive = run.leaseUntil !== null && run.leaseUntil > new Date();

    if (run.status === 'RUNNING' && leaseActive) {
      return conflict(
        'Cannot delete a run that is executing',
        'Cancel the run and wait for the current chunk to finish, then delete it'
      );
    }

    // Iterations and request results cascade
    await prisma.run.delete({ where: { id: run.id } });

    return ok({ success: true });
  });
}
