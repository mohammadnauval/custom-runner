import { prisma } from '@/server/prisma';
import { handle, notFound, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: { id: string; iterationId: string } };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const iteration = await prisma.iteration.findUnique({
      where: { id: params.iterationId },
      select: { id: true, runId: true },
    });

    if (!iteration || iteration.runId !== params.id) {
      return notFound('Iteration not found');
    }

    const requests = await prisma.requestResult.findMany({
      where: { iterationId: iteration.id },
      orderBy: { requestIndex: 'asc' },
    });

    return ok(requests);
  });
}
