'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { collectionsApi, csvApi, formatApiError } from '@/lib/api';
import { Trash2, FileJson, FileSpreadsheet, Loader2 } from 'lucide-react';
import { FileDropzone } from './file-dropzone';

type Status = { variant: 'error' | 'success'; message: string } | null;

export function FilesManager() {
  const queryClient = useQueryClient();
  const [collectionStatus, setCollectionStatus] = useState<Status>(null);
  const [csvStatus, setCsvStatus] = useState<Status>(null);

  // Collections
  const { data: collections = [], isLoading: collectionsLoading } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionsApi.list,
  });

  const uploadCollectionMutation = useMutation({
    mutationFn: collectionsApi.upload,
    onSuccess: (collection) => {
      void queryClient.invalidateQueries({ queryKey: ['collections'] });
      setCollectionStatus({
        variant: 'success',
        message: `Uploaded "${collection.name}" — ${collection.requestCount} requests, ${collection.variableNames.length} variables detected.`,
      });
    },
    onError: (error) => {
      setCollectionStatus({ variant: 'error', message: formatApiError(error) });
    },
  });

  const deleteCollectionMutation = useMutation({
    mutationFn: collectionsApi.delete,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['collections'] });
      setCollectionStatus(null);
    },
    onError: (error) => {
      setCollectionStatus({ variant: 'error', message: formatApiError(error) });
    },
  });

  // CSV files
  const { data: csvFiles = [], isLoading: csvLoading } = useQuery({
    queryKey: ['csvFiles'],
    queryFn: csvApi.list,
  });

  const uploadCsvMutation = useMutation({
    mutationFn: csvApi.upload,
    onSuccess: (csv) => {
      void queryClient.invalidateQueries({ queryKey: ['csvFiles'] });
      setCsvStatus({
        variant: 'success',
        message: `Uploaded "${csv.name}" — ${csv.rowCount} rows, columns: ${csv.columnNames.join(', ')}.`,
      });
    },
    onError: (error) => {
      setCsvStatus({ variant: 'error', message: formatApiError(error) });
    },
  });

  const deleteCsvMutation = useMutation({
    mutationFn: csvApi.delete,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['csvFiles'] });
      setCsvStatus(null);
    },
    onError: (error) => {
      setCsvStatus({ variant: 'error', message: formatApiError(error) });
    },
  });

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Collections */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="w-5 h-5" />
            Postman Collections
          </CardTitle>
          <CardDescription>Manage your uploaded Postman Collection files</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FileDropzone
            accept={{ 'application/json': ['.json'] }}
            onDrop={(files) => {
              setCollectionStatus(null);
              uploadCollectionMutation.mutate(files[0]);
            }}
            onReject={(message) => setCollectionStatus({ variant: 'error', message })}
            description="Postman Collection v2.1 JSON"
            busy={uploadCollectionMutation.isPending}
          />

          {collectionStatus && (
            <Alert
              variant={collectionStatus.variant}
              message={collectionStatus.message}
              onDismiss={() => setCollectionStatus(null)}
            />
          )}

          {collectionsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : collections.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No collections uploaded</p>
          ) : (
            <div className="space-y-2">
              {collections.map((collection) => (
                <div
                  key={collection.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div>
                    <p className="font-medium">{collection.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {collection.requestCount} requests • {collection.variableNames.length} variables
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${collection.name}`}
                    onClick={() => deleteCollectionMutation.mutate(collection.id)}
                    disabled={deleteCollectionMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* CSV files */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" />
            CSV Files
          </CardTitle>
          <CardDescription>Manage your uploaded CSV data files</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FileDropzone
            accept={{ 'text/csv': ['.csv'] }}
            onDrop={(files) => {
              setCsvStatus(null);
              uploadCsvMutation.mutate(files[0]);
            }}
            onReject={(message) => setCsvStatus({ variant: 'error', message })}
            description="CSV with header row"
            busy={uploadCsvMutation.isPending}
          />

          {csvStatus && (
            <Alert
              variant={csvStatus.variant}
              message={csvStatus.message}
              onDismiss={() => setCsvStatus(null)}
            />
          )}

          {csvLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : csvFiles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No CSV files uploaded</p>
          ) : (
            <div className="space-y-2">
              {csvFiles.map((csv) => (
                <div key={csv.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-medium">{csv.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {csv.rowCount} rows • {csv.columnNames.length} columns
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${csv.name}`}
                    onClick={() => deleteCsvMutation.mutate(csv.id)}
                    disabled={deleteCsvMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
