import { PrismaClient } from '@prisma/client';

// Reuse a single client across hot reloads in dev and across warm serverless
// invocations in production. Use a pooled connection string (e.g. Neon's
// `-pooler` host or Supabase's pgbouncer port) so serverless concurrency does
// not exhaust Postgres connections.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
