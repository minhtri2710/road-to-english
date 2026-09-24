export class ApiError extends Error {
  readonly status: number;
  // Seconds to wait before retrying, from a 429's Retry-After; null when absent or not delta-seconds.
  readonly retryAfter: number | null;

  constructor(status: number, retryAfter: number | null) {
    super(`Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = retryAfter;
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

// init is a rest tuple so a bare request(path) calls fetch(url) with no second argument.
export async function request<T>(path: string, ...init: [RequestInit?]): Promise<T> {
  const response = await fetch(getUrl(path), ...init);

  if (!response.ok) {
    throw new ApiError(response.status, retryAfterSeconds(response));
  }

  // 204 carries no body (POST /logout).
  return (response.status === 204 ? undefined : await response.json()) as T;
}
