import { ApiError, getUrl } from "./lessons";

export interface AuthUser {
  id: string;
  email: string;
}

async function requestUser(
  path: "/signup" | "/login",
  email: string,
  password: string,
): Promise<AuthUser> {
  const response = await fetch(getUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: "include",
  });

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  return (await response.json()) as AuthUser;
}

export function signUp(email: string, password: string): Promise<AuthUser> {
  return requestUser("/signup", email, password);
}

export function signIn(email: string, password: string): Promise<AuthUser> {
  return requestUser("/login", email, password);
}

export async function signOut(): Promise<void> {
  const response = await fetch(getUrl("/logout"), {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new ApiError(response.status);
  }
}

export async function fetchMe(): Promise<AuthUser | null> {
  const response = await fetch(getUrl("/me"), {
    method: "GET",
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  return (await response.json()) as AuthUser;
}
