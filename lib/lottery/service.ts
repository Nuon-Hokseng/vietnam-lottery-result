import {
  predictShift,
  STATS_DAYS,
  type Shift,
  type ShiftPrediction,
} from "./predict.ts";
import { fetchAllSources } from "./sources.ts";
import { readDay, readDays, writeDraw, writePrediction } from "./store.ts";
import { addDays } from "./time.ts";
import type { Region, StoredDraw } from "./types.ts";
import { mergeReports } from "./verify.ts";

/**
 * Refresh orchestration shared by the background poller and the API routes.
 * State lives on globalThis because Next.js can load this module once per
 * bundle (instrumentation vs. route handlers) inside a single process.
 */
const g = globalThis as typeof globalThis & {
  __lotteryInflight?: Map<string, Promise<StoredDraw>>;
};
const inflight = (g.__lotteryInflight ??= new Map());

export interface RefreshOptions {
  /** Skip the network if this draw was already fetched this recently. */
  minIntervalMs?: number;
}

export async function refreshDraw(
  region: Region,
  date: string,
  { minIntervalMs = 0 }: RefreshOptions = {},
): Promise<StoredDraw> {
  const key = `${date}:${region}`;
  const running = inflight.get(key);
  if (running) return running; // concurrent callers share one fetch

  const job = (async () => {
    const previous = (await readDay(date))[region];
    if (
      previous &&
      minIntervalMs > 0 &&
      Date.now() - Date.parse(previous.lastAttemptAt) < minIntervalMs
    ) {
      return previous;
    }

    const reports = await fetchAllSources(region, date);
    const merged = mergeReports(region, date, reports, previous);
    await writeDraw(merged);

    const changed =
      !previous ||
      previous.status !== merged.status ||
      previous.verification !== merged.verification;
    if (changed) {
      const failing = reports.filter((r) => !r.ok).map((r) => r.id);
      console.log(
        `[lottery] ${date} ${region}: ${previous?.status ?? "none"} -> ${merged.status} ` +
          `(${merged.verification})` +
          (failing.length ? ` | failing: ${failing.join(", ")}` : ""),
      );
    }
    return merged;
  })().finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}

/**
 * The guess for a day and shift. Computed from earlier days only, then stored,
 * so it is identical before and after the result is released. Returns null
 * until enough history has been collected.
 */
export async function ensurePrediction(
  shift: Shift,
  date: string,
): Promise<ShiftPrediction | null> {
  const stored = (await readDay(date)).predictions?.[shift];
  if (stored) return stored;

  const dates = Array.from({ length: STATS_DAYS }, (_, i) =>
    addDays(date, -(i + 1)),
  );
  const days = Object.values(await readDays(dates));
  const prediction = predictShift(shift, date, days);
  if (prediction) await writePrediction(prediction);
  return prediction;
}
