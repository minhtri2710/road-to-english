import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useDailyGoal } from "./useDailyGoal";

describe("useDailyGoal", () => {
  let root: Root;
  let goal: ReturnType<typeof useDailyGoal>;

  function Probe({ actionsToday }: { actionsToday: number }) {
    goal = useDailyGoal(actionsToday);
    return null;
  }

  const render = async (actionsToday: number) => {
    await act(async () => {
      root.render(<Probe actionsToday={actionsToday} />);
    });
  };

  beforeEach(async () => {
    localStorage.setItem("road-to-english.dailyGoal", "5");
    root = createRoot(document.createElement("div"));
    await render(4);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    localStorage.removeItem("road-to-english.dailyGoal");
  });

  it("announces a goal met by a save that overlapped a failed one", async () => {
    goal.armGoal();
    goal.armGoal();
    goal.disarmGoal();
    await render(5);
    expect(goal.goalAnnounced).toBe(true);
  });

  it("keeps the announcement when the failure settles after the successful save", async () => {
    goal.armGoal();
    goal.armGoal();
    await render(5);
    goal.disarmGoal();
    expect(goal.goalAnnounced).toBe(true);
  });

  it("does not announce a goal a reload meets after a single failed save", async () => {
    goal.armGoal();
    goal.disarmGoal();
    await render(5);
    expect(goal.goalAnnounced).toBe(false);
  });
});
