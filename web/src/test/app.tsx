import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";

import type { Lesson } from "../api/lessons";
import { App } from "../App";
import { todayKey } from "../lib/progress";
import { getDailyCount } from "../lib/progressStore";
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

// React 19 act() scopes must not overlap: a scope that ends late or never nests every later act() and leaves
// its updates unflushed, so the rest of the file fails. A test that times out keeps running in the background,
// so every helper act belongs to the test that called the helper: resetApp ends that test and waits for its
// act in flight, and a helper of an ended test throws instead of starting another act.
const realSetTimeout = globalThis.setTimeout;
let currentTest = 0;
let actInFlight: Promise<unknown> = Promise.resolve();

async function harnessAct(callback: () => void | Promise<void>, test = currentTest): Promise<void> {
  if (test !== currentTest) {
    throw new Error("The test that called this helper has ended");
  }
  const scope = Promise.resolve(
    act(async () => {
      await callback();
    }),
  );
  actInFlight = scope.catch(() => undefined);
  await scope;
}

// One macrotask on the real clock, so fake timers cannot hold a helper act open.
const nextTask = () => new Promise<void>((resolve) => realSetTimeout(resolve, 0));

// Every root renderApp mounted and close has not yet closed; resetApp closes the rest.
const mounted = new Set<{ container: HTMLElement; root: Root }>();

export async function close(view: { container: HTMLElement; root: Root }): Promise<void> {
  mounted.delete(view);
  await harnessAct(() => {
    view.root.unmount();
  });
  view.container.remove();
}

// Renders the App as main.tsx does, in StrictMode, with fetch served by routeFetch.
export async function renderApp({ route, lesson }: { route?: FetchRoute; lesson?: Lesson } = {}): Promise<AppView> {
  routeFetch(route, lesson);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await harnessAct(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
  const view: AppView = { container, root, unmount: () => close(view) };
  mounted.add(view);
  return view;
}

// Renders the App and opens the Greetings & Basics row, served as `lesson`.
export async function openLesson(lesson: Lesson = greetingsLesson): Promise<AppView> {
  const view = await renderApp({ lesson });
  await harnessAct(() => {
    const button = Array.from(view.container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Greetings & Basics"),
    );
    button?.click();
  });
  return view;
}

// Opens the Greetings & Basics row once the library lists it.
export async function reopenGreetings(container: HTMLElement): Promise<void> {
  const row = () =>
    Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Greetings & Basics"));
  await waitForCondition(() => row() !== undefined);
  await harnessAct(() => {
    row()?.click();
  });
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
  await harnessAct(() => {
    button.click();
  });
  return button;
}

// The input a visible <label> with exactly this text names; a missing one fails the test.
export function inputLabelled(container: HTMLElement, text: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll("label")).find((candidate) => candidate.textContent === text);
  const input = label?.control;
  if (!(input instanceof HTMLInputElement)) throw new Error(`${text} input not found`);
  return input;
}

// The signed-out header's "Sign in" disclosure; a missing one fails the test.
export function accountDisclosure(container: HTMLElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")).find(
    (candidate) => candidate.textContent === "Sign in",
  );
  if (!button) throw new Error("Sign in disclosure not found");
  return button;
}

// Expands the signed-out account form if it is collapsed.
export async function openAccountForm(container: HTMLElement): Promise<void> {
  const disclosure = accountDisclosure(container);
  if (disclosure.getAttribute("aria-expanded") !== "true") {
    await harnessAct(() => {
      disclosure.click();
    });
  }
}

export const hasText = (container: HTMLElement, text: string) => () =>
  container.textContent?.includes(text) ?? false;

export async function waitForCondition(condition: () => boolean): Promise<void> {
  const test = currentTest;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) {
      return;
    }
    await harnessAct(nextTask, test);
  }

  throw new Error("Timed out waiting for condition");
}

// Today's practice actions as stored; lesson views show no count, the library's Today card does.
export async function actionsToday(): Promise<number> {
  return (await getDailyCount(todayKey(new Date())))?.actions ?? 0;
}

export async function waitForActions(count: number): Promise<void> {
  const test = currentTest;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await actionsToday()) === count) {
      return;
    }
    await harnessAct(nextTask, test);
  }

  throw new Error(`Timed out waiting for ${count} practice actions`);
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

const originalLocalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");

// Makes every localStorage access throw, as a browser does when site data is blocked; resetApp undoes it.
export function blockStorage(): void {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
}

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

// Every App test file runs this after each test; it first unmounts any App the test left mounted.
export async function resetApp(): Promise<void> {
  currentTest += 1;
  await actInFlight;
  for (const view of [...mounted]) {
    await close(view);
  }
  window.history.replaceState(null, "", "/");
  restoreProperty(window, "localStorage", originalLocalStorage);
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  restoreProperty(navigator, "mediaDevices", originalMediaDevices);
  restoreProperty(URL, "createObjectURL", originalCreateObjectURL);
  restoreProperty(URL, "revokeObjectURL", originalRevokeObjectURL);
}
