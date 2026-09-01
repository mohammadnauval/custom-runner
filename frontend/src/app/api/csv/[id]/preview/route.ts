import { prisma } from '@/server/prisma';
import { handle, notFound, ok } from '@/server/http';
import { getCsvPreview } from '@/server/csv-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const csvFile = await prisma.csvFile.findUnique({
      where: { id: params.id },
      select: { content: true, rowCount: true },
    });

    if (!csvFile) {
      return notFound('CSV file not found');
    }

    const preview = getCsvPreview(csvFile.content, 5);

    return ok({
      columns: preview.columns,
      rows: preview.rows,
      totalRows: csvFile.rowCount,
    });
  });
}
