import { parseGenericPage, parseMinhNgoc } from "./parsers.ts";
import { formatDMY } from "./time.ts";
import type { ParsedDraw, Region, SourceFamily, SourceReport } from "./types.ts";

export interface Source {
  id: string;
  name: string;
  /**
   * Sites in the same family share one backend (az24.vn and xsmn.mobi render
   * the same data), so they cannot verify each other. Verification needs two
   * different families.
   */
  family: SourceFamily;
  /** Lower wins when sources tie or disagree evenly. */
  priority: number;
  url(region: Region, dateKey: string): string;
  parse(html: string, region: Region, dateKey: string): ParsedDraw;
}

const slugFor = (region: Region) => (region === "mn" ? "xsmn" : "xsmb");

export const SOURCES: Source[] = [
  {
    id: "minhngoc",
    name: "minhngoc.net.vn",
    family: "minhngoc",
    priority: 1,
    url: (region, date) =>
      `https://www.minhngoc.net.vn/ket-qua-xo-so/mien-${
        region === "mn" ? "nam" : "bac"
      }/${formatDMY(date)}.html`,
    parse: parseMinhNgoc,
  },
  {
    id: "az24",
    name: "az24.vn",
    family: "az24",
    priority: 2,
    url: (region, date) =>
      `https://az24.vn/${slugFor(region)}-${formatDMY(date)}.html`,
    parse: parseGenericPage,
  },
  {
    id: "xsmn-mobi",
    name: "xsmn.mobi",
    family: "az24",
    priority: 3,
    url: (region, date) =>
      `https://xsmn.mobi/${slugFor(region)}-${formatDMY(date)}.html`,
    parse: parseGenericPage,
  },
  {
    // Does not publish TP.HCM, so it can only verify the other stations.
    id: "ngaydep",
    name: "ngaydep.com",
    family: "ngaydep",
    priority: 4,
    url: (region, date) =>
      `https://ngaydep.com/${slugFor(region)}-ngay-${formatDMY(date)}.html`,
    parse: parseGenericPage,
  },
];

const FETCH_TIMEOUT_MS = 8_000;

const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
};

/** Ask one site for one draw. Never throws: failures become `ok: false`. */
export async function fetchSource(
  source: Source,
  region: Region,
  dateKey: string,
): Promise<SourceReport> {
  const started = Date.now();
  const base = {
    id: source.id,
    name: source.name,
    family: source.family,
    priority: source.priority,
    fetchedAt: new Date(started).toISOString(),
  };

  try {
    const res = await fetch(source.url(region, dateKey), {
      headers: BROWSER_HEADERS,
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const draw = source.parse(html, region, dateKey);
    return { ...base, ok: true, durationMs: Date.now() - started, draw };
  } catch (err) {
    const timedOut =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ...base,
      ok: false,
      durationMs: Date.now() - started,
      error: timedOut
        ? `timed out after ${FETCH_TIMEOUT_MS / 1000}s`
        : err instanceof Error
          ? err.message
          : String(err),
    };
  }
}

export function fetchAllSources(region: Region, dateKey: string) {
  return Promise.all(SOURCES.map((s) => fetchSource(s, region, dateKey)));
}
