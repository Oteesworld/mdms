/** JSON requests to the Laravel app with the session cookie and CSRF token. */

const xsrf = () => decodeURIComponent(document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/)?.[1] ?? '');

export class HttpError extends Error {
  constructor(public status: number, public body: { message?: string; errors?: Record<string, string[]> }) {
    super(body.message ?? `Request failed (${status})`);
  }
  /** First validation message for a field, or the general message. */
  field(name: string) {
    return this.body.errors?.[name]?.[0];
  }
}

export async function http<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-XSRF-TOKEN': xsrf(),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new HttpError(res.status, data);
  return data as T;
}
