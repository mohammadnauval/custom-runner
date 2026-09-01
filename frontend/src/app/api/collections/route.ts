import { prisma } from '@/server/prisma';
import { handle, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const collections = await prisma.collection.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        originalName: true,
        variableNames: true,
        requestCount: true,
        createdAt: true,
      },
    });

    return ok(collections);
  });
}
