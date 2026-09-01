import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { collectionRoutes } from './routes/collections.js';
import { csvRoutes } from './routes/csv.js';
import { environmentRoutes } from './routes/environments.js';
import { runRoutes } from './routes/runs.js';
import { sseRoutes } from './routes/sse.js';

const app = Fastify({
  logger: {
    level: config.nodeEnv === 'development' ? 'info' : 'warn',
    transport: config.nodeEnv === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
});

// Register plugins
await app.register(cors, {
  origin: config.corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true,
});

await app.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
});

// Health check
app.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Register routes
await app.register(collectionRoutes, { prefix: '/api/collections' });
await app.register(csvRoutes, { prefix: '/api/csv' });
await app.register(environmentRoutes, { prefix: '/api/environments' });
await app.register(runRoutes, { prefix: '/api/runs' });
await app.register(sseRoutes, { prefix: '/api/sse' });

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down gracefully...');
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`Server running at http://${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
