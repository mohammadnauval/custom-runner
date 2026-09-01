import { prisma } from '../lib/prisma.js';
import { getFileAsString } from '../lib/s3.js';
import { parseCollection, substituteRequestVariables } from './collection-parser.js';
import { parseCsv } from './csv-parser.js';
import { executeRequest } from './http-client.js';
import { publishProgress } from './sse-manager.js';
import { executeTestScript, type TestResult } from './script-sandbox.js';
import type { FlattenedRequest } from '../types/postman.js';

/**
 * Execute a complete run
 */
export async function executeRun(runId: string): Promise<void> {
  // Get run with related data
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      collection: true,
      csvFile: true,
      environment: true,
    },
  });
  
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  
  try {
    // Update run status to RUNNING
    await prisma.run.update({
      where: { id: runId },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });
    
    publishProgress(runId, { type: 'run_started', runId });
    
    // Load collection from S3
    const collectionJson = await getFileAsString(run.collection.s3Key);
    const { requests } = parseCollection(collectionJson);
    
    // Load CSV from S3
    const csvContent = await getFileAsString(run.csvFile.s3Key);
    const { rows } = parseCsv(csvContent);
    
    // Get environment variables
    const envVariables = (run.environment?.variables as Record<string, string>) || {};
    
    // Get variable mapping
    const variableMapping = run.variableMapping as Record<string, string>;
    
    // Create iterations
    const iterationData = rows.map((row, index) => ({
      runId,
      rowIndex: index,
      rowData: row,
      status: 'PENDING' as const,
    }));

    await prisma.iteration.createMany({
      data: iterationData,
    });

    // Fetch created iterations
    const iterations = await prisma.iteration.findMany({
      where: { runId },
      orderBy: { rowIndex: 'asc' },
    });
    
    let totalPassed = 0;
    let totalFailed = 0;
    
    // Execute each iteration
    for (let i = 0; i < iterations.length; i++) {
      // Check if run was cancelled
      const currentRun = await prisma.run.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      
      if (currentRun?.status === 'CANCELLED') {
        publishProgress(runId, {
          type: 'run_failed',
          runId,
          error: 'Run was cancelled',
        });
        return;
      }
      
      const iteration = iterations[i];
      const rowData = rows[i];
      
      // Update iteration status
      await prisma.iteration.update({
        where: { id: iteration.id },
        data: {
          status: 'RUNNING',
          startedAt: new Date(),
        },
      });
      
      publishProgress(runId, {
        type: 'iteration_started',
        runId,
        iterationIndex: i,
        totalIterations: iterations.length,
      });
      
      // Build variables for this iteration
      const variables: Record<string, string> = { ...envVariables };
      for (const [csvColumn, collectionVar] of Object.entries(variableMapping)) {
        if (rowData[csvColumn] !== undefined) {
          variables[collectionVar] = rowData[csvColumn];
        }
      }
      
      let iterationPassed = 0;
      let iterationFailed = 0;
      
      // Execute each request in the collection
      for (let j = 0; j < requests.length; j++) {
        const request = requests[j];
        
        publishProgress(runId, {
          type: 'request_started',
          runId,
          iterationIndex: i,
          requestIndex: j,
          requestName: request.name,
        });
        
        const result = await executeAndRecordRequest(
          iteration.id,
          j,
          request,
          variables
        );
        
        if (result.passed) {
          iterationPassed++;
          totalPassed++;
        } else {
          iterationFailed++;
          totalFailed++;
        }
        
        publishProgress(runId, {
          type: 'request_completed',
          runId,
          iterationIndex: i,
          requestIndex: j,
          requestName: request.name,
          passed: result.passed,
          responseStatus: result.responseStatus,
          responseTimeMs: result.responseTimeMs,
        });
      }
      
      // Update iteration status
      await prisma.iteration.update({
        where: { id: iteration.id },
        data: {
          status: iterationFailed > 0 ? 'FAILED' : 'COMPLETED',
          passedCount: iterationPassed,
          failedCount: iterationFailed,
          completedAt: new Date(),
        },
      });
      
      // Update run progress
      await prisma.run.update({
        where: { id: runId },
        data: {
          completedIterations: i + 1,
          passedRequests: totalPassed,
          failedRequests: totalFailed,
        },
      });
      
      publishProgress(runId, {
        type: 'iteration_completed',
        runId,
        iterationIndex: i,
        passedCount: iterationPassed,
        failedCount: iterationFailed,
      });
    }
    
    // Update run to completed
    await prisma.run.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
    
    publishProgress(runId, {
      type: 'run_completed',
      runId,
      totalPassed,
      totalFailed,
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    await prisma.run.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        errorMessage,
        completedAt: new Date(),
      },
    });
    
    publishProgress(runId, {
      type: 'run_failed',
      runId,
      error: errorMessage,
    });
    
    throw error;
  }
}

/**
 * Execute a single request and record the result
 */
async function executeAndRecordRequest(
  iterationId: string,
  requestIndex: number,
  request: FlattenedRequest,
  variables: Record<string, string>
): Promise<{ passed: boolean; responseStatus?: number; responseTimeMs?: number }> {
  // Substitute variables
  const substitutedRequest = substituteRequestVariables(request, variables);
  
  try {
    const response = await executeRequest(substitutedRequest);
    
    // Run test scripts if present
    let testResults: TestResult[] = [];
    let passed = response.status >= 200 && response.status < 300;
    
    if (request.testScript && request.testScript.length > 0) {
      testResults = executeTestScript(request.testScript, {
        responseStatus: response.status,
        responseBody: response.body,
        responseHeaders: response.headers,
        responseTime: response.timeMs,
      });
      
      // If any test fails, the request fails
      if (testResults.some(t => !t.passed)) {
        passed = false;
      }
    }
    
    // Record result
    await prisma.requestResult.create({
      data: {
        iterationId,
        requestIndex,
        requestName: substitutedRequest.name,
        method: substitutedRequest.method,
        url: substitutedRequest.url,
        requestHeaders: substitutedRequest.headers,
        requestBody: typeof substitutedRequest.body?.content === 'string'
          ? substitutedRequest.body.content
          : JSON.stringify(substitutedRequest.body?.content),
        responseStatus: response.status,
        responseHeaders: response.headers,
        responseBody: response.body,
        responseTimeMs: response.timeMs,
        passed,
        testResults: testResults.length > 0 ? testResults : undefined,
      },
    });
    
    return { passed, responseStatus: response.status, responseTimeMs: response.timeMs };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Record failed request
    await prisma.requestResult.create({
      data: {
        iterationId,
        requestIndex,
        requestName: substitutedRequest.name,
        method: substitutedRequest.method,
        url: substitutedRequest.url,
        requestHeaders: substitutedRequest.headers,
        requestBody: typeof substitutedRequest.body?.content === 'string'
          ? substitutedRequest.body.content
          : JSON.stringify(substitutedRequest.body?.content),
        passed: false,
        errorMessage,
      },
    });
    
    return { passed: false };
  }
}
