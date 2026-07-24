import { ApiError, ApiErrorBody } from './types';

export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...init?.headers },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message } };
    return json(body, { status: err.status });
  }
  console.error('Error no controlado:', err);
  return json({ error: { code: 'INTERNAL', message: 'Error interno del proxy.' } }, { status: 500 });
}
