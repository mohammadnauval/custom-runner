import { FastifyInstance, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { uploadFile, getFileAsString, deleteFile } from '../lib/s3.js';
import { parseCollection } from '../services/collection-parser.js';

export async function collectionRoutes(app: FastifyInstance) {
  // Upload a new collection
  app.post('/upload', async (request: FastifyRequest, reply) => {
    const data = await request.file();
    
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }
    
    const buffer = await data.toBuffer();
    const content = buffer.toString('utf-8');
    
    // Parse and validate collection
    let parsed;
    try {
      parsed = parseCollection(content);
    } catch (error) {
      return reply.status(400).send({
        error: 'Invalid Postman Collection',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    
    // Upload to S3
    const s3Key = `collections/${nanoid()}.json`;
    await uploadFile(s3Key, buffer, 'application/json');
    
    // Save to database
    const collection = await prisma.collection.create({
      data: {
        name: parsed.name,
        originalName: data.filename,
        s3Key,
        variableNames: parsed.variableNames,
        requestCount: parsed.requests.length,
      },
    });
    
    return {
      id: collection.id,
      name: collection.name,
      originalName: collection.originalName,
      variableNames: collection.variableNames,
      requestCount: collection.requestCount,
      createdAt: collection.createdAt,
    };
  });
  
  // List all collections
  app.get('/', async () => {
    const collections = await prisma.collection.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        originalName: true,
        variableNames: true,
        requestCount: true,
        createdAt: true,
      },
    });
    return collections;
  });
  
  // Get a single collection
  app.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const collection = await prisma.collection.findUnique({
      where: { id: request.params.id },
    });
    
    if (!collection) {
      return reply.status(404).send({ error: 'Collection not found' });
    }
    
    return {
      id: collection.id,
      name: collection.name,
      originalName: collection.originalName,
      variableNames: collection.variableNames,
      requestCount: collection.requestCount,
      createdAt: collection.createdAt,
    };
  });
  
  // Get collection requests (parsed)
  app.get('/:id/requests', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const collection = await prisma.collection.findUnique({
      where: { id: request.params.id },
    });
    
    if (!collection) {
      return reply.status(404).send({ error: 'Collection not found' });
    }
    
    const content = await getFileAsString(collection.s3Key);
    const parsed = parseCollection(content);
    
    return {
      requests: parsed.requests.map((r, i) => ({
        index: i,
        name: r.name,
        method: r.method,
        url: r.url,
      })),
    };
  });
  
  // Delete a collection
  app.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const collection = await prisma.collection.findUnique({
      where: { id: request.params.id },
    });
    
    if (!collection) {
      return reply.status(404).send({ error: 'Collection not found' });
    }
    
    // Check if collection is used in any runs
    const runCount = await prisma.run.count({
      where: { collectionId: collection.id },
    });
    
    if (runCount > 0) {
      return reply.status(400).send({
        error: 'Collection is used in runs',
        details: `This collection is used in ${runCount} run(s). Delete the runs first.`,
      });
    }
    
    // Delete from S3
    await deleteFile(collection.s3Key);
    
    // Delete from database
    await prisma.collection.delete({
      where: { id: collection.id },
    });
    
    return { success: true };
  });
}
