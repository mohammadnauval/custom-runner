'use client';

import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileDropzoneProps {
  accept: Record<string, string[]>;
  onDrop: (files: File[]) => void;
  className?: string;
  description?: string;
  disabled?: boolean;
}

export function FileDropzone({ accept, onDrop, className, description, disabled }: FileDropzoneProps) {
  const onDropCallback = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onDrop(acceptedFiles);
      }
    },
    [onDrop]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropCallback,
    accept,
    maxFiles: 1,
    disabled,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
        isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <input {...getInputProps()} />
      <Upload className="w-10 h-10 mx-auto mb-4 text-muted-foreground" />
      {isDragActive ? (
        <p className="text-primary">Drop the file here...</p>
      ) : (
        <>
          <p className="text-muted-foreground">Drag & drop a file here, or click to select</p>
          {description && <p className="text-sm text-muted-foreground/75 mt-2">{description}</p>}
        </>
      )}
    </div>
  );
}
