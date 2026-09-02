import { executeChunk } from '@/server/executor';
import { handle, notFound, ok, serverError } from '@/server/http';
import { prisma } from '@/server/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Serverless functions are time-limited, so a run is executed as a series of
 * chunks. Callers should keep POSTing here until the response has `done: true`.
 *
 * 60s is the Vercel Hobby ceiling. On Pro/Enterprise this can be raised
 * (up to 300s/900s) along with EXEC_TIME_BUDGET_MS for fewer round trips.
 */
export const maxDuration = 60;

type Params = { params: { id: string } };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const run = await prisma.run.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!run) {
      return notFound('Run not found');
    }

    try {
      const result = await executeChunk(params.id);
      return ok(result);
    } catch (error) {
      // executeChunk already marked the run FAILED and stored the message
      return serverError(error);
    }
  });
}
