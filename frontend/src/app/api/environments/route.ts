import { z } from 'zod';
import { prisma } from '@/server/prisma';
import { handle, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createEnvironmentSchema = z.object({
  name: z.string().min(1).max(100),
  variables: z.record(z.string()),
});

export async function GET() {
  return handle(async () => {
    const environments = await prisma.environment.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, variables: true, createdAt: true },
    });

    return ok(environments);
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const body = createEnvironmentSchema.parse(await request.json());

    const environment = await prisma.environment.create({
      data: { name: body.name, variables: body.variables },
      select: { id: true, name: true, variables: true, createdAt: true },
    });

    return ok(environment, { status: 201 });
  });
}
