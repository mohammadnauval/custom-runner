import { prisma } from '@/server/prisma';
import { badRequest, handle, ok } from '@/server/http';
import { parseCollection } from '@/server/collection-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vercel serverless functions cap request bodies at ~4.5 MB, so uploads are
 * rejected above that to give a clear error instead of a platform-level 413.
 */
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
        `Collection is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Limit is 4 MB.`
      );
    }

    const content = await file.text();

    let parsed;
    try {
      parsed = parseCollection(content);
    } catch (error) {
      return badRequest(
        'Invalid Postman Collection',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }

    if (parsed.requests.length === 0) {
      return badRequest('Collection contains no requests');
    }

    const collection = await prisma.collection.create({
      data: {
        name: parsed.name,
        originalName: file.name,
        content,
        variableNames: parsed.variableNames,
        requestCount: parsed.requests.length,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        variableNames: true,
        requestCount: true,
        createdAt: true,
      },
    });

    return ok(collection, { status: 201 });
  });
}
