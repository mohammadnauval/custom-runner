import { z } from 'zod';
import { prisma } from '@/server/prisma';
import { badRequest, handle, notFound, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createRunSchema = z.object({
  collectionId: z.string().min(1),
  csvFileId: z.string().min(1),
  environmentId: z.string().optional(),
  variableMapping: z.record(z.string()), // { csvColumn: collectionVar }
});

export async function GET(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 20) || 20, 100);
    const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

    const [runs, total] = await Promise.all([
      prisma.run.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          collection: { select: { name: true } },
          csvFile: { select: { name: true, rowCount: true } },
          environment: { select: { name: true } },
        },
      }),
      prisma.run.count(),
    ]);

    return ok({
      runs: runs.map((run) => ({
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
    });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const body = createRunSchema.parse(await request.json());

    const [collection, csvFile] = await Promise.all([
      prisma.collection.findUnique({
        where: { id: body.collectionId },
        select: { id: true, requestCount: true },
      }),
      prisma.csvFile.findUnique({
        where: { id: body.csvFileId },
        select: { id: true, rowCount: true },
      }),
    ]);

    if (!collection) {
      return notFound('Collection not found');
    }

    if (!csvFile) {
      return notFound('CSV file not found');
    }

    if (body.environmentId) {
      const environment = await prisma.environment.findUnique({
        where: { id: body.environmentId },
        select: { id: true },
      });

      if (!environment) {
        return notFound('Environment not found');
      }
    }

    if (csvFile.rowCount === 0) {
      return badRequest('CSV file has no data rows');
    }

    const run = await prisma.run.create({
      data: {
        collectionId: body.collectionId,
        csvFileId: body.csvFileId,
        environmentId: body.environmentId,
        variableMapping: body.variableMapping,
        totalIterations: csvFile.rowCount,
      },
      select: { id: true, status: true, totalIterations: true, createdAt: true },
    });

    // Execution is driven by repeated calls to POST /api/runs/:id/execute.
    // The client starts that loop as soon as the run appears.
    return ok(run, { status: 201 });
  });
}
