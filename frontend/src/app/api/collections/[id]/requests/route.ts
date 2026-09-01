import { prisma } from '@/server/prisma';
import { handle, notFound, ok } from '@/server/http';
import { parseCollection } from '@/server/collection-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const collection = await prisma.collection.findUnique({
      where: { id: params.id },
      select: { content: true },
    });

    if (!collection) {
      return notFound('Collection not found');
    }

    const parsed = parseCollection(collection.content);

    return ok({
      requests: parsed.requests.map((r, index) => ({
        index,
        name: r.name,
        method: r.method,
        url: r.url,
      })),
    });
  });
}
