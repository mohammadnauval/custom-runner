'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { environmentsApi, type Environment } from '@/lib/api';
import { Plus, Trash2, Edit, Save, X, Loader2, Settings } from 'lucide-react';

export function EnvironmentsManager() {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newVariables, setNewVariables] = useState<{ key: string; value: string }[]>([{ key: '', value: '' }]);

  const { data: environments = [], isLoading } = useQuery({
    queryKey: ['environments'],
    queryFn: environmentsApi.list,
  });

  const createMutation = useMutation({
    mutationFn: environmentsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments'] });
      setIsCreating(false);
      setNewName('');
      setNewVariables([{ key: '', value: '' }]);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; variables?: Record<string, string> } }) =>
      environmentsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments'] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: environmentsApi.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['environments'] }),
  });

  const handleCreate = () => {
    const variables: Record<string, string> = {};
    newVariables.forEach(({ key, value }) => {
      if (key.trim()) {
        variables[key.trim()] = value;
      }
    });

    createMutation.mutate({
      name: newName,
      variables,
    });
  };

  const addNewVariable = () => {
    setNewVariables([...newVariables, { key: '', value: '' }]);
  };

  const updateNewVariable = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...newVariables];
    updated[index][field] = value;
    setNewVariables(updated);
  };

  const removeNewVariable = (index: number) => {
    setNewVariables(newVariables.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Environments
            </CardTitle>
            <CardDescription>Manage reusable environment variables for your API tests</CardDescription>
          </div>
          {!isCreating && (
            <Button onClick={() => setIsCreating(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Environment
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Create New Environment Form */}
          {isCreating && (
            <div className="border rounded-lg p-4 space-y-4 bg-muted/50">
              <h4 className="font-medium">New Environment</h4>
              
              <div className="space-y-2">
                <Label htmlFor="env-name">Name</Label>
                <Input
                  id="env-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., Staging, Production"
                />
              </div>

              <div className="space-y-2">
                <Label>Variables</Label>
                {newVariables.map((variable, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder="Key"
                      value={variable.key}
                      onChange={(e) => updateNewVariable(index, 'key', e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Value"
                      value={variable.value}
                      onChange={(e) => updateNewVariable(index, 'value', e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeNewVariable(index)}
                      disabled={newVariables.length === 1}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addNewVariable}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Variable
                </Button>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsCreating(false);
                    setNewName('');
                    setNewVariables([{ key: '', value: '' }]);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!newName.trim() || createMutation.isPending}
                >
                  {createMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Create
                </Button>
              </div>
            </div>
          )}

          {/* Environment List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : environments.length === 0 && !isCreating ? (
            <div className="text-center py-8 text-muted-foreground">
              No environments yet. Create one to get started.
            </div>
          ) : (
            <div className="space-y-4">
              {environments.map((env) => (
                <EnvironmentCard
                  key={env.id}
                  environment={env}
                  isEditing={editingId === env.id}
                  onEdit={() => setEditingId(env.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={(data) => updateMutation.mutate({ id: env.id, data })}
                  onDelete={() => deleteMutation.mutate(env.id)}
                  isSaving={updateMutation.isPending}
                  isDeleting={deleteMutation.isPending}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EnvironmentCard({
  environment,
  isEditing,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  isSaving,
  isDeleting,
}: {
  environment: Environment;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (data: { name?: string; variables?: Record<string, string> }) => void;
  onDelete: () => void;
  isSaving: boolean;
  isDeleting: boolean;
}) {
  const [editName, setEditName] = useState(environment.name);
  const [editVariables, setEditVariables] = useState<{ key: string; value: string }[]>(
    Object.entries(environment.variables || {}).map(([key, value]) => ({ key, value }))
  );

  const handleSave = () => {
    const variables: Record<string, string> = {};
    editVariables.forEach(({ key, value }) => {
      if (key.trim()) {
        variables[key.trim()] = value;
      }
    });

    onSave({
      name: editName,
      variables,
    });
  };

  const addVariable = () => {
    setEditVariables([...editVariables, { key: '', value: '' }]);
  };

  const updateVariable = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...editVariables];
    updated[index][field] = value;
    setEditVariables(updated);
  };

  const removeVariable = (index: number) => {
    setEditVariables(editVariables.filter((_, i) => i !== index));
  };

  const variableCount = Object.keys(environment.variables || {}).length;

  if (isEditing) {
    return (
      <div className="border rounded-lg p-4 space-y-4">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>Variables</Label>
          {editVariables.map((variable, index) => (
            <div key={index} className="flex gap-2">
              <Input
                placeholder="Key"
                value={variable.key}
                onChange={(e) => updateVariable(index, 'key', e.target.value)}
                className="flex-1"
              />
              <Input
                placeholder="Value"
                value={variable.value}
                onChange={(e) => updateVariable(index, 'value', e.target.value)}
                className="flex-1"
              />
              <Button variant="ghost" size="icon" onClick={() => removeVariable(index)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addVariable}>
            <Plus className="w-4 h-4 mr-2" />
            Add Variable
          </Button>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancelEdit}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div>
          <h4 className="font-medium">{environment.name}</h4>
          <p className="text-sm text-muted-foreground">{variableCount} variables</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onEdit}>
            <Edit className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} disabled={isDeleting}>
            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {variableCount > 0 && (
        <div className="mt-3 space-y-1">
          {Object.entries(environment.variables || {}).map(([key, value]) => (
            <div key={key} className="flex gap-2 text-sm">
              <code className="bg-muted px-1 rounded">{key}</code>
              <span className="text-muted-foreground">=</span>
              <span className="text-muted-foreground truncate">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
