import { buildShiftView, type ShiftView } from "./derive.ts";
import { HISTORY_DAYS, pollerStatus } from "./poller.ts";
import { STATS_DAYS } from "./predict.ts";
import { LEAD_MS, planFor } from "./schedule.ts";
import type { ShiftPrediction } from "./predict.ts";
import { ensurePrediction, refreshDraw } from "./service.ts";
import { readDay } from "./store.ts";
import {
  drawInstant,
  isValidDateKey,
  recentDates,
  vnDateKey,
} from "./time.ts";
import type { DrawStatus, Region, Verification } from "./types.ts";

export interface HistoryEntry {
  date: string;
  day: { status: DrawStatus; verification: Verification };
  night: { status: DrawStatus; verification: Verification };
}

export interface ResultsPayload {
  date: string;
  today: string;
  serverTime: string;
  day: ShiftView;
  night: ShiftView;
  /** Newest first: today and the previous seven days. */
  history: HistoryEntry[];
  /** One 3-digit guess per pos; null until enough history is on file. */
  prediction: { day: ShiftPrediction | null; night: ShiftPrediction | null };
  /** When each shift of the selected date is drawn. */
  drawsAt: { day: string; night: string };
  /** True while a result on the selected date is being released. */
  live: boolean;
  /** Suggested client refresh interval. */
  pollHintMs: number;
  poller: ReturnType<typeof pollerStatus>;
}

/** Only today and the previous seven days are served. */
export function resolveDate(
  requested: string | null,
  now: Date = new Date(),
): { date: string } | { error: string } {
  const today = vnDateKey(now);
  if (!requested) return { date: today };
  if (!isValidDateKey(requested)) return { error: "date must be YYYY-MM-DD" };
  const allowed = recentDates(HISTORY_DAYS, now);
  if (!allowed.includes(requested)) {
    return {
      error: `date must be between ${allowed[allowed.length - 1]} and ${today}`,
    };
  }
  return { date: requested };
}

const REGIONS: Region[] = ["mn", "mb"];

/**
 * If the poller is not alive (serverless, or just restarted) a viewer still
 * triggers a fetch for any draw that is due. Fetches are shared with the
 * poller and throttled, so this never doubles the load.
 */
async function freshenIfDue(date: string, now: Date): Promise<void> {
  const isToday = date === vnDateKey(now);
  await Promise.all(
    REGIONS.map(async (region) => {
      const stored = (await readDay(date))[region];
      const plan = planFor(date, region, stored, now, 0);
      if (!plan.fetchNow || plan.recheckInMs === null) return;
      // Today: at most one fetch per 10 s. Past days: follow the backfill pace.
      const minIntervalMs = isToday
        ? Math.min(plan.recheckInMs, 10_000)
        : plan.recheckInMs;
      await Promise.race([
        refreshDraw(region, date, { minIntervalMs }),
        new Promise((resolve) => setTimeout(resolve, 9_000)),
      ]);
    }),
  );
}

/**
 * Without a running poller (serverless) the history behind the guess numbers
 * is collected by visitors: each call fills in a few missing earlier days.
 */
async function backfillSome(now: Date): Promise<void> {
  if (pollerStatus().running) return;
  const g = globalThis as typeof globalThis & { __lotteryBackfillAt?: number };
  if (Date.now() - (g.__lotteryBackfillAt ?? 0) < 5_000) return;
  g.__lotteryBackfillAt = Date.now();

  const todo: { region: Region; date: string }[] = [];
  for (const date of recentDates(STATS_DAYS, now).slice(1)) {
    const record = await readDay(date);
    for (const region of REGIONS) {
      if (record[region]?.status !== "complete") todo.push({ region, date });
    }
    if (todo.length >= 4) break;
  }
  await Promise.race([
    Promise.all(
      todo.map((job) =>
        refreshDraw(job.region, job.date, { minIntervalMs: 10 * 60_000 }),
      ),
    ),
    new Promise((resolve) => setTimeout(resolve, 8_000)),
  ]);
}

export async function buildResults(date: string): Promise<ResultsPayload> {
  const now = new Date();
  // Fresh data is a bonus: if fetching or guess generation fails, the stored
  // results must still be served.
  await freshenIfDue(date, now).catch((err) =>
    console.error("[lottery] refresh on request failed:", err),
  );

  await backfillSome(now).catch((err) =>
    console.error("[lottery] backfill failed:", err),
  );

  const guess = (shift: "day" | "night") =>
    ensurePrediction(shift, date).catch((err) => {
      console.error(`[lottery] guess ${shift} failed:`, err);
      return null;
    });
  const [predDay, predNight] = await Promise.all([guess("day"), guess("night")]);

  const record = await readDay(date);
  const day = buildShiftView("day", date, record.mn);
  const night = buildShiftView("night", date, record.mb);

  const history: HistoryEntry[] = await Promise.all(
    recentDates(HISTORY_DAYS, now).map(async (d) => {
      const r = d === date ? record : await readDay(d);
      return {
        date: d,
        day: {
          status: r.mn?.status ?? "pending",
          verification: r.mn?.verification ?? "pending",
        },
        night: {
          status: r.mb?.status ?? "pending",
          verification: r.mb?.verification ?? "pending",
        },
      };
    }),
  );

  const today = vnDateKey(now);
  const unfinished = day.status !== "complete" || night.status !== "complete";
  const releasing =
    date === today &&
    (
      [
        [day, "mn"],
        [night, "mb"],
      ] as const
    ).some(
      ([view, region]) =>
        view.status !== "complete" &&
        now.getTime() >= drawInstant(date, region).getTime() - LEAD_MS,
    );

  return {
    date,
    today,
    serverTime: now.toISOString(),
    day,
    night,
    history,
    prediction: { day: predDay, night: predNight },
    drawsAt: {
      day: drawInstant(date, "mn").toISOString(),
      night: drawInstant(date, "mb").toISOString(),
    },
    live: releasing,
    pollHintMs: releasing ? 10_000 : date === today && unfinished ? 30_000 : 60_000,
    poller: pollerStatus(),
  };
}
