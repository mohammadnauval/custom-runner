'use client';

import { useCallback } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Loader2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileDropzoneProps {
  accept: Record<string, string[]>;
  onDrop: (files: File[]) => void;
  /** Called when the browser or dropzone rejects a file, so callers can show why. */
  onReject?: (message: string) => void;
  className?: string;
  description?: string;
  disabled?: boolean;
  busy?: boolean;
}

/** Turn react-dropzone's rejection codes into something a user can act on. */
function describeRejection(rejections: FileRejection[], accept: Record<string, string[]>): string {
  const extensions = Object.values(accept).flat().join(', ');
  const first = rejections[0];

  if (!first) {
    return 'That file could not be accepted.';
  }

  const codes = new Set(first.errors.map((e) => e.code));

  if (codes.has('file-invalid-type')) {
    return `"${first.file.name}" is not a supported file type. Expected ${extensions}.`;
  }

  if (codes.has('too-many-files')) {
    return 'Please add one file at a time.';
  }

  if (codes.has('file-too-large')) {
    return `"${first.file.name}" is too large.`;
  }

  return first.errors.map((e) => e.message).join('; ');
}

export function FileDropzone({
  accept,
  onDrop,
  onReject,
  className,
  description,
  disabled,
  busy,
}: FileDropzoneProps) {
  const onDropAccepted = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onDrop(acceptedFiles);
      }
    },
    [onDrop]
  );

  const onDropRejected = useCallback(
    (rejections: FileRejection[]) => {
      onReject?.(describeRejection(rejections, accept));
    },
    [onReject, accept]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDropAccepted,
    onDropRejected,
    accept,
    maxFiles: 1,
    multiple: false,
    disabled: disabled || busy,
  });

  const inactive = disabled || busy;

  return (
    <div
      {...getRootProps()}
      className={cn(
        'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
        inactive ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        isDragActive
          ? 'border-primary bg-primary/5'
          : 'border-muted-foreground/25 hover:border-primary/50',
        className
      )}
    >
      <input {...getInputProps()} />

      {busy ? (
        <>
          <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin text-primary" aria-hidden="true" />
          <p className="text-muted-foreground">Uploading…</p>
        </>
      ) : (
        <>
          <Upload className="w-10 h-10 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          {isDragActive ? (
            <p className="text-primary">Drop the file here...</p>
          ) : (
            <>
              <p className="text-muted-foreground">Drag &amp; drop a file here, or click to select</p>
              {description && (
                <p className="text-sm text-muted-foreground/75 mt-2">{description}</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
