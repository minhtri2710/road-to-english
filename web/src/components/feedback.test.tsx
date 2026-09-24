import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { click } from "../test/app";
import { ErrorBoundary } from "./feedback";

describe("ErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a fallback with Reload when a child throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const Broken = () => {
      throw new Error("boom");
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(ErrorBoundary, null, createElement(Broken)));
    });

    expect(container.querySelector("h1")?.textContent).toBe("Something went wrong");
    expect(container.textContent).toContain("progress on this device is kept");
    expect(consoleError).toHaveBeenCalled();
    await click(container, "Reload");
    expect(reload).toHaveBeenCalledOnce();
    await act(async () => {
      root.unmount();
    });
  });
});
