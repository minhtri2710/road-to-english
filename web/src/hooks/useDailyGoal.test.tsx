import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { harnessAct } from "../test/app";
import { useDailyGoal } from "./useDailyGoal";

describe("useDailyGoal", () => {
  let root: Root;
  let goal: ReturnType<typeof useDailyGoal>;

  function Probe({ actionsToday }: { actionsToday: number }) {
    goal = useDailyGoal(actionsToday);
    return null;
  }

  const render = async (actionsToday: number) => {
    await harnessAct(async () => {
      root.render(<Probe actionsToday={actionsToday} />);
    });
  };

  beforeEach(async () => {
    localStorage.setItem("road-to-english.dailyGoal", "5");
    root = createRoot(document.createElement("div"));
    await render(4);
  });

  afterEach(async () => {
    await harnessAct(async () => {
      root.unmount();
    });
    localStorage.removeItem("road-to-english.dailyGoal");
  });

  it("announces the goal when a practice save's committed count reaches it", async () => {
    await harnessAct(() => goal.practiceCommitted(5));
    expect(goal.goalAnnounced).toBe(true);
  });

  it("does not announce a committed count past the goal, which an earlier save reached", async () => {
    await harnessAct(() => goal.practiceCommitted(6));
    expect(goal.goalAnnounced).toBe(false);
  });

  it("does not announce a goal a reload meets", async () => {
    await render(5);
    expect(goal.goalAnnounced).toBe(false);
  });
});
