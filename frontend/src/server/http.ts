import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function badRequest(error: string, details?: unknown) {
  return NextResponse.json({ error, details }, { status: 400 });
}

export function notFound(error = 'Not found') {
  return NextResponse.json({ error }, { status: 404 });
}

export function conflict(error: string, details?: unknown) {
  return NextResponse.json({ error, details }, { status: 409 });
}

export function serverError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unexpected error';
  console.error('[api]', error);
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * Wrap a route handler so unexpected errors return JSON instead of an HTML
 * error page, and Zod issues surface as 400s.
 */
export async function handle<T>(fn: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ZodError) {
      return badRequest('Validation error', error.issues);
    }
    return serverError(error);
  }
}
