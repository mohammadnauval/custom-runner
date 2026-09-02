'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NewRunWizard } from '@/components/new-run-wizard';
import { RunHistory } from '@/components/run-history';
import { FilesManager } from '@/components/files-manager';
import { EnvironmentsManager } from '@/components/environments-manager';

export default function Home() {
  const [activeTab, setActiveTab] = useState('new-run');

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="new-run">New Run</TabsTrigger>
        <TabsTrigger value="history">Run History</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="environments">Environments</TabsTrigger>
      </TabsList>
      
      <TabsContent value="new-run">
        <NewRunWizard onRunStarted={() => setActiveTab('history')} />
      </TabsContent>
      
      <TabsContent value="history">
        <RunHistory />
      </TabsContent>
      
      <TabsContent value="files">
        <FilesManager />
      </TabsContent>
      
      <TabsContent value="environments">
        <EnvironmentsManager />
      </TabsContent>
    </Tabs>
  );
}
