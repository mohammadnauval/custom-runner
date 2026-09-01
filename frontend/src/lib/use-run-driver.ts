'use client';

import { useEffect, useRef } from 'react';
import { runsApi } from './api';

/** Pause between chunks so the UI can repaint and the DB can settle. */
const CHUNK_GAP_MS = 300;

/** Backoff when another client already holds the run's lease. */
const BUSY_RETRY_MS = 3_000;

/** Give up driving a run after this many consecutive `busy` responses. */
const MAX_BUSY_RETRIES = 20;

/** Give up after this many consecutive request failures. */
const MAX_ERRORS = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drives serverless execution of runs from the browser.
 *
 * Vercel has no long-lived worker process, so a run advances only while
 * something calls `POST /api/runs/:id/execute`. This hook keeps calling that
 * endpoint for every active run until it reports `done`.
 *
 * A run is safe to drive from multiple tabs: the server holds a lease, so
 * extra callers get `busy` and back off. If the browser closes mid-run the run
 * simply pauses and resumes the next time this hook sees it as active.
 */
export function useRunDriver(activeRunIds: string[], onProgress: () => void) {
  // Runs this hook instance is already looping on
  const driving = useRef(new Set<string>());
  const onProgressRef = useRef(onProgress);
  const mounted = useRef(true);

  onProgressRef.current = onProgress;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const key = activeRunIds.join(',');

  useEffect(() => {
    for (const runId of activeRunIds) {
      if (driving.current.has(runId)) {
        continue;
      }

      driving.current.add(runId);

      void (async () => {
        let busyRetries = 0;
        let errors = 0;

        try {
          while (mounted.current) {
            let result;

            try {
              result = await runsApi.execute(runId);
              errors = 0;
            } catch (error) {
              errors += 1;
              console.error(`Run ${runId} chunk failed:`, error);
              if (errors >= MAX_ERRORS) {
                break;
              }
              await sleep(BUSY_RETRY_MS);
              continue;
            }

            if (result.status === 'busy') {
              busyRetries += 1;
              if (busyRetries >= MAX_BUSY_RETRIES) {
                break;
              }
              await sleep(BUSY_RETRY_MS);
              continue;
            }

            busyRetries = 0;
            onProgressRef.current();

            if (result.done) {
              break;
            }

            await sleep(CHUNK_GAP_MS);
          }
        } finally {
          driving.current.delete(runId);
          if (mounted.current) {
            onProgressRef.current();
          }
        }
      })();
    }
    // activeRunIds is compared by its joined value to avoid restarting on
    // every poll that returns an equivalent array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
