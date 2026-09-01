import { prisma } from '@/server/prisma';
import { badRequest, handle, notFound, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

/**
 * Flip the run to CANCELLED. The in-flight execute chunk notices this on its
 * next cancellation check and stops issuing requests.
 */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const run = await prisma.run.findUnique({
      where: { id: params.id },
      select: { id: true, status: true },
    });

    if (!run) {
      return notFound('Run not found');
    }

    if (run.status !== 'PENDING' && run.status !== 'RUNNING') {
      return badRequest('Cannot cancel run', `Run is already ${run.status.toLowerCase()}`);
    }

    await prisma.run.update({
      where: { id: run.id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });

    return ok({ success: true });
  });
}
