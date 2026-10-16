let sessionToken = '';
export async function bootstrap(): Promise<void> {
  const response = await fetch('/api/bootstrap');
  if (!response.ok) throw new Error('本机服务无法访问');
  sessionToken = (await response.json()).token;
}
export function getToken(): string { return sessionToken; }
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers); headers.set('x-mwa-token', sessionToken);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type','application/json');
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (response.status === 204) return undefined as T;
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error?.message || '操作失败'), result.error);
  return result as T;
}
