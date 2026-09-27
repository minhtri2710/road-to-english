import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppHeader } from "../components/AppHeader";
import { harnessAct } from "../test/app";
import { useDailyGoal } from "./useDailyGoal";

describe("useDailyGoal", () => {
  let root: Root;
  let container: HTMLDivElement;
  let goal: ReturnType<typeof useDailyGoal>;
  const headerProps = {
    storageKept: true,
    storageError: null,
    backupError: null,
    syncLine: null,
    auth: {
      user: null,
      loading: false,
      error: null,
      expired: false,
      signIn: async () => undefined,
      signUp: async () => undefined,
      signOut: async () => undefined,
      expire: () => undefined,
      clearError: () => undefined,
    },
    view: "library" as const,
    due: 0,
    onNavigate: () => undefined,
  };

  function Probe({ actionsToday }: { actionsToday: number }) {
    goal = useDailyGoal(actionsToday);
    return <AppHeader {...headerProps} goalAnnounced={goal.goalAnnounced} />;
  }

  const render = async (actionsToday: number) => {
    await harnessAct(async () => {
      root.render(<Probe actionsToday={actionsToday} />);
    });
  };

  beforeEach(async () => {
    localStorage.setItem("road-to-english.dailyGoal", "5");
    container = document.createElement("div");
    root = createRoot(container);
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
    expect(container.querySelector('[data-motion="milestone"]')).toBeNull();
  });

  it("shows the daily-goal celebration only on the false-to-true announcement edge", async () => {
    await harnessAct(() => goal.practiceCommitted(5));
    await render(5);
    expect(container.querySelectorAll('[data-motion="milestone"]')).toHaveLength(1);
    await render(5);
    expect(container.querySelectorAll('[data-motion="milestone"]')).toHaveLength(1);
  });
});
