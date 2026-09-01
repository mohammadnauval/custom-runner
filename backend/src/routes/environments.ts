import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const createEnvironmentSchema = z.object({
  name: z.string().min(1).max(100),
  variables: z.record(z.string()),
});

const updateEnvironmentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  variables: z.record(z.string()).optional(),
});

export async function environmentRoutes(app: FastifyInstance) {
  // Create a new environment
  app.post('/', async (request: FastifyRequest, reply) => {
    const result = createEnvironmentSchema.safeParse(request.body);
    
    if (!result.success) {
      return reply.status(400).send({
        error: 'Validation error',
        details: result.error.issues,
      });
    }
    
    const environment = await prisma.environment.create({
      data: {
        name: result.data.name,
        variables: result.data.variables,
      },
    });
    
    return {
      id: environment.id,
      name: environment.name,
      variables: environment.variables,
      createdAt: environment.createdAt,
    };
  });
  
  // List all environments
  app.get('/', async () => {
    const environments = await prisma.environment.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        variables: true,
        createdAt: true,
      },
    });
    return environments;
  });
  
  // Get a single environment
  app.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const environment = await prisma.environment.findUnique({
      where: { id: request.params.id },
    });
    
    if (!environment) {
      return reply.status(404).send({ error: 'Environment not found' });
    }
    
    return {
      id: environment.id,
      name: environment.name,
      variables: environment.variables,
      createdAt: environment.createdAt,
    };
  });
  
  // Update an environment
  app.put('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const result = updateEnvironmentSchema.safeParse(request.body);
    
    if (!result.success) {
      return reply.status(400).send({
        error: 'Validation error',
        details: result.error.issues,
      });
    }
    
    const existing = await prisma.environment.findUnique({
      where: { id: request.params.id },
    });
    
    if (!existing) {
      return reply.status(404).send({ error: 'Environment not found' });
    }
    
    const environment = await prisma.environment.update({
      where: { id: request.params.id },
      data: {
        ...(result.data.name && { name: result.data.name }),
        ...(result.data.variables && { variables: result.data.variables }),
      },
    });
    
    return {
      id: environment.id,
      name: environment.name,
      variables: environment.variables,
      createdAt: environment.createdAt,
      updatedAt: environment.updatedAt,
    };
  });
  
  // Delete an environment
  app.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const environment = await prisma.environment.findUnique({
      where: { id: request.params.id },
    });
    
    if (!environment) {
      return reply.status(404).send({ error: 'Environment not found' });
    }
    
    await prisma.environment.delete({
      where: { id: environment.id },
    });
    
    return { success: true };
  });
}
