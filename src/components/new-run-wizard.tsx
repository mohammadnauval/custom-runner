'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { FileDropzone } from '@/components/file-dropzone';
import { collectionsApi, csvApi, environmentsApi, runsApi, type Collection, type CsvFile, type Environment } from '@/lib/api';
import { ChevronLeft, ChevronRight, Play, Upload, FileJson, FileSpreadsheet } from 'lucide-react';

interface NewRunWizardProps {
  onRunStarted?: () => void;
}

type Step = 'select-files' | 'map-variables' | 'confirm';

export function NewRunWizard({ onRunStarted }: NewRunWizardProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('select-files');
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>('');
  const [selectedCsvId, setSelectedCsvId] = useState<string>('');
  const [selectedEnvId, setSelectedEnvId] = useState<string>('');
  const [variableMapping, setVariableMapping] = useState<Record<string, string>>({});
  const [isUploading, setIsUploading] = useState(false);

  // Fetch data
  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionsApi.list,
  });

  const { data: csvFiles = [] } = useQuery({
    queryKey: ['csvFiles'],
    queryFn: csvApi.list,
  });

  const { data: environments = [] } = useQuery({
    queryKey: ['environments'],
    queryFn: environmentsApi.list,
  });

  // Get selected items
  const selectedCollection = collections.find((c) => c.id === selectedCollectionId);
  const selectedCsv = csvFiles.find((c) => c.id === selectedCsvId);

  // Mutations
  const uploadCollectionMutation = useMutation({
    mutationFn: collectionsApi.upload,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      setSelectedCollectionId(data.id);
    },
  });

  const uploadCsvMutation = useMutation({
    mutationFn: csvApi.upload,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['csvFiles'] });
      setSelectedCsvId(data.id);
    },
  });

  const createRunMutation = useMutation({
    mutationFn: runsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      onRunStarted?.();
    },
  });

  // Handlers
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

  const handleStartRun = () => {
    createRunMutation.mutate({
      collectionId: selectedCollectionId,
      csvFileId: selectedCsvId,
      environmentId: selectedEnvId || undefined,
      variableMapping,
    });
  };

  const canProceedFromFiles = selectedCollectionId && selectedCsvId;
  const canStartRun = selectedCollectionId && selectedCsvId;

  // Auto-map variables when collection and CSV are selected
  const autoMapVariables = () => {
    if (!selectedCollection || !selectedCsv) return;
    
    const newMapping: Record<string, string> = {};
    for (const varName of selectedCollection.variableNames) {
      // Try exact match first
      if (selectedCsv.columnNames.includes(varName)) {
        newMapping[varName] = varName;
      } else {
        // Try case-insensitive match
        const match = selectedCsv.columnNames.find(
          col => col.toLowerCase() === varName.toLowerCase()
        );
        if (match) {
          newMapping[match] = varName;
        }
      }
    }
    setVariableMapping(newMapping);
  };

  return (
    <div className="space-y-6">
      {/* Step Indicator */}
      <div className="flex items-center justify-center space-x-4">
        <StepIndicator step={1} label="Select Files" active={step === 'select-files'} completed={step !== 'select-files'} />
        <div className="w-12 h-0.5 bg-muted" />
        <StepIndicator step={2} label="Map Variables" active={step === 'map-variables'} completed={step === 'confirm'} />
        <div className="w-12 h-0.5 bg-muted" />
        <StepIndicator step={3} label="Confirm & Run" active={step === 'confirm'} completed={false} />
      </div>

      {/* Step Content */}
      {step === 'select-files' && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Collection Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileJson className="w-5 h-5" />
                Postman Collection
              </CardTitle>
              <CardDescription>Select or upload a Postman Collection JSON file</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Select existing collection</Label>
                <Select value={selectedCollectionId} onValueChange={setSelectedCollectionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a collection..." />
                  </SelectTrigger>
                  <SelectContent>
                    {collections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.requestCount} requests)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">or upload new</span>
                </div>
              </div>

              <FileDropzone
                accept={{ 'application/json': ['.json'] }}
                onDrop={handleCollectionUpload}
                description="Postman Collection v2.1 JSON"
                disabled={isUploading}
              />

              {selectedCollection && (
                <div className="p-3 bg-muted rounded-md text-sm">
                  <p className="font-medium">{selectedCollection.name}</p>
                  <p className="text-muted-foreground">
                    {selectedCollection.requestCount} requests, {selectedCollection.variableNames.length} variables
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* CSV Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5" />
                CSV Data File
              </CardTitle>
              <CardDescription>Select or upload a CSV file with test data</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Select existing CSV</Label>
                <Select value={selectedCsvId} onValueChange={setSelectedCsvId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a CSV file..." />
                  </SelectTrigger>
                  <SelectContent>
                    {csvFiles.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.rowCount} rows)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">or upload new</span>
                </div>
              </div>

              <FileDropzone
                accept={{ 'text/csv': ['.csv'] }}
                onDrop={handleCsvUpload}
                description="CSV with header row"
                disabled={isUploading}
              />

              {selectedCsv && (
                <div className="p-3 bg-muted rounded-md text-sm">
                  <p className="font-medium">{selectedCsv.name}</p>
                  <p className="text-muted-foreground">
                    {selectedCsv.rowCount} rows, {selectedCsv.columnNames.length} columns
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {step === 'map-variables' && selectedCollection && selectedCsv && (
        <Card>
          <CardHeader>
            <CardTitle>Variable Mapping</CardTitle>
            <CardDescription>Map CSV columns to collection variables</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Environment Selection */}
            <div className="space-y-2">
              <Label>Environment (optional)</Label>
              <Select value={selectedEnvId} onValueChange={setSelectedEnvId}>
                <SelectTrigger>
                  <SelectValue placeholder="No environment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No environment</SelectItem>
                  {environments.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Variable Mapping */}
            <div className="space-y-3">
              <Label>Map Collection Variables to CSV Columns</Label>
              {selectedCollection.variableNames.length === 0 ? (
                <p className="text-sm text-muted-foreground">No variables found in collection</p>
              ) : (
                <div className="grid gap-3">
                  {selectedCollection.variableNames.map((varName) => (
                    <div key={varName} className="flex items-center gap-3">
                      <code className="flex-1 px-2 py-1 bg-muted rounded text-sm">{`{{${varName}}}`}</code>
                      <span className="text-muted-foreground">→</span>
                      <Select
                        value={Object.entries(variableMapping).find(([, v]) => v === varName)?.[0] || ''}
                        onValueChange={(value) => {
                          setVariableMapping((prev) => {
                            // Remove previous mapping for this variable
                            const newMapping = { ...prev };
                            for (const [k, v] of Object.entries(newMapping)) {
                              if (v === varName) {
                                delete newMapping[k];
                              }
                            }
                            // Add new mapping if a column is selected
                            if (value) {
                              newMapping[value] = varName;
                            }
                            return newMapping;
                          });
                        }}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select CSV column..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Not mapped</SelectItem>
                          {selectedCsv.columnNames.map((col) => (
                            <SelectItem key={col} value={col}>
                              {col}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'confirm' && selectedCollection && selectedCsv && (
        <Card>
          <CardHeader>
            <CardTitle>Confirm Run</CardTitle>
            <CardDescription>Review your configuration before starting</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label className="text-muted-foreground">Collection</Label>
                <p className="font-medium">{selectedCollection.name}</p>
                <p className="text-sm text-muted-foreground">{selectedCollection.requestCount} requests</p>
              </div>
              <div>
                <Label className="text-muted-foreground">CSV File</Label>
                <p className="font-medium">{selectedCsv.name}</p>
                <p className="text-sm text-muted-foreground">{selectedCsv.rowCount} iterations</p>
              </div>
            </div>

            <div>
              <Label className="text-muted-foreground">Total Requests</Label>
              <p className="font-medium text-lg">
                {selectedCollection.requestCount * selectedCsv.rowCount} requests
              </p>
            </div>

            {Object.keys(variableMapping).length > 0 && (
              <div>
                <Label className="text-muted-foreground">Variable Mappings</Label>
                <div className="mt-1 space-y-1">
                  {Object.entries(variableMapping).map(([csvCol, varName]) => (
                    <p key={csvCol} className="text-sm">
                      <code className="bg-muted px-1 rounded">{csvCol}</code> → <code className="bg-muted px-1 rounded">{`{{${varName}}}`}</code>
                    </p>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Navigation Buttons */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => {
            if (step === 'map-variables') setStep('select-files');
            else if (step === 'confirm') setStep('map-variables');
          }}
          disabled={step === 'select-files'}
        >
          <ChevronLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        {step !== 'confirm' ? (
          <Button
            onClick={() => {
              if (step === 'select-files') {
                autoMapVariables();
                setStep('map-variables');
              } else if (step === 'map-variables') {
                setStep('confirm');
              }
            }}
            disabled={!canProceedFromFiles}
          >
            Next
            <ChevronRight className="w-4 h-4 ml-2" />
          </Button>
        ) : (
          <Button
            onClick={handleStartRun}
            disabled={!canStartRun || createRunMutation.isPending}
            variant="success"
          >
            <Play className="w-4 h-4 mr-2" />
            {createRunMutation.isPending ? 'Starting...' : 'Start Run'}
          </Button>
        )}
      </div>
    </div>
  );
}

function StepIndicator({ step, label, active, completed }: { step: number; label: string; active: boolean; completed: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
          active
            ? 'bg-primary text-primary-foreground'
            : completed
            ? 'bg-primary/20 text-primary'
            : 'bg-muted text-muted-foreground'
        }`}
      >
        {step}
      </div>
      <span className={`text-sm mt-1 ${active ? 'font-medium' : 'text-muted-foreground'}`}>{label}</span>
    </div>
  );
}
