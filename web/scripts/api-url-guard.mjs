const MESSAGE = "VITE_API_URL is required for the dev server. Copy web/.env.example to web/.env and set VITE_API_URL.";

export function assertApiUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(MESSAGE);
  }
}
