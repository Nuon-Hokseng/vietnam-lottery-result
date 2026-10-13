import { scheduledStations, stationOrder } from "./stations.ts";
import {
  PRIZE_KEYS,
  PRIZE_SPEC,
  type DrawStatus,
  type PrizeKey,
  type Prizes,
  type Region,
  type SourceReport,
  type SourceSummary,
  type StoredDraw,
  type StoredStation,
  type Verification,
} from "./types.ts";

/** Keep only numbers that have the exact digit count the prize requires. */
export function cleanPrizes(region: Region, prizes: Prizes): Prizes {
  const spec = PRIZE_SPEC[region];
  const out: Prizes = {};
  for (const key of PRIZE_KEYS) {
    const rule = spec[key];
    const values = prizes[key];
    if (!rule || !values) continue;
    const valid = values
      .filter((v) => v.length === rule.digits)
      .slice(0, rule.count);
    if (valid.length) out[key] = valid;
  }
  return out;
}

export function countNumbers(prizes: Prizes): number {
  return PRIZE_KEYS.reduce((sum, k) => sum + (prizes[k]?.length ?? 0), 0);
}

export function totalNumbers(region: Region): number {
  return Object.values(PRIZE_SPEC[region]).reduce((s, r) => s + r!.count, 0);
}

export function isComplete(region: Region, prizes: Prizes): boolean {
  return countNumbers(prizes) === totalNumbers(region);
}

const signature = (prizes: Prizes) =>
  PRIZE_KEYS.map((k) => `${k}:${(prizes[k] ?? []).join(",")}`).join("|");

interface Candidate {
  report: SourceReport;
  prizes: Prizes;
  count: number;
  complete: boolean;
  sig: string;
}

function worstVerification(list: Verification[]): Verification {
  for (const v of ["conflict", "pending", "single"] as const) {
    if (list.includes(v)) return v;
  }
  return "verified";
}

/**
 * Combine what every site said about one draw into a single record.
 *
 * Rules, per station:
 *  - Only complete, digit-checked records are compared.
 *  - Identical records from >= 2 different site families -> verified.
 *  - One family only -> single (shown, but flagged as not cross-checked).
 *  - Different complete records -> conflict; the variant backed by most
 *    families/sources wins, ties go to the higher-priority site.
 *  - Nothing complete -> pending, showing the fullest partial (live drawing).
 */
export function mergeReports(
  region: Region,
  dateKey: string,
  reports: SourceReport[],
  previous: StoredDraw | undefined,
  now: Date = new Date(),
): StoredDraw {
  const nowIso = now.toISOString();
  const okReports = reports.filter((r) => r.ok && r.draw);

  const slugs = new Set<string>();
  for (const r of okReports) {
    for (const st of r.draw!.stations) {
      if (st.slug) slugs.add(st.slug);
    }
  }
  const orderedSlugs = [...slugs].sort(
    (a, b) => stationOrder(dateKey, a) - stationOrder(dateKey, b),
  );

  const stations: StoredStation[] = [];

  for (const slug of orderedSlugs) {
    const candidates: Candidate[] = [];
    let displayName = slug;
    for (const report of okReports) {
      const st = report.draw!.stations.find((s) => s.slug === slug);
      if (!st) continue;
      displayName = st.name;
      const prizes = cleanPrizes(region, st.prizes);
      candidates.push({
        report,
        prizes,
        count: countNumbers(prizes),
        complete: isComplete(region, prizes),
        sig: signature(prizes),
      });
    }

    const complete = candidates.filter((c) => c.complete);
    if (complete.length === 0) {
      const prev = previous?.stations.find((s) => s.slug === slug);
      if (prev?.complete) {
        stations.push(prev); // a flaky fetch must never erase a finished result
        continue;
      }
      const fullest = [...candidates].sort(
        (a, b) => b.count - a.count || a.report.priority - b.report.priority,
      )[0];
      stations.push({
        slug,
        name: displayName,
        prizes: fullest?.prizes ?? {},
        complete: false,
        verification: "pending",
        agreeing: [],
      });
      continue;
    }

    const groups = new Map<string, Candidate[]>();
    for (const c of complete) {
      groups.set(c.sig, [...(groups.get(c.sig) ?? []), c]);
    }
    const ranked = [...groups.values()].sort((a, b) => {
      const fam = (g: Candidate[]) => new Set(g.map((c) => c.report.family)).size;
      return (
        fam(b) - fam(a) ||
        b.length - a.length ||
        Math.min(...a.map((c) => c.report.priority)) -
          Math.min(...b.map((c) => c.report.priority))
      );
    });
    const best = ranked[0];
    const families = new Set(best.map((c) => c.report.family));

    let verification: Verification;
    if (ranked.length > 1) verification = "conflict";
    else verification = families.size >= 2 ? "verified" : "single";

    stations.push({
      slug,
      name: displayName,
      prizes: best[0].prizes,
      complete: true,
      verification,
      agreeing: best.map((c) => c.report.id),
      conflicts:
        ranked.length > 1
          ? ranked.map((g) => ({
              sources: g.map((c) => c.report.id),
              prizes: g[0].prizes,
            }))
          : undefined,
    });
  }

  // A station no site mentioned this round but we already hold keeps its record.
  for (const prev of previous?.stations ?? []) {
    if (!stations.some((s) => s.slug === prev.slug)) stations.push(prev);
  }
  stations.sort(
    (a, b) => stationOrder(dateKey, a.slug) - stationOrder(dateKey, b.slug),
  );

  const expected = region === "mn" ? scheduledStations(dateKey).length : 1;
  const allComplete =
    stations.length >= expected && stations.every((s) => s.complete);
  const anyNumbers = stations.some((s) => countNumbers(s.prizes) > 0);
  const status: DrawStatus = allComplete
    ? "complete"
    : anyNumbers
      ? "partial"
      : "pending";

  let verification = worstVerification(stations.map((s) => s.verification));
  if (stations.length < expected && stations.length > 0) {
    // Some stations still missing from every site: cannot be "verified" yet.
    verification = verification === "conflict" ? "conflict" : "pending";
  }
  if (stations.length === 0) verification = "pending";

  const sources: SourceSummary[] = reports.map((r) => {
    const mine = r.draw?.stations ?? [];
    let numbers = 0;
    let complete = mine.length > 0;
    let agrees: boolean | null = null;
    for (const st of mine) {
      const prizes = cleanPrizes(region, st.prizes);
      numbers += countNumbers(prizes);
      const done = isComplete(region, prizes);
      if (!done) complete = false;
      const chosen = stations.find((s) => s.slug === st.slug);
      if (done && chosen?.complete) {
        const same = signature(prizes) === signature(chosen.prizes);
        agrees = (agrees ?? true) && same;
      }
    }
    return {
      id: r.id,
      name: r.name,
      family: r.family,
      ok: r.ok,
      error: r.error,
      durationMs: r.durationMs,
      fetchedAt: r.fetchedAt,
      numbers,
      complete,
      agrees,
    };
  });

  return {
    date: dateKey,
    region,
    status,
    verification,
    stations,
    sources,
    firstCompleteAt:
      previous?.firstCompleteAt ?? (status === "complete" ? nowIso : undefined),
    updatedAt: nowIso,
    lastAttemptAt: nowIso,
    lastSuccessAt: okReports.length ? nowIso : previous?.lastSuccessAt,
  };
}

export type { PrizeKey };
