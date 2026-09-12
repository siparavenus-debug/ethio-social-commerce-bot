export const PLATFORM_SESSION_KEY = "ethio-commerce-platform-token";
const baseUrl = (import.meta.env.VITE_API_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

export class PlatformApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// This client never reads merchant credentials or calls merchant routes.
export async function platformRequest<T>(path: string, token: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${baseUrl}/platform${path}`, {
    method, signal,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new PlatformApiError(data?.error || `Request failed (${response.status})`, response.status);
  if (!data) throw new Error("The API returned an empty or invalid response.");
  return data as T;
}
