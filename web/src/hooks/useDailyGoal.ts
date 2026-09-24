import { useEffect, useState } from "react";

import { readPref, writePref } from "../lib/prefs";

export const DAILY_GOALS = ["5", "10", "20"] as const;
export type DailyGoal = (typeof DAILY_GOALS)[number];
const DAILY_GOAL_KEY = "road-to-english.dailyGoal";

function readDailyGoal(): DailyGoal {
  const stored = readPref(DAILY_GOAL_KEY);
  return DAILY_GOALS.find((goal) => goal === stored) ?? "10";
}

// The stored daily goal, whether today's practice meets it, and whether to announce that it was met.
// Only the learner's own action announces: a practice save whose committed count reaches the goal, or choosing a goal
// today's practice already meets. A reload (page load, sync, import) that meets the goal stays quiet.
export function useDailyGoal(actionsToday: number) {
  const [dailyGoal, setDailyGoal] = useState(readDailyGoal);
  const goalMet = actionsToday >= Number(dailyGoal);
  const [goalAnnounced, setGoalAnnounced] = useState(false);

  useEffect(() => {
    if (!goalMet) {
      setGoalAnnounced(false);
    }
  }, [goalMet]);

  // Saves commit one at a time, so exactly one committed count equals the goal, however saves overlap or fail.
  // The goal is read from the store, not this render, so a goal chosen while the save was in flight counts.
  const practiceCommitted = (actions: number) => {
    if (actions === Number(readDailyGoal())) {
      setGoalAnnounced(true);
    }
  };

  const chooseGoal = (goal: DailyGoal) => {
    writePref(DAILY_GOAL_KEY, goal);
    setDailyGoal(goal);
    if (!goalMet && actionsToday >= Number(goal)) {
      setGoalAnnounced(true);
    }
  };

  return { dailyGoal, goalMet, goalAnnounced, practiceCommitted, chooseGoal };
}
