import type { Region } from "./types.ts";

/** Vietnam is UTC+7 all year (no DST), so a fixed offset is exact. */
const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Official draw start (ICT). Results finish publishing ~20 minutes later. */
export const DRAW_TIME: Record<Region, { hour: number; minute: number }> = {
  mn: { hour: 16, minute: 15 },
  mb: { hour: 18, minute: 15 },
};

export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" for the Vietnam calendar day containing `now`. */
export function vnDateKey(now: Date = new Date()): string {
  return new Date(now.getTime() + ICT_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Today first, then yesterday, ... `count` entries in total. */
export function recentDates(count: number, now: Date = new Date()): string[] {
  const today = vnDateKey(now);
  return Array.from({ length: count }, (_, i) => addDays(today, -i));
}

/** 0 = Sunday ... 6 = Saturday, for a Vietnam calendar date. */
export function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "13-10-2026" or "13/10/2026". */
export function formatDMY(dateKey: string, sep: "-" | "/" = "-"): string {
  const [y, m, d] = dateKey.split("-");
  return [d, m, y].join(sep);
}

/** The instant the draw starts. */
export function drawInstant(dateKey: string, region: Region): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const { hour, minute } = DRAW_TIME[region];
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - ICT_OFFSET_MS);
}

export function isValidDateKey(value: string): boolean {
  if (!DATE_KEY_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}
