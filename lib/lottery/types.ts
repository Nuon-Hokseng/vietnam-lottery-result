/**
 * Shared types for the lottery pipeline.
 *
 * Vocabulary:
 *  - region "mn" = Xổ số miền Nam (drawn ~16:15 ICT)  -> the app's "Day" shift
 *  - region "mb" = Xổ số miền Bắc (drawn ~18:15 ICT)  -> the app's "Night" shift
 */

export type Region = "mn" | "mb";

export const PRIZE_KEYS = [
  "db",
  "g1",
  "g2",
  "g3",
  "g4",
  "g5",
  "g6",
  "g7",
  "g8",
] as const;
export type PrizeKey = (typeof PRIZE_KEYS)[number];

/** Prize -> list of numbers, in the order the sources print them. */
export type Prizes = Partial<Record<PrizeKey, string[]>>;

export interface ParsedStation {
  /** Stable id such as "tp-hcm"; "mb" for the single northern draw. */
  slug: string;
  name: string;
  prizes: Prizes;
}

export interface ParsedDraw {
  stations: ParsedStation[];
}

export interface PrizeSpec {
  count: number;
  digits: number;
}

/** What a *complete* draw looks like. Anything else is treated as pending. */
export const PRIZE_SPEC: Record<Region, Partial<Record<PrizeKey, PrizeSpec>>> = {
  // One southern station: 18 numbers.
  mn: {
    g8: { count: 1, digits: 2 },
    g7: { count: 1, digits: 3 },
    g6: { count: 3, digits: 4 },
    g5: { count: 1, digits: 4 },
    g4: { count: 7, digits: 5 },
    g3: { count: 2, digits: 5 },
    g2: { count: 1, digits: 5 },
    g1: { count: 1, digits: 5 },
    db: { count: 1, digits: 6 },
  },
  // Northern draw: 27 numbers.
  mb: {
    db: { count: 1, digits: 5 },
    g1: { count: 1, digits: 5 },
    g2: { count: 2, digits: 5 },
    g3: { count: 6, digits: 5 },
    g4: { count: 4, digits: 4 },
    g5: { count: 6, digits: 4 },
    g6: { count: 3, digits: 3 },
    g7: { count: 4, digits: 2 },
  },
};

export type SourceFamily = "minhngoc" | "az24" | "ngaydep";

/** Outcome of asking one website for one draw. */
export interface SourceReport {
  id: string;
  name: string;
  family: SourceFamily;
  priority: number;
  ok: boolean;
  error?: string;
  fetchedAt: string;
  durationMs: number;
  draw?: ParsedDraw;
}

/**
 * - verified: complete, and >= 2 independent site families agree on every number
 * - single:   complete, but only one site family has published it so far
 * - conflict: complete on several sites that disagree (majority is shown)
 * - pending:  not complete yet
 */
export type Verification = "verified" | "single" | "conflict" | "pending";

export type DrawStatus = "pending" | "partial" | "complete";

export interface StoredStation extends ParsedStation {
  complete: boolean;
  verification: Verification;
  /** Source ids that publish exactly the stored numbers. */
  agreeing: string[];
  /** Present when sources disagree: each competing variant and who reported it. */
  conflicts?: { sources: string[]; prizes: Prizes }[];
}

export interface SourceSummary {
  id: string;
  name: string;
  family: SourceFamily;
  ok: boolean;
  error?: string;
  durationMs: number;
  fetchedAt: string;
  numbers: number;
  complete: boolean;
  /** null when the source had nothing complete to compare. */
  agrees: boolean | null;
}

export interface StoredDraw {
  date: string; // YYYY-MM-DD, Vietnam calendar day
  region: Region;
  status: DrawStatus;
  verification: Verification;
  stations: StoredStation[];
  sources: SourceSummary[];
  firstCompleteAt?: string;
  updatedAt: string;
  lastAttemptAt: string;
  lastSuccessAt?: string;
}

export interface DayRecord {
  date: string;
  mn?: StoredDraw;
  mb?: StoredDraw;
  /** Guess numbers for this day, frozen when first computed. */
  predictions?: Partial<Record<"day" | "night", import("./predict.ts").ShiftPrediction>>;
}
