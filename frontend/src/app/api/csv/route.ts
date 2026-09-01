import { prisma } from '@/server/prisma';
import { handle, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const csvFiles = await prisma.csvFile.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        originalName: true,
        columnNames: true,
        rowCount: true,
        createdAt: true,
      },
    });

    return ok(csvFiles);
  });
}
