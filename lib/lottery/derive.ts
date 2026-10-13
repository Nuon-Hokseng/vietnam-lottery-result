import type {
  DrawStatus,
  PrizeKey,
  Region,
  SourceSummary,
  StoredDraw,
  StoredStation,
  Verification,
} from "./types.ts";

/**
 * Turn raw official results into the "pos" rows and the lô grid shown by the
 * reference app. Rules were reverse-engineered from the app's screenshots
 * against the official results of 12/10/2026 and are checked by
 * tests/derive.test.ts.
 *
 *  Night shift (XSMB, 18:15)
 *    posA3 = Giải 6              posA2 = Giải 7
 *    posB/C/D = three slices of the 5-digit Giải ĐB (see sliceSpecial)
 *    lô grid = last 3 digits of G1..G5  (19 numbers)
 *
 *  Day shift (XSMN, 16:15)
 *    posA = station 1 G8 / G7    posB/C/D = station 1 special slices
 *    posF, posI = station 2 G8 / G7
 *    posN = station 2 special slice B
 *    lô grid = last 3 digits of G6, G5, G4, G3 ... of station 1, first 12
 *
 * The 6-digit southern special prize is reduced to its last 5 digits before
 * slicing (290770 -> 90770), matching the app.
 */

export type RowKind = "g8g7" | "g6" | "g7" | "db-b" | "db-c" | "db-d";

export interface RowDef {
  key: string;
  kind: RowKind;
  /** Index into the ticket-ordered station list (southern only). */
  station?: number;
  hint: string;
}

const SLICE_HINT = {
  "db-b": "First 2 and last 3 digits of the special prize",
  "db-c": "Last 2 and first 3 digits of the special prize",
  "db-d": "First + last digit, and the middle 3 digits",
} as const;

export const NIGHT_ROWS: RowDef[] = [
  { key: "posA3", kind: "g6", hint: "Prize 6 — three 3-digit numbers" },
  { key: "posA2", kind: "g7", hint: "Prize 7 — four 2-digit numbers" },
  { key: "posB", kind: "db-b", hint: SLICE_HINT["db-b"] },
  { key: "posC", kind: "db-c", hint: SLICE_HINT["db-c"] },
  { key: "posD", kind: "db-d", hint: SLICE_HINT["db-d"] },
];

export const DAY_ROWS: RowDef[] = [
  { key: "posA", kind: "g8g7", station: 0, hint: "Prize 8 and 7 of station 1" },
  { key: "posB", kind: "db-b", station: 0, hint: SLICE_HINT["db-b"] },
  { key: "posC", kind: "db-c", station: 0, hint: SLICE_HINT["db-c"] },
  { key: "posD", kind: "db-d", station: 0, hint: SLICE_HINT["db-d"] },
  { key: "posF", kind: "g8g7", station: 1, hint: "Prize 8 and 7 of station 2" },
  { key: "posI", kind: "g8g7", station: 1, hint: "Prize 8 and 7 of station 2" },
  { key: "posN", kind: "db-b", station: 1, hint: SLICE_HINT["db-b"] },
];

/** Slices of the 5-digit special prize. */
export function sliceSpecial(
  five: string,
  kind: "db-b" | "db-c" | "db-d",
): [string, string] {
  switch (kind) {
    case "db-b":
      return [five.slice(0, 2), five.slice(2)];
    case "db-c":
      return [five.slice(3), five.slice(0, 3)];
    case "db-d":
      return [five[0] + five[4], five.slice(1, 4)];
  }
}

export interface ResultRow {
  key: string;
  numbers: (string | null)[];
  /** Which station this row came from (southern shift only). */
  station?: string;
  hint: string;
}

export interface ShiftView {
  shift: "day" | "night";
  region: Region;
  date: string;
  status: DrawStatus;
  verification: Verification;
  rows: ResultRow[];
  grid: (string | null)[];
  gridSize: number;
  gridFilled: number;
  stations: {
    name: string;
    complete: boolean;
    verification: Verification;
    agreeing: string[];
    conflicts?: StoredStation["conflicts"];
  }[];
  sources: SourceSummary[];
  updatedAt?: string;
  firstCompleteAt?: string;
}

function fromPrize(
  station: StoredStation | undefined,
  key: PrizeKey,
  count: number,
): (string | null)[] {
  const values = station?.prizes[key] ?? [];
  return Array.from({ length: count }, (_, i) => values[i] ?? null);
}

function specialSlice(
  station: StoredStation | undefined,
  region: Region,
  kind: "db-b" | "db-c" | "db-d",
): (string | null)[] {
  const raw = station?.prizes.db?.[0];
  if (!raw) return [null, null];
  const five = region === "mn" ? raw.slice(1) : raw;
  return sliceSpecial(five, kind);
}

function buildRow(
  def: RowDef,
  region: Region,
  stations: StoredStation[],
): ResultRow {
  const station = def.station === undefined ? stations[0] : stations[def.station];
  let numbers: (string | null)[];
  switch (def.kind) {
    case "g8g7":
      numbers = [
        ...fromPrize(station, "g8", 1),
        ...fromPrize(station, "g7", 1),
      ];
      break;
    case "g6":
      numbers = fromPrize(station, "g6", 3);
      break;
    case "g7":
      numbers = fromPrize(station, "g7", 4);
      break;
    default:
      numbers = specialSlice(station, region, def.kind);
  }
  return {
    key: def.key,
    numbers,
    station: region === "mn" ? station?.name : undefined,
    hint: def.hint,
  };
}

/** Order the lô grid reads in, as (prize, count) pairs. */
const GRID_ORDER: Record<"day" | "night", [PrizeKey, number][]> = {
  night: [
    ["g1", 1],
    ["g2", 2],
    ["g3", 6],
    ["g4", 4],
    ["g5", 6],
  ],
  day: [
    ["g6", 3],
    ["g5", 1],
    ["g4", 7],
    ["g3", 2],
    ["g2", 1],
    ["g1", 1],
  ],
};
const GRID_SIZE = { day: 12, night: 19 } as const;

function buildGrid(
  shift: "day" | "night",
  station: StoredStation | undefined,
): (string | null)[] {
  const cells: (string | null)[] = [];
  for (const [key, count] of GRID_ORDER[shift]) {
    for (const value of fromPrize(station, key, count)) {
      cells.push(value ? value.slice(-3) : null);
    }
  }
  return cells.slice(0, GRID_SIZE[shift]);
}

export function buildShiftView(
  shift: "day" | "night",
  date: string,
  draw: StoredDraw | undefined,
): ShiftView {
  const region: Region = shift === "day" ? "mn" : "mb";
  const stations = draw?.stations ?? [];
  const defs = shift === "day" ? DAY_ROWS : NIGHT_ROWS;
  const grid = buildGrid(shift, stations[0]);
  return {
    shift,
    region,
    date,
    status: draw?.status ?? "pending",
    verification: draw?.verification ?? "pending",
    rows: defs.map((def) => buildRow(def, region, stations)),
    grid,
    gridSize: GRID_SIZE[shift],
    gridFilled: grid.filter(Boolean).length,
    stations: stations.map((s) => ({
      name: s.name,
      complete: s.complete,
      verification: s.verification,
      agreeing: s.agreeing,
      conflicts: s.conflicts,
    })),
    sources: draw?.sources ?? [],
    updatedAt: draw?.updatedAt,
    firstCompleteAt: draw?.firstCompleteAt,
  };
}
