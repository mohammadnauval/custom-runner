'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { collectionsApi, csvApi, type Collection, type CsvFile } from '@/lib/api';
import { Trash2, FileJson, FileSpreadsheet, Loader2 } from 'lucide-react';
import { FileDropzone } from './file-dropzone';
import { useState } from 'react';

export function FilesManager() {
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);

  // Collections
  const { data: collections = [], isLoading: collectionsLoading } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionsApi.list,
  });

  const uploadCollectionMutation = useMutation({
    mutationFn: collectionsApi.upload,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['collections'] }),
  });

  const deleteCollectionMutation = useMutation({
    mutationFn: collectionsApi.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['collections'] }),
  });

  // CSV Files
  const { data: csvFiles = [], isLoading: csvLoading } = useQuery({
    queryKey: ['csvFiles'],
    queryFn: csvApi.list,
  });

  const uploadCsvMutation = useMutation({
    mutationFn: csvApi.upload,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['csvFiles'] }),
  });

  const deleteCsvMutation = useMutation({
    mutationFn: csvApi.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['csvFiles'] }),
  });

  const handleCollectionUpload = async (files: File[]) => {
    if (files.length > 0) {
      setIsUploading(true);
      try {
        await uploadCollectionMutation.mutateAsync(files[0]);
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleCsvUpload = async (files: File[]) => {
    if (files.length > 0) {
      setIsUploading(true);
      try {
        await uploadCsvMutation.mutateAsync(files[0]);
      } finally {
        setIsUploading(false);
      }
    }
  };

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
            onDrop={handleCollectionUpload}
            description="Postman Collection v2.1 JSON"
            disabled={isUploading}
          />

          {collectionsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : collections.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No collections uploaded</p>
          ) : (
            <div className="space-y-2">
              {collections.map((collection) => (
                <div key={collection.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-medium">{collection.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {collection.requestCount} requests • {collection.variableNames.length} variables
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
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

      {/* CSV Files */}
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
            onDrop={handleCsvUpload}
            description="CSV with header row"
            disabled={isUploading}
          />

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
