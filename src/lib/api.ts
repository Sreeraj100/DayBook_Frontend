export type User = { id: string; email: string };
export type TodoStatus = 'pending' | 'in_progress' | 'completed';
export type TodoPriority = 'low' | 'medium' | 'high';
export type Recurrence = { frequency: 'daily' | 'weekly' | 'monthly'; interval: number; daysOfWeek?: number[]; dayOfMonth?: number; endDate?: string };
export type Subtask = { id: string; title: string; completed: boolean };
export type Todo = { _id: string; title: string; description: string; priority: TodoPriority; status: TodoStatus; dueAt?: string; dueTimeSet: boolean; label: string; subtasks: Subtask[]; recurrence?: Recurrence; completedAt?: string; createdAt: string; updatedAt: string };
export type TodoPageData = { items: Todo[]; page: number; limit: number; total: number; hasMore: boolean };
type ApiResult<T> = { success: true; data: T };
type ApiError = { success: false; error?: { message?: string } };

export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) { super(message); }
}

async function csrfToken() {
  const response = await fetch('/api/auth/csrf', { credentials: 'include' });
  const body = await response.json() as ApiResult<{ csrfToken: string }> | ApiError;
  if (!response.ok || !body.success) throw new Error(body.success === false ? body.error?.message ?? 'Could not start a secure session.' : 'Could not start a secure session.');
  return body.data.csrfToken;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (init.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase())) headers.set('X-CSRF-Token', await csrfToken());
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: 'include' });
  const body = await response.json() as ApiResult<T> | ApiError;
  if (!response.ok || !body.success) {
    const errorBody = body.success === false ? body.error as ({ message?: string; code?: string } | undefined) : undefined;
    throw new ApiRequestError(errorBody?.message ?? 'Request failed.', response.status, errorBody?.code);
  }
  return body;
}
