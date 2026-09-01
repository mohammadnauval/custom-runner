import { Queue, Worker, Job } from 'bullmq';
import { redis } from './redis.js';
import { executeRun } from '../services/execution.js';

export interface RunJobData {
  runId: string;
}

// Queue for run execution jobs
export const runQueue = new Queue<RunJobData>('run-execution', {
  connection: redis,
  defaultJobOptions: {
    attempts: 1, // Don't retry failed runs automatically
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 100, // Keep last 100 failed jobs
  },
});

// Worker to process run jobs
export const runWorker = new Worker<RunJobData>(
  'run-execution',
  async (job: Job<RunJobData>) => {
    console.log(`Processing run: ${job.data.runId}`);
    await executeRun(job.data.runId);
  },
  {
    connection: redis,
    concurrency: 5, // Process up to 5 runs concurrently
  }
);

runWorker.on('completed', (job) => {
  console.log(`Run ${job.data.runId} completed`);
});

runWorker.on('failed', (job, err) => {
  console.error(`Run ${job?.data.runId} failed:`, err);
});

// Add a run to the queue
export async function enqueueRun(runId: string): Promise<void> {
  await runQueue.add('execute', { runId });
}
