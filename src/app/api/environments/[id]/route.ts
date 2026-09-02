import { z } from 'zod';
import { prisma } from '@/server/prisma';
import { conflict, handle, notFound, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

const updateEnvironmentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  variables: z.record(z.string()).optional(),
});

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const environment = await prisma.environment.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, variables: true, createdAt: true },
    });

    if (!environment) {
      return notFound('Environment not found');
    }

    return ok(environment);
  });
}

export async function PUT(request: Request, { params }: Params) {
  return handle(async () => {
    const body = updateEnvironmentSchema.parse(await request.json());

    const existing = await prisma.environment.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!existing) {
      return notFound('Environment not found');
    }

    const environment = await prisma.environment.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.variables !== undefined && { variables: body.variables }),
      },
      select: { id: true, name: true, variables: true, createdAt: true, updatedAt: true },
    });

    return ok(environment);
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const environment = await prisma.environment.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!environment) {
      return notFound('Environment not found');
    }

    const runCount = await prisma.run.count({ where: { environmentId: environment.id } });

    if (runCount > 0) {
      return conflict(
        'Environment is used in runs',
        `This environment is used in ${runCount} run(s). Delete those runs first.`
      );
    }

    await prisma.environment.delete({ where: { id: environment.id } });

    return ok({ success: true });
  });
}
