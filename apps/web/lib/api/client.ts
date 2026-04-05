/**
 * Thin fetch wrappers with consistent error handling, timeouts, and type
 * safety.  All pages and hooks should use these instead of calling fetch()
 * directly.
 *
 * Error semantics:
 *   - Non-2xx HTTP responses throw `ApiError(status, message)`.
 *   - Network failures (offline, DNS, abort) throw `NetworkError`.
 *   - JSON parse failures from a 2xx response throw `NetworkError`.
 */

import { ApiError, NetworkError } from './errors';

const DEFAULT_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new NetworkError(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw new NetworkError(`Network error for ${url}`, err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Perform a GET request and parse the JSON response.
 *
 * @throws {ApiError}    on non-2xx HTTP status
 * @throws {NetworkError} on network / timeout / JSON parse failure
 */
export async function apiGet<T>(url: string, timeoutMs?: number): Promise<T> {
  const response = await fetchWithTimeout(url, {
    cache: 'no-store',
    timeoutMs,
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) {
      throw new ApiError(response.status, `HTTP ${response.status}`);
    }
    throw new NetworkError(`Failed to parse JSON response from ${url}`);
  }

  if (!response.ok) {
    const msg =
      typeof (payload as Record<string, unknown>)?.error === 'string'
        ? (payload as Record<string, unknown>).error as string
        : `HTTP ${response.status}`;
    throw new ApiError(response.status, msg);
  }

  return payload as T;
}

/**
 * Perform a POST request with a JSON body.
 *
 * @throws {ApiError}    on non-2xx HTTP status
 * @throws {NetworkError} on network / timeout / JSON parse failure
 */
export async function apiPost<T = unknown>(
  url: string,
  body: unknown,
  timeoutMs?: number,
): Promise<T> {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    timeoutMs,
  });

  let payload: unknown = null;
  try {
    if (response.headers.get('content-length') !== '0') {
      payload = await response.json();
    }
  } catch {
    if (!response.ok) {
      throw new ApiError(response.status, `HTTP ${response.status}`);
    }
    throw new NetworkError(`Failed to parse JSON response from ${url}`);
  }

  if (!response.ok) {
    const msg =
      typeof (payload as Record<string, unknown>)?.error === 'string'
        ? (payload as Record<string, unknown>).error as string
        : `HTTP ${response.status}`;
    throw new ApiError(response.status, msg);
  }

  return payload as T;
}

/**
 * Perform a DELETE request.
 *
 * @throws {ApiError}    on non-2xx HTTP status
 * @throws {NetworkError} on network / timeout failure
 */
export async function apiDelete(url: string, timeoutMs?: number): Promise<void> {
  const response = await fetchWithTimeout(url, {
    method: 'DELETE',
    cache: 'no-store',
    timeoutMs,
  });

  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    try {
      const payload = await response.json();
      if (typeof (payload as Record<string, unknown>)?.error === 'string') {
        msg = (payload as Record<string, unknown>).error as string;
      }
    } catch { /* ignore body parse failure on error response */ }
    throw new ApiError(response.status, msg);
  }
}
