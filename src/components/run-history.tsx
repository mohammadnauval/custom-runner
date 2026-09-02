'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { runsApi, type RunSummary, type RunStatus } from '@/lib/api';
import { useRunDriver } from '@/lib/use-run-driver';
import {
  RefreshCw,
  Trash2,
  Eye,
  XCircle,
  Download,
  CheckCircle,
  AlertCircle,
  Clock,
  Loader2,
} from 'lucide-react';
import { RunDetailDialog } from './run-detail-dialog';

const ACTIVE_STATUSES: RunStatus[] = ['PENDING', 'RUNNING'];

export function RunHistory() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['runs'],
    queryFn: () => runsApi.list({ limit: 50 }),
    // Poll faster while something is in flight
    refetchInterval: (query) => {
      const runs = query.state.data?.runs ?? [];
      return runs.some((r) => ACTIVE_STATUSES.includes(r.status)) ? 1500 : 10_000;
    },
  });

  const runs = useMemo(() => data?.runs ?? [], [data]);

  const activeRunIds = useMemo(
    () => runs.filter((r) => ACTIVE_STATUSES.includes(r.status)).map((r) => r.id),
    [runs]
  );

  const invalidateRuns = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['runs'] });
  }, [queryClient]);

  // Serverless has no background worker: the browser drives execution
  useRunDriver(activeRunIds, invalidateRuns);

  const cancelMutation = useMutation({
    mutationFn: runsApi.cancel,
    onSuccess: invalidateRuns,
  });

  const deleteMutation = useMutation({
    mutationFn: runsApi.delete,
    onSuccess: invalidateRuns,
  });

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Run History</CardTitle>
            <CardDescription>
              View past and ongoing test runs. Keep this tab open while a run executes.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : runs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No runs yet. Start a new run from the &quot;New Run&quot; tab.
            </div>
          ) : (
            <div className="space-y-4">
              {runs.map((run) => (
                <RunCard
                  key={run.id}
                  run={run}
                  onView={() => setSelectedRunId(run.id)}
                  onCancel={() => cancelMutation.mutate(run.id)}
                  onDelete={() => deleteMutation.mutate(run.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedRunId && (
        <RunDetailDialog runId={selectedRunId} onClose={() => setSelectedRunId(null)} />
      )}
    </>
  );
}

function RunCard({
  run,
  onView,
  onCancel,
  onDelete,
}: {
  run: RunSummary;
  onView: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const isActive = ACTIVE_STATUSES.includes(run.status);
  const progress =
    run.totalIterations > 0 ? (run.completedIterations / run.totalIterations) * 100 : 0;

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="font-medium">{run.collectionName}</h4>
          <p className="text-sm text-muted-foreground">
            {run.csvFileName} • {run.totalIterations} iterations
            {run.environmentName ? ` • ${run.environmentName}` : ''}
            {run.delayMs > 0 ? ` • ${run.delayMs}ms delay` : ''}
          </p>
        </div>
        <StatusBadge status={run.status} />
      </div>

      {isActive && (
        <div className="mb-3 space-y-1">
          <Progress value={progress} className="h-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {run.completedIterations} / {run.totalIterations} iterations
            </span>
            <span className="flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Executing
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1 text-green-600">
            <CheckCircle className="w-4 h-4" />
            {run.passedRequests} passed
          </span>
          <span className="flex items-center gap-1 text-red-600">
            <AlertCircle className="w-4 h-4" />
            {run.failedRequests} failed
          </span>
          <span className="text-muted-foreground">
            {new Date(run.createdAt).toLocaleString()}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onView} aria-label="View run details">
            <Eye className="w-4 h-4" />
          </Button>
          {!isActive && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Download results as CSV"
              onClick={() => window.open(`/api/runs/${run.id}/export/csv`, '_blank')}
            >
              <Download className="w-4 h-4" />
            </Button>
          )}
          {isActive && (
            <Button variant="ghost" size="sm" onClick={onCancel} aria-label="Cancel run">
              <XCircle className="w-4 h-4" />
            </Button>
          )}
          {!isActive && (
            <Button variant="ghost" size="sm" onClick={onDelete} aria-label="Delete run">
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: RunStatus }) {
  const config = {
    PENDING: { icon: Clock, label: 'Pending', className: 'bg-yellow-100 text-yellow-800' },
    RUNNING: { icon: Loader2, label: 'Running', className: 'bg-blue-100 text-blue-800' },
    COMPLETED: { icon: CheckCircle, label: 'Completed', className: 'bg-green-100 text-green-800' },
    FAILED: { icon: AlertCircle, label: 'Failed', className: 'bg-red-100 text-red-800' },
    CANCELLED: { icon: XCircle, label: 'Cancelled', className: 'bg-gray-100 text-gray-800' },
  };

  const { icon: Icon, label, className } = config[status];

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${className}`}
    >
      <Icon className={`w-3 h-3 ${status === 'RUNNING' ? 'animate-spin' : ''}`} />
      {label}
    </span>
  );
}
