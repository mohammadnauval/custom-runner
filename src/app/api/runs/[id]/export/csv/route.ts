import { NextResponse } from 'next/server';
import { prisma } from '@/server/prisma';
import { handle, notFound } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: { id: string } };

/** RFC 4180 escaping: wrap in quotes and double any embedded quotes. */
function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const run = await prisma.run.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        iterations: {
          orderBy: { rowIndex: 'asc' },
          include: { requests: { orderBy: { requestIndex: 'asc' } } },
        },
      },
    });

    if (!run) {
      return notFound('Run not found');
    }

    const headers = [
      'Iteration',
      'Request Name',
      'Method',
      'URL',
      'Result',
      'Response Code',
      'Response Time (ms)',
      'Failed Tests',
      'Error',
    ];

    const rows: string[][] = [];

    for (const iteration of run.iterations) {
      for (const req of iteration.requests) {
        const failedTests = Array.isArray(req.testResults)
          ? (req.testResults as Array<{ name: string; passed: boolean }>)
              .filter((t) => !t.passed)
              .map((t) => t.name)
              .join('; ')
          : '';

        rows.push([
          String(iteration.rowIndex + 1),
          req.requestName,
          req.method,
          req.url,
          req.passed ? 'PASS' : 'FAIL',
          req.responseStatus !== null ? String(req.responseStatus) : '',
          req.responseTimeMs !== null ? String(req.responseTimeMs) : '',
          failedTests,
          req.errorMessage ?? '',
        ]);
      }
    }

    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="run-${run.id}.csv"`,
      },
    });
  });
}
