'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { runsApi, type Iteration, type RequestResult } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { X, ChevronDown, ChevronRight, CheckCircle, AlertCircle } from 'lucide-react';

interface RunDetailDialogProps {
  runId: string;
  onClose: () => void;
}

export function RunDetailDialog({ runId, onClose }: RunDetailDialogProps) {
  const [expandedIteration, setExpandedIteration] = useState<string | null>(null);

  const { data: run, isLoading: runLoading } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => runsApi.get(runId),
  });

  const { data: iterations = [], isLoading: iterationsLoading } = useQuery({
    queryKey: ['run-iterations', runId],
    queryFn: () => runsApi.getIterations(runId),
  });

  const isLoading = runLoading || iterationsLoading;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-background rounded-lg shadow-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold">{run?.collection.name || 'Run Details'}</h2>
            {run && (
              <p className="text-sm text-muted-foreground">
                {run.csvFile.name} • {run.totalIterations} iterations
              </p>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">Loading...</div>
          ) : (
            <div className="space-y-2">
              {iterations.map((iteration) => (
                <IterationRow
                  key={iteration.id}
                  runId={runId}
                  iteration={iteration}
                  expanded={expandedIteration === iteration.id}
                  onToggle={() =>
                    setExpandedIteration(expandedIteration === iteration.id ? null : iteration.id)
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function IterationRow({
  runId,
  iteration,
  expanded,
  onToggle,
}: {
  runId: string;
  iteration: Iteration;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['iteration-requests', runId, iteration.id],
    queryFn: () => runsApi.getIterationRequests(runId, iteration.id),
    enabled: expanded,
  });

  const hasFailed = iteration.failedCount > 0;

  return (
    <div className="border rounded-lg">
      <button
        className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="font-medium">Iteration {iteration.rowIndex + 1}</span>
          <span className="text-sm text-muted-foreground">
            {Object.entries(iteration.rowData as Record<string, string>)
              .slice(0, 3)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1 text-green-600">
            <CheckCircle className="w-4 h-4" />
            {iteration.passedCount}
          </span>
          <span className={`flex items-center gap-1 ${hasFailed ? 'text-red-600' : 'text-muted-foreground'}`}>
            <AlertCircle className="w-4 h-4" />
            {iteration.failedCount}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t p-3 space-y-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading requests...</p>
          ) : (
            requests.map((request) => <RequestRow key={request.id} request={request} />)
          )}
        </div>
      )}
    </div>
  );
}

function RequestRow({ request }: { request: RequestResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`border rounded p-2 ${request.passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
      <button
        className="w-full flex items-center justify-between text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {request.passed ? (
            <CheckCircle className="w-4 h-4 text-green-600" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600" />
          )}
          <span className="font-mono text-xs bg-muted px-1 rounded">{request.method}</span>
          <span className="text-sm font-medium">{request.requestName}</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {request.responseStatus && <span>{request.responseStatus}</span>}
          {request.responseTimeMs && <span>{request.responseTimeMs}ms</span>}
        </div>
      </button>

      {expanded && (
        <div className="mt-2 pt-2 border-t space-y-2 text-sm">
          <div>
            <strong>URL:</strong> <span className="font-mono text-xs">{request.url}</span>
          </div>
          {request.errorMessage && (
            <div className="text-red-600">
              <strong>Error:</strong> {request.errorMessage}
            </div>
          )}
          {request.requestBody && (
            <div>
              <strong>Request Body:</strong>
              <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto max-h-32">
                {request.requestBody}
              </pre>
            </div>
          )}
          {request.responseBody && (
            <div>
              <strong>Response Body:</strong>
              <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto max-h-32">
                {request.responseBody}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
