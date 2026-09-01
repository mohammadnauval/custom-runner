import { prisma } from '@/server/prisma';
import { conflict, handle, notFound, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const collection = await prisma.collection.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        originalName: true,
        variableNames: true,
        requestCount: true,
        createdAt: true,
      },
    });

    if (!collection) {
      return notFound('Collection not found');
    }

    return ok(collection);
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const collection = await prisma.collection.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!collection) {
      return notFound('Collection not found');
    }

    const runCount = await prisma.run.count({ where: { collectionId: collection.id } });

    if (runCount > 0) {
      return conflict(
        'Collection is used in runs',
        `This collection is used in ${runCount} run(s). Delete those runs first.`
      );
    }

    await prisma.collection.delete({ where: { id: collection.id } });

    return ok({ success: true });
  });
}
