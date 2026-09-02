import { prisma } from '@/server/prisma';
import { badRequest, handle, ok } from '@/server/http';
import { parseCsv } from '@/server/csv-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  return handle(async () => {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return badRequest('No file uploaded');
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return badRequest(
        `CSV is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Limit is 4 MB.`
      );
    }

    const content = await file.text();

    let parsed;
    try {
      parsed = parseCsv(content);
    } catch (error) {
      return badRequest(
        'Invalid CSV file',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }

    if (parsed.columns.length === 0) {
      return badRequest('Empty CSV file', 'The CSV must have a header row and at least one data row');
    }

    if (parsed.rowCount === 0) {
      return badRequest('CSV has no data rows');
    }

    const csvFile = await prisma.csvFile.create({
      data: {
        name: file.name.replace(/\.csv$/i, ''),
        originalName: file.name,
        content,
        columnNames: parsed.columns,
        rowCount: parsed.rowCount,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        columnNames: true,
        rowCount: true,
        createdAt: true,
      },
    });

    return ok(csvFile, { status: 201 });
  });
}
