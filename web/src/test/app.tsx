import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";

import type { Lesson } from "../api/lessons";
import { App } from "../App";
import { greetingsLesson, lessonSummaries } from "./fixtures";

// The App test harness: a fetch that serves the api, a StrictMode App, and DOM helpers.

export const fetchMock = vi.fn<typeof fetch>();

export function pathOf(input: Parameters<typeof fetch>[0]): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(url, "http://localhost").pathname;
}

export function callsTo(path: string): number {
  return fetchMock.mock.calls.filter(([input]) => pathOf(input) === path).length;
}

// Signed out, nothing to sync, the lesson summaries, and `lesson` for any lesson id.
export function responseFor(path: string, lesson: Lesson = greetingsLesson): Response {
  if (path === "/me") {
    return new Response(null, { status: 401 });
  }

  if (path === "/sync") {
    return new Response(JSON.stringify({ cards: [], practiceDays: [], lessonCompletion: [] }), {
      status: 200,
    });
  }

  if (path === "/lessons") {
    return new Response(JSON.stringify(lessonSummaries), { status: 200 });
  }

  return new Response(JSON.stringify(lesson), { status: 200 });
}

// /me for a signed-in user.
export function userResponse(): Response {
  return new Response(JSON.stringify({ id: "user-1", email: "restored@example.com" }), { status: 200 });
}

export type FetchRoute = (path: string) => Response | Promise<Response> | undefined;

// Serves each fetch from route, or from responseFor when route returns undefined.
export function routeFetch(route: FetchRoute = () => undefined, lesson?: Lesson): void {
  fetchMock.mockImplementation(async (input) => {
    const path = pathOf(input);
    return (await route(path)) ?? responseFor(path, lesson);
  });
  vi.stubGlobal("fetch", fetchMock);
}

export interface AppView {
  container: HTMLDivElement;
  root: Root;
  unmount: () => Promise<void>;
}

export async function close({ container, root }: { container: HTMLElement; root: Root }): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

// Renders the App as main.tsx does, in StrictMode, with fetch served by routeFetch.
export async function renderApp({ route, lesson }: { route?: FetchRoute; lesson?: Lesson } = {}): Promise<AppView> {
  routeFetch(route, lesson);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
  return { container, root, unmount: () => close({ container, root }) };
}

// Renders the App and opens the Greetings & Basics row, served as `lesson`.
export async function openLesson(lesson: Lesson = greetingsLesson): Promise<AppView> {
  const view = await renderApp({ lesson });
  await act(async () => {
    const button = Array.from(view.container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Greetings & Basics"),
    );
    button?.click();
  });
  return view;
}

export const h1Texts = (container: HTMLElement) => Array.from(container.querySelectorAll("h1")).map((h1) => h1.textContent);

export function buttonsNamed(container: HTMLElement, name: string): HTMLButtonElement[] {
  // ToggleButton repeats its label in an aria-hidden width reservation span.
  return Array.from(container.querySelectorAll("button")).filter((button) => {
    const visible = button.cloneNode(true) as HTMLElement;
    visible.querySelectorAll("[aria-hidden]").forEach((node) => node.remove());
    return visible.textContent === name;
  });
}

// Clicks the index-th button with exactly this visible name; a missing button fails the test.
export async function click(container: HTMLElement, name: string, index = 0): Promise<HTMLButtonElement> {
  const button = buttonsNamed(container, name)[index];
  if (!button) throw new Error(`${name} button not found`);
  await act(async () => {
    button.click();
  });
  return button;
}

export const hasText = (container: HTMLElement, text: string) => () =>
  container.textContent?.includes(text) ?? false;

export async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) {
      return;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  throw new Error("Timed out waiting for condition");
}

export function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function restoreProperty(
  target: object,
  key: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
  } else {
    delete (target as Record<string, unknown>)[key];
  }
}

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

// Every App test file runs this after each test.
export function resetApp(): void {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  restoreProperty(navigator, "mediaDevices", originalMediaDevices);
  restoreProperty(URL, "createObjectURL", originalCreateObjectURL);
  restoreProperty(URL, "revokeObjectURL", originalRevokeObjectURL);
}
