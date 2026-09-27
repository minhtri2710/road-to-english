import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { harnessAct } from "../test/app";
import { GoalRing } from "./GoalRing";

describe("GoalRing", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await harnessAct(() => root?.unmount());
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it("transitions the ring when its practice value changes", async () => {
    container = document.createElement("div");
    root = createRoot(container);
    const render = (value: number) => root?.render(<GoalRing label={`${value} of 5 practice actions today`} value={value} max={5} goalMet={value >= 5} />);

    await harnessAct(() => render(0));
    const ring = container.querySelector('[role="progressbar"]');
    const fill = container.querySelectorAll("svg circle")[1];
    expect(ring?.getAttribute("aria-valuenow")).toBe("0");
    const before = fill?.getAttribute("stroke-dashoffset");
    expect(fill?.getAttribute("class")).not.toBe("");

    await harnessAct(() => render(1));
    expect(ring?.getAttribute("aria-valuenow")).toBe("1");
    expect(fill?.getAttribute("stroke-dashoffset")).not.toBe(before);
    expect(fill?.getAttribute("class")).not.toBe("");
  });
});
