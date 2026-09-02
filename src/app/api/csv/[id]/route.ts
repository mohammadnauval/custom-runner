import { prisma } from '@/server/prisma';
import { conflict, handle, notFound, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const csvFile = await prisma.csvFile.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        originalName: true,
        columnNames: true,
        rowCount: true,
        createdAt: true,
      },
    });

    if (!csvFile) {
      return notFound('CSV file not found');
    }

    return ok(csvFile);
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const csvFile = await prisma.csvFile.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!csvFile) {
      return notFound('CSV file not found');
    }

    const runCount = await prisma.run.count({ where: { csvFileId: csvFile.id } });

    if (runCount > 0) {
      return conflict(
        'CSV file is used in runs',
        `This CSV file is used in ${runCount} run(s). Delete those runs first.`
      );
    }

    await prisma.csvFile.delete({ where: { id: csvFile.id } });

    return ok({ success: true });
  });
}
