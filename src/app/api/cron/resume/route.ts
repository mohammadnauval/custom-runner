import { NextResponse } from 'next/server';
import { prisma } from '@/server/prisma';
import { executeChunk } from '@/server/executor';
import { handle, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Optional resumer for runs that stalled because no browser tab was driving
 * them (e.g. the user closed the page mid-run).
 *
 * Wire it to Vercel Cron by adding to vercel.json:
 *   { "crons": [{ "path": "/api/cron/resume", "schedule": "* * * * *" }] }
 *
 * Sub-daily cron schedules require a Vercel Pro plan. Set CRON_SECRET in the
 * project environment; Vercel sends it as `Authorization: Bearer <secret>`.
 * When CRON_SECRET is unset the endpoint refuses to run rather than exposing
 * an unauthenticated trigger.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;

    if (!secret) {
      return NextResponse.json(
        { error: 'CRON_SECRET is not configured; endpoint disabled' },
        { status: 503 }
      );
    }

    if (request.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();

    // Pick the oldest run that nothing is currently working on
    const stalled = await prisma.run.findFirst({
      where: {
        status: { in: ['PENDING', 'RUNNING'] },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (!stalled) {
      return ok({ resumed: null, message: 'No stalled runs' });
    }

    const result = await executeChunk(stalled.id);

    return ok({ resumed: stalled.id, result });
  });
}
