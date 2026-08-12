import {idToken} from './auth.js';
import {defaults} from './config.js';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${defaults.apiUrl}${path}`, {
    ...init,
    headers: {...init?.headers, authorization: `Bearer ${await idToken()}`, 'content-type': 'application/json'},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({error: response.statusText})) as {error?: string};
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
