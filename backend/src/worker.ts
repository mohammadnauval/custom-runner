import 'dotenv/config';
import { runWorker } from './lib/queue.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';

console.log('Worker starting...');

// Graceful shutdown
const shutdown = async () => {
  console.log('Worker shutting down...');
  await runWorker.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Keep the process alive
console.log('Worker is running and waiting for jobs...');
