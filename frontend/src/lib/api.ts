// Small fetch wrapper for the OpenField API. Every error from the backend has
// the shape { success: false, code, message }; it is thrown as ApiError so
// pages can show the message or branch on the code.

const TOKEN_KEY = "openfield.token";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { path?: (string | number)[]; message: string }[]
  ) {
    super(message);
  }
}

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string | null) => {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable: session lasts until reload */
    }
  },
};

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function api<T = unknown>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const json = text ? (JSON.parse(text) as { data?: T; code?: string; message?: string; errors?: ApiError["details"] }) : {};
  if (!response.ok) {
    throw new ApiError(response.status, json.code ?? "ERROR", json.message ?? response.statusText, json.errors);
  }
  return json.data as T;
}

// A readable one-line message, including the first validation issue.
export const errorMessage = (error: unknown) => {
  if (error instanceof ApiError) {
    const first = error.details?.[0];
    return first ? `${error.message}: ${first.path?.join(".") || "input"} — ${first.message}` : error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong";
};
