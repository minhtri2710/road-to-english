import { useEffect, useRef, useState } from "react";

export const DAILY_GOALS = ["5", "10", "20"] as const;
export type DailyGoal = (typeof DAILY_GOALS)[number];
const DAILY_GOAL_KEY = "road-to-english.dailyGoal";

function readDailyGoal(): DailyGoal {
  const stored = localStorage.getItem(DAILY_GOAL_KEY);
  return DAILY_GOALS.find((goal) => goal === stored) ?? "10";
}

// The stored daily goal, whether today's practice meets it, and whether to announce that it was met.
// armGoal marks the next count change as the user's practice action.
export function useDailyGoal(actionsToday: number) {
  const [dailyGoal, setDailyGoal] = useState(readDailyGoal);
  const goalMet = actionsToday >= Number(dailyGoal);
  // Only a practice action or a goal change can announce the goal, so loading a met goal stays quiet.
  const goalArmed = useRef(false);
  const goalMetBefore = useRef(goalMet);
  const [goalAnnounced, setGoalAnnounced] = useState(false);

  // Each count or goal change consumes the arm, so a later reload (sync, import) cannot announce on its own.
  useEffect(() => {
    const armed = goalArmed.current;
    goalArmed.current = false;
    if (goalMet !== goalMetBefore.current) {
      goalMetBefore.current = goalMet;
      setGoalAnnounced(goalMet && armed);
    }
  }, [actionsToday, dailyGoal, goalMet]);

  const armGoal = () => {
    goalArmed.current = true;
  };

  const chooseGoal = (goal: DailyGoal) => {
    goalArmed.current = true;
    localStorage.setItem(DAILY_GOAL_KEY, goal);
    setDailyGoal(goal);
  };

  return { dailyGoal, goalMet, goalAnnounced, armGoal, chooseGoal };
}
