/**
 * Neuromuscular load calculation — tonnage × intensity² model.
 *
 * calculateNeuromuscularLoad: raw score (unbounded) from lift data + 1RMs
 * normalizeNeuromuscularLoad: scales raw score to 0–100 against 90-day history
 */

import { getRecentEnrichedSessions } from "./kv";
import type { LiftData, LiftKey, OneRepMaxes } from "@/types";

export function calculateNeuromuscularLoad(
  liftData: LiftData[],
  oneRepMaxes: OneRepMaxes
): number {
  return liftData.reduce((total, lift) => {
    const orm = oneRepMaxes[lift.lift as LiftKey] ?? null;
    // If no 1RM on record, use 0.7 as provisional intensity ratio
    const ratio = orm && orm > 0 ? lift.topSetWeight / orm : 0.7;
    const reps = lift.topSetReps > 0 ? lift.topSetReps : 3;
    return total + reps * lift.topSetWeight * Math.pow(ratio, 2);
  }, 0);
}

export async function normalizeNeuromuscularLoad(raw: number): Promise<number> {
  // Collect neuromuscularLoad values from last 90 days
  const sessions = await getRecentEnrichedSessions(90);
  const loads = sessions
    .filter((s): s is NonNullable<typeof s> => s != null && s.neuromuscularLoad != null)
    .map((s) => s.neuromuscularLoad as number);

  if (loads.length < 3) {
    // Not enough history — use heuristic: assume 500 is a typical hard session
    return Math.min(Math.round((raw / 500) * 100), 100);
  }

  const min = Math.min(...loads);
  const max = Math.max(...loads);

  if (max === min) return 50; // all sessions identical — return midpoint

  return Math.min(Math.round(((raw - min) / (max - min)) * 100), 100);
}
