import { prisma } from '@/server/prisma';
import { handle, notFound, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const run = await prisma.run.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!run) {
      return notFound('Run not found');
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

    return ok(iterations);
  });
}
