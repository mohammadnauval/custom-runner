import { Prisma, type RunStatus } from '@prisma/client';
import { prisma } from './prisma';
import { parseCollection, substituteRequestVariables } from './collection-parser';
import { parseCsv } from './csv-parser';
import { executeRequest } from './http-client';
import { executeTestScript, type TestResult } from './script-sandbox';
import type { FlattenedRequest } from './types/postman';

/**
 * Serverless-friendly execution engine.
 *
 * A Vercel function cannot run for the duration of a whole test run, so a run
 * is executed as a series of short "chunks". Each chunk:
 *   1. Takes a lease on the run so no two invocations overlap.
 *   2. Works through pending iterations/requests until its time budget runs out.
 *   3. Persists progress and reports whether more work remains.
 *
 * Because every completed request is written to the database, a chunk can
 * resume exactly where the previous one stopped.
 */

/** How long a single chunk may spend issuing requests. */
const TIME_BUDGET_MS = Number(process.env.EXEC_TIME_BUDGET_MS ?? 30_000);

/** Lease duration; must exceed the function's maxDuration. */
const LEASE_MS = Number(process.env.EXEC_LEASE_MS ?? 90_000);

/** Minimum gap between cancellation checks. */
const CANCEL_POLL_MS = 2_000;

const ITERATION_INSERT_BATCH = 500;

/**
 * Upper bound on the configurable inter-request delay.
 *
 * A delay is only honoured if it fits inside a chunk's time budget alongside
 * the request itself; at a chunk boundary the wait is skipped. Capping at half
 * the budget keeps every requested delay actually deliverable instead of
 * silently coming out shorter.
 */
export const MAX_DELAY_MS = Math.max(0, Math.min(15_000, Math.floor(TIME_BUDGET_MS / 2)));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ChunkResult =
  | { status: 'busy'; done: false }
  | { status: 'not_runnable'; done: true; runStatus: RunStatus }
  | {
      status: 'progress';
      done: false;
      completedIterations: number;
      totalIterations: number;
      passedRequests: number;
      failedRequests: number;
    }
  | {
      status: 'finished';
      done: true;
      runStatus: RunStatus;
      completedIterations: number;
      totalIterations: number;
      passedRequests: number;
      failedRequests: number;
    };

/**
 * Execute one chunk of work for a run.
 */
export async function executeChunk(runId: string): Promise<ChunkResult> {
  const deadline = Date.now() + TIME_BUDGET_MS;

  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: { collection: true, csvFile: true, environment: true },
  });

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  if (run.status !== 'PENDING' && run.status !== 'RUNNING') {
    return { status: 'not_runnable', done: true, runStatus: run.status };
  }

  if (!(await acquireLease(runId))) {
    return { status: 'busy', done: false };
  }

  let leaseHeld = true;

  try {
    await prisma.run.updateMany({
      where: { id: runId, startedAt: null },
      data: { startedAt: new Date() },
    });

    const { requests } = parseCollection(run.collection.content);
    if (requests.length === 0) {
      throw new Error('Collection contains no requests');
    }

    const { rows } = parseCsv(run.csvFile.content);
    if (rows.length === 0) {
      throw new Error('CSV file contains no data rows');
    }

    await ensureIterations(runId, rows);

    const envVariables = (run.environment?.variables as Record<string, string> | undefined) ?? {};
    const variableMapping = (run.variableMapping as Record<string, string>) ?? {};
    const delayMs = Math.min(Math.max(run.delayMs ?? 0, 0), MAX_DELAY_MS);

    let lastCancelCheck = Date.now();

    // The first request of a chunk never waits. A chunk boundary already
    // introduces a pause, and skipping it here guarantees every chunk completes
    // at least one request — otherwise a delay larger than the time budget
    // would sleep, run out of budget, and loop forever making no progress.
    let sentInThisChunk = false;

    // Work through iterations until the run finishes or the budget expires.
    // The budget is only allowed to end a chunk once that chunk has actually
    // sent something. Otherwise slow per-chunk setup (several database round
    // trips) could consume the whole budget before the first request, and
    // every chunk would return "no work done" forever.
    for (;;) {
      if (sentInThisChunk && Date.now() >= deadline) {
        break;
      }

      if (await isCancelled(runId)) {
        leaseHeld = false;
        return await summarise(runId, 'CANCELLED');
      }

      const iteration = await prisma.iteration.findFirst({
        where: { runId, status: { in: ['PENDING', 'RUNNING'] } },
        orderBy: { rowIndex: 'asc' },
      });

      if (!iteration) {
        // Everything processed
        leaseHeld = false;
        return await finalise(runId);
      }

      if (iteration.status === 'PENDING') {
        await prisma.iteration.update({
          where: { id: iteration.id },
          data: { status: 'RUNNING', startedAt: new Date() },
        });
      }

      const rowData = (iteration.rowData as Record<string, string>) ?? {};
      const variables = buildVariables(envVariables, variableMapping, rowData);

      // Requests already recorded in a previous chunk are skipped
      const existing = await prisma.requestResult.findMany({
        where: { iterationId: iteration.id },
        select: { requestIndex: true },
      });
      const completedIndexes = new Set(existing.map((r) => r.requestIndex));

      let budgetExpired = false;

      for (let j = 0; j < requests.length; j++) {
        if (completedIndexes.has(j)) {
          continue;
        }

        // Same rule as the outer loop: never leave a chunk empty-handed.
        if (sentInThisChunk && Date.now() >= deadline) {
          budgetExpired = true;
          break;
        }

        // Wait between consecutive requests, including across iterations.
        // If the wait wouldn't leave room to actually send, end the chunk and
        // let the next one resume — the boundary supplies the gap instead.
        if (sentInThisChunk && delayMs > 0) {
          if (Date.now() + delayMs >= deadline) {
            budgetExpired = true;
            break;
          }
          await sleep(delayMs);
        }

        if (Date.now() - lastCancelCheck >= CANCEL_POLL_MS) {
          lastCancelCheck = Date.now();
          if (await isCancelled(runId)) {
            leaseHeld = false;
            return await summarise(runId, 'CANCELLED');
          }
        }

        await runAndRecord(iteration.id, j, requests[j], variables);
        sentInThisChunk = true;
      }

      if (budgetExpired) {
        await refreshRunCounters(runId);
        break;
      }

      await closeIteration(iteration.id);
      await refreshRunCounters(runId);
    }

    const counters = await refreshRunCounters(runId);

    return {
      status: 'progress',
      done: false,
      completedIterations: counters.completedIterations,
      totalIterations: run.totalIterations,
      passedRequests: counters.passedRequests,
      failedRequests: counters.failedRequests,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    leaseHeld = false;

    await prisma.run.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        errorMessage,
        completedAt: new Date(),
        leaseUntil: null,
      },
    });

    throw error;
  } finally {
    if (leaseHeld) {
      await releaseLease(runId);
    }
  }
}

/**
 * Claim exclusive rights to work on a run. Returns false when another
 * invocation already holds an unexpired lease.
 */
async function acquireLease(runId: string): Promise<boolean> {
  const now = new Date();
  const result = await prisma.run.updateMany({
    where: {
      id: runId,
      status: { in: ['PENDING', 'RUNNING'] },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    data: {
      status: 'RUNNING',
      leaseUntil: new Date(now.getTime() + LEASE_MS),
    },
  });

  return result.count === 1;
}

async function releaseLease(runId: string): Promise<void> {
  await prisma.run.updateMany({
    where: { id: runId },
    data: { leaseUntil: null },
  });
}

async function isCancelled(runId: string): Promise<boolean> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  return run?.status === 'CANCELLED';
}

/**
 * Create one iteration per CSV row. Safe to call repeatedly — the
 * (runId, rowIndex) unique constraint makes it idempotent.
 */
async function ensureIterations(runId: string, rows: Record<string, string>[]): Promise<void> {
  const existingCount = await prisma.iteration.count({ where: { runId } });
  if (existingCount >= rows.length) {
    return;
  }

  for (let start = 0; start < rows.length; start += ITERATION_INSERT_BATCH) {
    const batch = rows.slice(start, start + ITERATION_INSERT_BATCH).map((row, offset) => ({
      runId,
      rowIndex: start + offset,
      rowData: row as Prisma.InputJsonValue,
    }));

    await prisma.iteration.createMany({ data: batch, skipDuplicates: true });
  }
}

/**
 * Merge environment variables with the CSV values for this row.
 * CSV values win so per-row data overrides environment defaults.
 */
function buildVariables(
  envVariables: Record<string, string>,
  variableMapping: Record<string, string>,
  rowData: Record<string, string>
): Record<string, string> {
  const variables: Record<string, string> = { ...envVariables };

  for (const [csvColumn, collectionVar] of Object.entries(variableMapping)) {
    const value = rowData[csvColumn];
    if (value !== undefined) {
      variables[collectionVar] = value;
    }
  }

  return variables;
}

/**
 * Execute a single request and persist its result.
 */
async function runAndRecord(
  iterationId: string,
  requestIndex: number,
  request: FlattenedRequest,
  variables: Record<string, string>
): Promise<void> {
  const resolved = substituteRequestVariables(request, variables);

  const requestBody =
    resolved.body === undefined
      ? null
      : typeof resolved.body.content === 'string'
        ? resolved.body.content
        : JSON.stringify(resolved.body.content);

  try {
    const response = await executeRequest(resolved);

    let testResults: TestResult[] = [];
    let passed = response.status >= 200 && response.status < 400;

    if (resolved.testScript && resolved.testScript.length > 0) {
      testResults = executeTestScript(resolved.testScript, {
        responseStatus: response.status,
        responseBody: response.body,
        responseHeaders: response.headers,
        responseTime: response.timeMs,
      });

      // When a collection defines tests, they decide pass/fail
      if (testResults.length > 0) {
        passed = testResults.every((t) => t.passed);
      }
    }

    await prisma.requestResult.create({
      data: {
        iterationId,
        requestIndex,
        requestName: resolved.name,
        method: resolved.method,
        url: resolved.url,
        requestHeaders: resolved.headers as Prisma.InputJsonValue,
        requestBody,
        responseStatus: response.status,
        responseHeaders: response.headers as Prisma.InputJsonValue,
        responseBody: response.body,
        responseTimeMs: response.timeMs,
        passed,
        testResults:
          testResults.length > 0 ? (testResults as unknown as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (error) {
    await prisma.requestResult.create({
      data: {
        iterationId,
        requestIndex,
        requestName: resolved.name,
        method: resolved.method,
        url: resolved.url,
        requestHeaders: resolved.headers as Prisma.InputJsonValue,
        requestBody,
        passed: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}

/**
 * Mark an iteration finished and store its pass/fail tally.
 */
async function closeIteration(iterationId: string): Promise<void> {
  const [passedCount, failedCount] = await Promise.all([
    prisma.requestResult.count({ where: { iterationId, passed: true } }),
    prisma.requestResult.count({ where: { iterationId, passed: false } }),
  ]);

  await prisma.iteration.update({
    where: { id: iterationId },
    data: {
      status: failedCount > 0 ? 'FAILED' : 'COMPLETED',
      passedCount,
      failedCount,
      completedAt: new Date(),
    },
  });
}

/**
 * Recompute run totals from stored results so counters stay correct across
 * chunk boundaries and retries.
 */
async function refreshRunCounters(runId: string): Promise<{
  completedIterations: number;
  passedRequests: number;
  failedRequests: number;
}> {
  const [completedIterations, passedRequests, failedRequests] = await Promise.all([
    prisma.iteration.count({ where: { runId, status: { in: ['COMPLETED', 'FAILED'] } } }),
    prisma.requestResult.count({ where: { iteration: { runId }, passed: true } }),
    prisma.requestResult.count({ where: { iteration: { runId }, passed: false } }),
  ]);

  await prisma.run.update({
    where: { id: runId },
    data: { completedIterations, passedRequests, failedRequests },
  });

  return { completedIterations, passedRequests, failedRequests };
}

/**
 * All iterations processed: close out the run.
 */
async function finalise(runId: string): Promise<ChunkResult> {
  const counters = await refreshRunCounters(runId);

  const run = await prisma.run.update({
    where: { id: runId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      leaseUntil: null,
    },
  });

  return {
    status: 'finished',
    done: true,
    runStatus: run.status,
    completedIterations: counters.completedIterations,
    totalIterations: run.totalIterations,
    passedRequests: counters.passedRequests,
    failedRequests: counters.failedRequests,
  };
}

/**
 * Stop working on a run that reached a terminal state (e.g. cancelled).
 */
async function summarise(runId: string, runStatus: RunStatus): Promise<ChunkResult> {
  const counters = await refreshRunCounters(runId);

  const run = await prisma.run.update({
    where: { id: runId },
    data: {
      completedAt: new Date(),
      leaseUntil: null,
    },
  });

  return {
    status: 'finished',
    done: true,
    runStatus,
    completedIterations: counters.completedIterations,
    totalIterations: run.totalIterations,
    passedRequests: counters.passedRequests,
    failedRequests: counters.failedRequests,
  };
}
