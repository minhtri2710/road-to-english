import { useSyncExternalStore } from "react";

import { readPref, writePref } from "../lib/prefs";
import { vi } from "./vi";

// The interface language. English is the source: each English string is its own key, and a
// Vietnamese entry replaces it when Vietnamese is on. A string with no entry stays English.
export type Lang = "en" | "vi";

export const LANG_KEY = "road-to-english.lang";

type Vars = Record<string, string | number>;

let current: Lang = readPref(LANG_KEY) === "vi" ? "vi" : "en";
const listeners = new Set<() => void>();

function applyDocumentLang(): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = current;
  }
}
applyDocumentLang();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  writePref(LANG_KEY, lang === "vi" ? "vi" : null);
  applyDocumentLang();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Translates an English string (a template with {name} holes) into the current language.
export function tr(text: string, vars?: Vars): string {
  const template = current === "vi" ? (vi[text] ?? text) : text;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (hole, name: string) => (name in vars ? String(vars[name]) : hole));
}

// The current language; a component that reads it re-renders when it changes.
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

// tr, for components: calling it subscribes the component to language changes.
export function useT(): typeof tr {
  useLang();
  return tr;
}
