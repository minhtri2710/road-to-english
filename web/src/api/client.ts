export class ApiError extends Error {
  readonly status: number;
  // Seconds to wait before retrying, from a 429's Retry-After; null when absent or not delta-seconds.
  readonly retryAfter: number | null;
  // The server's {"error": "..."} message; null when the body is not that JSON shape.
  readonly code: string | null;

  constructor(status: number, retryAfter: number | null, code: string | null = null) {
    super(`Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = retryAfter;
    this.code = code;
  }
}

// fetch itself rejected: no response arrived. The original error is the cause and its message is kept.
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "NetworkError";
  }
}

const apiUrl = import.meta.env.VITE_API_URL ?? "";

function getUrl(path: string): string {
  return `${apiUrl.replace(/\/$/, "")}${path}`;
}

function retryAfterSeconds(response: Response): number | null {
  const value = response.headers.get("Retry-After") ?? "";
  const seconds = Number(value);
  return response.status === 429 && /^\d+$/.test(value) && seconds > 0 && Number.isSafeInteger(seconds) ? seconds : null;
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = JSON.parse(await response.text());
    const error: unknown = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
    return typeof error === "string" ? error : null;
  } catch {
    return null;
  }
}

// init is a rest tuple so a bare request(path) calls fetch(url) with no second argument.
export async function request<T>(path: string, ...init: [RequestInit?]): Promise<T> {
  let response: Response;
  try {
    response = await fetch(getUrl(path), ...init);
  } catch (error) {
    throw new NetworkError(error);
  }

  if (!response.ok) {
    throw new ApiError(response.status, retryAfterSeconds(response), await errorCode(response));
  }

  // 204 carries no body (POST /logout).
  return (response.status === 204 ? undefined : await response.json()) as T;
}
