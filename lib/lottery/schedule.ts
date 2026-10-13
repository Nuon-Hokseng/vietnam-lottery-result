import { drawInstant, vnDateKey } from "./time.ts";
import type { Region, StoredDraw } from "./types.ts";

const MINUTE = 60_000;

/** Start polling this long before the official draw time. */
export const LEAD_MS = 5 * MINUTE;
/** Poll every few seconds while the result is being released. */
export const LIVE_INTERVAL_MS = 10_000;

export interface Plan {
  /** Fetch the sources right now. */
  fetchNow: boolean;
  /** When to look at this draw again; null = nothing left to do. */
  recheckInMs: number | null;
}

const DONE: Plan = { fetchNow: false, recheckInMs: null };

/**
 * Polling policy for one draw.
 *
 *  - verified & complete             -> done, never fetched again
 *  - today, before (draw - 5 min)    -> sleep until then
 *  - today, drawing (first 75 min)   -> every 10 s
 *  - today, complete but unverified  -> every 30 s for 30 min, then every 5 min
 *  - today, late (> 75 min, nothing) -> every 2 min until midnight
 *  - past days                       -> backfill, retry with a capped budget
 *
 * `attempts` only limits past days, so a draw that was never published (or a
 * site that is down) cannot be hammered forever.
 */
export function planFor(
  date: string,
  region: Region,
  draw: StoredDraw | undefined,
  now: Date,
  attempts: number,
): Plan {
  if (draw?.status === "complete" && draw.verification === "verified") {
    return DONE;
  }

  const today = vnDateKey(now);
  if (date > today) return DONE;

  if (date < today) {
    if (!draw) return attempts < 3 ? { fetchNow: true, recheckInMs: 30_000 } : DONE;
    if (draw.status === "complete") {
      return attempts < 6
        ? { fetchNow: true, recheckInMs: 60 * MINUTE }
        : DONE;
    }
    return attempts < 8
      ? { fetchNow: true, recheckInMs: 10 * MINUTE }
      : DONE;
  }

  const startsAt = drawInstant(date, region).getTime();
  const t = now.getTime();
  if (t < startsAt - LEAD_MS) {
    return { fetchNow: false, recheckInMs: startsAt - LEAD_MS - t };
  }

  if (draw?.status === "complete") {
    const since = t - Date.parse(draw.firstCompleteAt ?? draw.updatedAt);
    return {
      fetchNow: true,
      recheckInMs: since < 30 * MINUTE ? 30_000 : 5 * MINUTE,
    };
  }

  if (t - startsAt < 75 * MINUTE) {
    return { fetchNow: true, recheckInMs: LIVE_INTERVAL_MS };
  }
  return { fetchNow: true, recheckInMs: 2 * MINUTE };
}
