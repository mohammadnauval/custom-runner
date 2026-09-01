import { NextResponse } from 'next/server';
import { prisma } from '@/server/prisma';
import { handle, notFound } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: { id: string } };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const run = await prisma.run.findUnique({
      where: { id: params.id },
      include: {
        collection: { select: { name: true } },
        csvFile: { select: { name: true, rowCount: true } },
        environment: { select: { name: true } },
        iterations: {
          orderBy: { rowIndex: 'asc' },
          include: { requests: { orderBy: { requestIndex: 'asc' } } },
        },
      },
    });

    if (!run) {
      return notFound('Run not found');
    }

    const payload = {
      run: {
        id: run.id,
        status: run.status,
        totalIterations: run.totalIterations,
        completedIterations: run.completedIterations,
        passedRequests: run.passedRequests,
        failedRequests: run.failedRequests,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        errorMessage: run.errorMessage,
      },
      collection: { name: run.collection.name },
      csvFile: { name: run.csvFile.name, rowCount: run.csvFile.rowCount },
      environment: run.environment ? { name: run.environment.name } : null,
      variableMapping: run.variableMapping,
      iterations: run.iterations.map((iter) => ({
        rowIndex: iter.rowIndex,
        rowData: iter.rowData,
        status: iter.status,
        passedCount: iter.passedCount,
        failedCount: iter.failedCount,
        requests: iter.requests.map((req) => ({
          requestIndex: req.requestIndex,
          requestName: req.requestName,
          method: req.method,
          url: req.url,
          requestHeaders: req.requestHeaders,
          requestBody: req.requestBody,
          passed: req.passed,
          responseStatus: req.responseStatus,
          responseTimeMs: req.responseTimeMs,
          responseBody: req.responseBody,
          testResults: req.testResults,
          errorMessage: req.errorMessage,
        })),
      })),
    };

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="run-${run.id}.json"`,
      },
    });
  });
}
