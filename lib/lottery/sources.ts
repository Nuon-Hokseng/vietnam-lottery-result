import { parseGenericPage, parseMinhNgoc } from "./parsers.ts";
import { formatDMY } from "./time.ts";
import { mergeReports } from "./verify.ts";
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

// ---- circuit breaker --------------------------------------------------------
// A site that keeps failing costs a full timeout on every poll. After three
// failures in a row it is skipped for a cool-down that doubles up to 5 minutes;
// the first success closes the breaker again.

interface Health {
  fails: number;
  openUntil: number;
}
const g = globalThis as typeof globalThis & {
  __lotterySourceHealth?: Map<string, Health>;
};
const health = (g.__lotterySourceHealth ??= new Map<string, Health>());

const BREAKER_AFTER = 3;
const isOpen = (id: string) => (health.get(id)?.openUntil ?? 0) > Date.now();

function recordOutcome(report: SourceReport, skipped: boolean) {
  if (skipped) return; // aborted by us: says nothing about the site
  if (report.ok) {
    health.delete(report.id);
    return;
  }
  const h = health.get(report.id) ?? { fails: 0, openUntil: 0 };
  h.fails += 1;
  if (h.fails >= BREAKER_AFTER) {
    const cooldown = Math.min(5 * 60_000, 15_000 * 2 ** (h.fails - BREAKER_AFTER));
    h.openUntil = Date.now() + cooldown;
  }
  health.set(report.id, h);
}

/** Test hook. */
export function resetSourceHealth() {
  health.clear();
}

// ---- fetching ---------------------------------------------------------------

/** Ask one site for one draw. Never throws: failures become `ok: false`. */
export async function fetchSource(
  source: Source,
  region: Region,
  dateKey: string,
  outer?: AbortSignal,
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
      signal: outer
        ? AbortSignal.any([outer, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
        : AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
      error: outer?.aborted
        ? SKIPPED
        : timedOut
          ? `timed out after ${FETCH_TIMEOUT_MS / 1000}s`
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }
}

const SKIPPED = "not needed";
const BREAKER_OPEN = "skipped while failing";

/**
 * After a complete result has arrived, wait at most this long for a second
 * site family to confirm it. The number is shown straight away and the next
 * poll upgrades it to "verified", so a hung site never delays the page.
 */
const CONFIRM_GRACE_MS = 2_500;

export interface FetchAllOptions {
  sources?: Source[];
  fetcher?: typeof fetchSource;
  graceMs?: number;
}

/**
 * Query the sites concurrently and return as soon as the answer is complete
 * and confirmed by two independent site families. Slow or hung sites are then
 * aborted instead of awaited, so latency is that of the second-fastest family
 * rather than the slowest site. If only one family has answered, it waits
 * CONFIRM_GRACE_MS for a confirmation and then returns what it has.
 */
export async function fetchAllSources(
  region: Region,
  dateKey: string,
  {
    sources = SOURCES,
    fetcher = fetchSource,
    graceMs = CONFIRM_GRACE_MS,
  }: FetchAllOptions = {},
): Promise<SourceReport[]> {
  let candidates = sources.filter((s) => !isOpen(s.id));
  if (candidates.length === 0) candidates = sources; // all down: probe anyway
  const skippedByBreaker = sources.filter((s) => !candidates.includes(s));

  const controller = new AbortController();
  const reports: SourceReport[] = [];

  const confirmed = () => {
    const merged = mergeReports(region, dateKey, reports, undefined);
    return merged.status === "complete" && merged.verification === "verified";
  };

  const hasComplete = () =>
    mergeReports(region, dateKey, reports, undefined).status === "complete";

  await new Promise<void>((resolve) => {
    let remaining = candidates.length;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    for (const source of candidates) {
      void fetcher(source, region, dateKey, controller.signal).then((r) => {
        recordOutcome(r, r.error === SKIPPED);
        reports.push(r);
        remaining -= 1;
        if (remaining === 0 || confirmed()) {
          clearTimeout(graceTimer);
          resolve();
          return;
        }
        // A complete but unconfirmed result: give confirmation a short window.
        if (!graceTimer && graceMs > 0 && hasComplete()) {
          graceTimer = setTimeout(resolve, graceMs);
        }
      });
    }
  });
  controller.abort(); // cancel whatever is still in flight

  const answered = new Set(reports.map((r) => r.id));
  const placeholder = (s: Source, error: string): SourceReport => ({
    id: s.id,
    name: s.name,
    family: s.family,
    priority: s.priority,
    ok: false,
    error,
    fetchedAt: new Date().toISOString(),
    durationMs: 0,
  });

  return [
    ...reports,
    ...candidates.filter((s) => !answered.has(s.id)).map((s) => placeholder(s, SKIPPED)),
    ...skippedByBreaker.map((s) => placeholder(s, BREAKER_OPEN)),
  ];
}
