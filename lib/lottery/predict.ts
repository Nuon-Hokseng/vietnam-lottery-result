import { addDays } from "./time.ts";
import type { DayRecord, StoredDraw } from "./types.ts";

/**
 * "Guess" numbers: one 3-digit number for each of posA, posB and posC.
 *
 * Method (deliberately simple and explainable): over the last STATS_DAYS
 * completed draws before the target date, find the most frequent digit at each
 * of the three places of that pos; the three digits together are the most
 * probable 3-digit number under an independent-places model. Ties go to the
 * digit that appeared most recently.
 *
 * Only days strictly before the target date are used, so a guess never changes
 * once its day's result is published, and it can be stored per day.
 *
 * Note: no trusted site publishes 3-digit predictions (checked: xskt.com.vn,
 * baoquocte.vn, xoso.me), so the sample is the verified result history that
 * this app already collects.
 */

export type Shift = "day" | "night";
export type GuessPos = "A" | "B" | "C";

export const STATS_DAYS = 60;
/** No guess is shown until at least this many completed draws are on file. */
export const MIN_SAMPLE_DAYS = 30;

export interface PosGuess {
  pos: GuessPos;
  /** Always 3 digits, leading zeros kept. */
  value: string;
}

export interface ShiftPrediction {
  shift: Shift;
  date: string;
  guesses: PosGuess[];
  /** How many past draws the guess is based on. */
  sampleDays: number;
}

type Samples = Record<GuessPos, string[]>;

/**
 * The 3-digit numbers a completed draw contributes to each pos, matching the
 * rows on the result screen:
 *  night: A = the three prize-6 numbers, B = last 3 and C = first 3 digits of
 *         the 5-digit special prize.
 *  day:   A = prize 7 of station 1, B/C = the same slices of its special
 *         prize after dropping the leading digit.
 */
export function samplesOf(
  shift: Shift,
  draw: StoredDraw | undefined,
): Samples | null {
  if (!draw || draw.status !== "complete") return null;
  const station = draw.stations[0];
  if (!station) return null;

  const rawSpecial = station.prizes.db?.[0];
  if (!rawSpecial) return null;
  const five = shift === "day" ? rawSpecial.slice(1) : rawSpecial;
  if (!/^\d{5}$/.test(five)) return null;

  const a =
    shift === "night"
      ? (station.prizes.g6 ?? [])
      : station.prizes.g7?.slice(0, 1) ?? [];
  if (a.length === 0 || a.some((n) => !/^\d{3}$/.test(n))) return null;

  return { A: a, B: [five.slice(2)], C: [five.slice(0, 3)] };
}

/** Most frequent digit per place; samples are ordered oldest -> newest. */
export function mostFrequentNumber(samples: string[]): string | null {
  if (samples.length === 0) return null;
  let out = "";
  for (let place = 0; place < 3; place++) {
    const count = Array<number>(10).fill(0);
    const lastSeen = Array<number>(10).fill(-1);
    samples.forEach((n, i) => {
      const d = Number(n[place]);
      count[d] += 1;
      lastSeen[d] = i;
    });
    let best = 0;
    for (let d = 1; d < 10; d++) {
      if (
        count[d] > count[best] ||
        (count[d] === count[best] && lastSeen[d] > lastSeen[best])
      ) {
        best = d;
      }
    }
    out += String(best);
  }
  return out;
}

export function predictShift(
  shift: Shift,
  date: string,
  records: DayRecord[],
): ShiftPrediction | null {
  const from = addDays(date, -STATS_DAYS);
  const usable = records
    .filter((r) => r.date >= from && r.date < date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const pooled: Samples = { A: [], B: [], C: [] };
  let days = 0;
  for (const record of usable) {
    const s = samplesOf(shift, shift === "day" ? record.mn : record.mb);
    if (!s) continue;
    days += 1;
    pooled.A.push(...s.A);
    pooled.B.push(...s.B);
    pooled.C.push(...s.C);
  }
  if (days < MIN_SAMPLE_DAYS) return null;

  const guesses: PosGuess[] = [];
  for (const pos of ["A", "B", "C"] as const) {
    const value = mostFrequentNumber(pooled[pos]);
    if (!value) return null;
    guesses.push({ pos, value });
  }
  return { shift, date, guesses, sampleDays: days };
}
