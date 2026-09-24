export class ApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

const apiUrl = import.meta.env.VITE_API_URL ?? "";

function getUrl(path: string): string {
  return `${apiUrl.replace(/\/$/, "")}${path}`;
}

// init is a rest tuple so a bare request(path) calls fetch(url) with no second argument.
export async function request<T>(path: string, ...init: [RequestInit?]): Promise<T> {
  const response = await fetch(getUrl(path), ...init);

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  // 204 carries no body (POST /logout).
  return (response.status === 204 ? undefined : await response.json()) as T;
}
