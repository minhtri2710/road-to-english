import { useEffect, useRef, useState } from "react";

import { readPref, writePref } from "../lib/prefs";

export const DAILY_GOALS = ["5", "10", "20"] as const;
export type DailyGoal = (typeof DAILY_GOALS)[number];
const DAILY_GOAL_KEY = "road-to-english.dailyGoal";

function readDailyGoal(): DailyGoal {
  const stored = readPref(DAILY_GOAL_KEY);
  return DAILY_GOALS.find((goal) => goal === stored) ?? "10";
}

// The stored daily goal, whether today's practice meets it, and whether to announce that it was met.
// armGoal marks the next count change as the user's practice action; disarmGoal withdraws one arm after a failed save,
// so a failure cannot silence the announcement owed to an overlapping save that succeeded.
export function useDailyGoal(actionsToday: number) {
  const [dailyGoal, setDailyGoal] = useState(readDailyGoal);
  const goalMet = actionsToday >= Number(dailyGoal);
  // Only a practice action or a goal change can announce the goal, so loading a met goal stays quiet.
  // Arms not yet withdrawn by a failed save.
  const goalArms = useRef(0);
  const goalMetBefore = useRef(goalMet);
  const [goalAnnounced, setGoalAnnounced] = useState(false);

  // Each count or goal change consumes the arm, so a later reload (sync, import) cannot announce on its own.
  useEffect(() => {
    const armed = goalArms.current > 0;
    goalArms.current = 0;
    if (goalMet !== goalMetBefore.current) {
      goalMetBefore.current = goalMet;
      setGoalAnnounced(goalMet && armed);
    }
  }, [actionsToday, dailyGoal, goalMet]);

  const armGoal = () => {
    goalArms.current += 1;
  };

  // The count change of an overlapping successful save may already have consumed every arm.
  const disarmGoal = () => {
    goalArms.current = Math.max(0, goalArms.current - 1);
  };

  const chooseGoal = (goal: DailyGoal) => {
    goalArms.current += 1;
    writePref(DAILY_GOAL_KEY, goal);
    setDailyGoal(goal);
  };

  return { dailyGoal, goalMet, goalAnnounced, armGoal, disarmGoal, chooseGoal };
}
