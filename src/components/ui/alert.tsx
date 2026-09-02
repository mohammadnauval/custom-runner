'use client';

import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AlertProps {
  variant?: 'error' | 'success';
  message: string;
  onDismiss?: () => void;
  className?: string;
}

/**
 * Inline status message. Uses role="alert" so screen readers announce it as
 * soon as it appears.
 */
export function Alert({ variant = 'error', message, onDismiss, className }: AlertProps) {
  const isError = variant === 'error';
  const Icon = isError ? AlertCircle : CheckCircle2;

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border p-3 text-sm',
        isError
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-green-200 bg-green-50 text-green-800',
        className
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="flex-1 break-words">{message}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className={cn(
            'shrink-0 rounded p-0.5 transition-colors',
            isError ? 'hover:bg-red-100' : 'hover:bg-green-100'
          )}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
