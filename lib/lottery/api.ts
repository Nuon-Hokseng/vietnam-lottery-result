import { buildShiftView, type ShiftView } from "./derive.ts";
import { HISTORY_DAYS, pollerStatus } from "./poller.ts";
import { STATS_DAYS, type ShiftPrediction } from "./predict.ts";
import { LEAD_MS, planFor } from "./schedule.ts";
import { ensurePrediction, refreshDraw } from "./service.ts";
import { readDays } from "./store.ts";
import {
  drawInstant,
  isValidDateKey,
  recentDates,
  vnDateKey,
} from "./time.ts";
import type {
  DayRecord,
  DrawStatus,
  Region,
  Verification,
} from "./types.ts";

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
  /** True when this payload can never change again (a finished past day). */
  final: boolean;
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
 * triggers a fetch for any draw that is due. Finished days need no work at
 * all. Fetches are shared with the poller and throttled. Returns true when a
 * fetch ran, so the caller knows to re-read.
 */
async function freshenIfDue(
  date: string,
  record: DayRecord,
  now: Date,
): Promise<boolean> {
  const isToday = date === vnDateKey(now);
  const ran = await Promise.all(
    REGIONS.map(async (region) => {
      const plan = planFor(date, region, record[region], now, 0);
      if (!plan.fetchNow || plan.recheckInMs === null) return false;
      // Today: at most one fetch per 10 s. Past days: follow the backfill pace.
      const minIntervalMs = isToday
        ? Math.min(plan.recheckInMs, 10_000)
        : plan.recheckInMs;
      await Promise.race([
        refreshDraw(region, date, { minIntervalMs }),
        new Promise((resolve) => setTimeout(resolve, 9_000)),
      ]);
      return true;
    }),
  );
  return ran.some(Boolean);
}

/**
 * Without a running poller (serverless) the history behind the guess numbers
 * is collected by visitors: each call fills in a few missing earlier days.
 * Meant to run after the response has been sent (see the route handler).
 */
export async function backfillSome(now: Date = new Date()): Promise<void> {
  if (pollerStatus().running) return;
  const g = globalThis as typeof globalThis & { __lotteryBackfillAt?: number };
  if (Date.now() - (g.__lotteryBackfillAt ?? 0) < 5_000) return;
  g.__lotteryBackfillAt = Date.now();

  const dates = recentDates(STATS_DAYS, now).slice(1);
  const records = await readDays(dates);
  const todo: { region: Region; date: string }[] = [];
  for (const date of dates) {
    for (const region of REGIONS) {
      if (records[date]?.[region]?.status !== "complete") {
        todo.push({ region, date });
      }
    }
    if (todo.length >= 4) break;
  }
  await Promise.all(
    todo.map((job) =>
      refreshDraw(job.region, job.date, { minIntervalMs: 10 * 60_000 }),
    ),
  );
}

/**
 * Many viewers poll at once (every 10 s each). Payloads are shared for 2 s and
 * concurrent callers await the same build, so N viewers cost one build.
 */
const SHARE_MS = 2_000;
const gShare = globalThis as typeof globalThis & {
  __lotteryShared?: Map<string, { at: number; promise: Promise<ResultsPayload> }>;
};
const shared = (gShare.__lotteryShared ??= new Map());

export function buildResults(date: string): Promise<ResultsPayload> {
  const hit = shared.get(date);
  if (hit && Date.now() - hit.at < SHARE_MS) return hit.promise;
  const promise = buildResultsUncached(date);
  shared.set(date, { at: Date.now(), promise });
  // A failed build must not be served again.
  promise.catch(() => {
    if (shared.get(date)?.promise === promise) shared.delete(date);
  });
  return promise;
}

async function buildResultsUncached(date: string): Promise<ResultsPayload> {
  const now = new Date();
  const dates = recentDates(HISTORY_DAYS, now);

  // One batched read for the whole week (a single Redis round trip).
  const week = await readDays(dates);
  let record: DayRecord = week[date] ?? { date };

  // Fresh data is a bonus: if fetching or guess generation fails, the stored
  // results must still be served.
  try {
    if (await freshenIfDue(date, record, now)) {
      record = (await readDays([date]))[date] ?? record;
      week[date] = record;
    }
  } catch (err) {
    console.error("[lottery] refresh on request failed:", err);
  }

  const guess = async (shift: "day" | "night") => {
    const stored = record.predictions?.[shift];
    if (stored) return stored;
    try {
      return await ensurePrediction(shift, date);
    } catch (err) {
      console.error(`[lottery] guess ${shift} failed:`, err);
      return null;
    }
  };
  const [predDay, predNight] = await Promise.all([
    guess("day"),
    guess("night"),
  ]);

  const day = buildShiftView("day", date, record.mn);
  const night = buildShiftView("night", date, record.mb);

  const history: HistoryEntry[] = dates.map((d) => {
    const r = week[d];
    return {
      date: d,
      day: {
        status: r?.mn?.status ?? "pending",
        verification: r?.mn?.verification ?? "pending",
      },
      night: {
        status: r?.mb?.status ?? "pending",
        verification: r?.mb?.verification ?? "pending",
      },
    };
  });

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
    final: date < today && !unfinished,
    pollHintMs: releasing ? 10_000 : date === today && unfinished ? 30_000 : 60_000,
    poller: pollerStatus(),
  };
}
