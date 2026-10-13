import { planFor } from "./schedule.ts";
import { refreshDraw } from "./service.ts";
import { readDay } from "./store.ts";
import { STATS_DAYS } from "./predict.ts";
import { recentDates } from "./time.ts";
import type { Region } from "./types.ts";

/** Days served by the API and checked continuously: today plus seven. */
export const HISTORY_DAYS = 8;
const TICK_MS = 2_000;
const REGIONS: Region[] = ["mn", "mb"];

interface JobState {
  nextAt: number;
  attempts: number;
  done: boolean;
  /** Consecutive failed rounds (every site down, or an internal error). */
  failures: number;
}

/** 10 s, 20 s, 40 s ... capped at 5 min. */
const backoffMs = (failures: number) =>
  Math.min(5 * 60_000, 10_000 * 2 ** Math.max(0, failures - 1));

/** A tick that has not finished after this long is abandoned. */
const TICK_WATCHDOG_MS = 120_000;

interface PollerRuntime {
  startedAt: string;
  lastTickAt?: string;
  lastError?: string;
  jobs: Map<string, JobState>;
}

const g = globalThis as typeof globalThis & { __lotteryPoller?: PollerRuntime };

export function pollerStatus() {
  const rt = g.__lotteryPoller;
  return {
    running: Boolean(rt),
    startedAt: rt?.startedAt,
    lastTickAt: rt?.lastTickAt,
    lastError: rt?.lastError,
  };
}

async function tick(rt: PollerRuntime): Promise<void> {
  const now = new Date();
  rt.lastTickAt = now.toISOString();

  // Newest first: today's live draws must never queue behind the startup
  // backfill of older days. Due jobs run one at a time, each bounded by the
  // per-source fetch timeout, which also keeps request volume polite. Days
  // beyond HISTORY_DAYS only feed the guess statistics, so at most one of them
  // is fetched per tick.
  let backfillBudget = 1;
  const dates = recentDates(STATS_DAYS, now);
  for (const [dayIndex, date] of dates.entries()) {
    const isBackfill = dayIndex >= HISTORY_DAYS;
    for (const region of REGIONS) {
      const key = `${date}:${region}`;
      const state =
        rt.jobs.get(key) ??
        { nextAt: 0, attempts: 0, done: false, failures: 0 };
      rt.jobs.set(key, state);
      if (state.done || Date.now() < state.nextAt) continue;

      // One broken job (unreadable file, full disk, bad data) must never stop
      // the others, so every job runs inside its own try/catch with backoff.
      try {
        const stored = (await readDay(date))[region];
        const plan = planFor(date, region, stored, new Date(), state.attempts);

        if (!plan.fetchNow) {
          if (plan.recheckInMs === null) state.done = true;
          else state.nextAt = Date.now() + plan.recheckInMs;
          continue;
        }
        if (isBackfill) {
          if (backfillBudget <= 0) continue; // next tick
          backfillBudget -= 1;
        }

        const fresh = await refreshDraw(region, date);
        state.attempts += 1;

        const anySiteAnswered = fresh.sources.some((s) => s.ok);
        state.failures = anySiteAnswered ? 0 : state.failures + 1;

        const after = planFor(date, region, fresh, new Date(), state.attempts);
        if (after.recheckInMs === null) {
          state.done = true;
        } else {
          // Never hammer sites that are all failing: back off, then resume.
          const wait = anySiteAnswered
            ? after.recheckInMs
            : Math.max(after.recheckInMs, backoffMs(state.failures));
          state.nextAt = Date.now() + wait;
        }
      } catch (err) {
        state.failures += 1;
        state.nextAt = Date.now() + backoffMs(state.failures);
        rt.lastError = `${key}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[lottery] job ${key} failed:`, rt.lastError);
      }
    }
  }

  // Forget bookkeeping for days that fell out of the window.
  const keep = new Set(recentDates(STATS_DAYS, now));
  for (const key of rt.jobs.keys()) {
    if (!keep.has(key.split(":")[0])) rt.jobs.delete(key);
  }
}

/** Start the background loop once per server process. */
export function startPoller(): void {
  if (g.__lotteryPoller) return;
  const rt: PollerRuntime = {
    startedAt: new Date().toISOString(),
    jobs: new Map(),
  };
  g.__lotteryPoller = rt;
  console.log("[lottery] poller started");

  const loop = async () => {
    try {
      // Watchdog: if a tick hangs (stuck I/O), carry on with a fresh one
      // instead of freezing the poller forever.
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        tick(rt),
        new Promise<void>((_, reject) => {
          watchdog = setTimeout(
            () => reject(new Error("tick exceeded watchdog")),
            TICK_WATCHDOG_MS,
          );
        }),
      ]).finally(() => clearTimeout(watchdog));
    } catch (err) {
      rt.lastError = err instanceof Error ? err.message : String(err);
      console.error("[lottery] poller tick failed:", rt.lastError);
    } finally {
      const timer = setTimeout(loop, TICK_MS);
      timer.unref?.();
    }
  };
  void loop();
}
