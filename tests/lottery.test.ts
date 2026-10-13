import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildShiftView } from "../lib/lottery/derive.ts";
import { SOURCES, type Source } from "../lib/lottery/sources.ts";
import { addDays, drawInstant, vnDateKey, weekdayOf } from "../lib/lottery/time.ts";
import type { Region, SourceReport, StoredDraw } from "../lib/lottery/types.ts";
import { mergeReports } from "../lib/lottery/verify.ts";

const NOW = new Date("2026-10-13T10:30:00Z");

function fixture(name: string): string {
  return readFileSync(
    new URL(`./fixtures/${name}.html`, import.meta.url),
    "utf8",
  );
}

function source(id: string): Source {
  const found = SOURCES.find((s) => s.id === id);
  assert.ok(found, `unknown source ${id}`);
  return found;
}

/** Build the report a live fetch of `fixtureName` would have produced. */
function report(
  id: string,
  region: Region,
  date: string,
  fixtureName: string,
): SourceReport {
  const src = source(id);
  try {
    const draw = src.parse(fixture(fixtureName), region, date);
    return {
      id,
      name: src.name,
      family: src.family,
      priority: src.priority,
      ok: true,
      fetchedAt: NOW.toISOString(),
      durationMs: 1,
      draw,
    };
  } catch (err) {
    return {
      id,
      name: src.name,
      family: src.family,
      priority: src.priority,
      ok: false,
      error: String(err),
      fetchedAt: NOW.toISOString(),
      durationMs: 1,
    };
  }
}

const D = "2026-10-12"; // the day shown in the reference screenshots

function nightReports(): SourceReport[] {
  return [
    report("minhngoc", "mb", D, "minhngoc-mb-2026-10-12"),
    report("az24", "mb", D, "az24-mb-2026-10-12"),
    report("xsmn-mobi", "mb", D, "xsmn-mobi-mb-2026-10-12"),
    report("ngaydep", "mb", D, "ngaydep-mb-2026-10-12"),
  ];
}

function dayReports(): SourceReport[] {
  return [
    report("minhngoc", "mn", D, "minhngoc-mn-2026-10-12"),
    report("az24", "mn", D, "az24-mn-2026-10-12"),
    report("xsmn-mobi", "mn", D, "xsmn-mobi-mn-2026-10-12"),
    report("ngaydep", "mn", D, "ngaydep-mn-2026-10-12"),
  ];
}

test("every source parses the northern draw to the same 27 numbers", () => {
  for (const r of nightReports()) {
    assert.ok(r.ok, `${r.id}: ${r.error}`);
    const prizes = r.draw!.stations[0].prizes;
    assert.deepEqual(prizes.db, ["38287"], r.id);
    assert.deepEqual(prizes.g6, ["957", "840", "830"], r.id);
    assert.deepEqual(prizes.g7, ["49", "86", "38", "75"], r.id);
    assert.equal(prizes.g3?.length, 6, r.id);
    assert.equal(prizes.g5?.length, 6, r.id);
  }
});

test("southern pages expose the stations of the day (HCM missing on ngaydep)", () => {
  const slugs = Object.fromEntries(
    dayReports().map((r) => [r.id, r.draw!.stations.map((s) => s.slug)]),
  );
  assert.deepEqual(slugs.minhngoc, ["tp-hcm", "dong-thap", "ca-mau"]);
  assert.deepEqual(slugs.az24, ["tp-hcm", "dong-thap", "ca-mau"]);
  assert.deepEqual(slugs["xsmn-mobi"], ["tp-hcm", "dong-thap", "ca-mau"]);
  assert.deepEqual(slugs.ngaydep.sort(), ["ca-mau", "dong-thap"]);
});

test("night board equals the reference screenshot (12.10.2026)", () => {
  const draw = mergeReports("mb", D, nightReports(), undefined, NOW);
  assert.equal(draw.status, "complete");
  assert.equal(draw.verification, "verified");

  const view = buildShiftView("night", D, draw);
  const byKey = Object.fromEntries(view.rows.map((r) => [r.key, r.numbers]));
  assert.deepEqual(byKey.posA3, ["957", "840", "830"]);
  assert.deepEqual(byKey.posA2, ["49", "86", "38", "75"]);
  assert.deepEqual(byKey.posB, ["38", "287"]);
  assert.deepEqual(byKey.posC, ["87", "382"]);
  assert.deepEqual(byKey.posD, ["37", "828"]);
  assert.deepEqual(view.grid, [
    "680", "824", "761", "337",
    "868", "556", "458", "206",
    "045", "882", "875", "096",
    "272", "888", "187", "926",
    "016", "724", "781",
  ]);
});

test("day board equals the reference screenshot (12.10.2026)", () => {
  const draw = mergeReports("mn", D, dayReports(), undefined, NOW);
  assert.equal(draw.status, "complete");
  assert.equal(draw.verification, "verified");
  assert.deepEqual(
    draw.stations.map((s) => s.slug),
    ["tp-hcm", "dong-thap", "ca-mau"],
  );

  const view = buildShiftView("day", D, draw);
  const byKey = Object.fromEntries(view.rows.map((r) => [r.key, r.numbers]));
  assert.deepEqual(byKey.posA, ["91", "029"]);
  assert.deepEqual(byKey.posB, ["90", "770"]);
  assert.deepEqual(byKey.posC, ["70", "907"]);
  assert.deepEqual(byKey.posD, ["90", "077"]);
  assert.deepEqual(byKey.posF, ["92", "399"]);
  assert.deepEqual(byKey.posI, ["92", "399"]);
  assert.deepEqual(byKey.posN, ["25", "063"]);
  assert.deepEqual(view.grid, [
    "451", "017", "393", "811",
    "873", "134", "986", "949",
    "680", "589", "031", "855",
  ]);
});

test("a draw that has not happened parses as pending, not as an error", () => {
  const reports = [
    report("az24", "mb", "2026-10-13", "az24-mb-2026-10-13-pending"),
    report("ngaydep", "mb", "2026-10-13", "ngaydep-mb-2026-10-13-pending"),
  ];
  for (const r of reports) assert.ok(r.ok, `${r.id}: ${r.error}`);
  const draw = mergeReports("mb", "2026-10-13", reports, undefined, NOW);
  assert.equal(draw.status, "pending");
  assert.equal(draw.verification, "pending");
  const view = buildShiftView("night", "2026-10-13", draw);
  assert.equal(view.gridFilled, 0);
  assert.ok(view.rows.every((r) => r.numbers.every((n) => n === null)));
});

test("a single complete source is shown but flagged as unverified", () => {
  const draw = mergeReports(
    "mb",
    D,
    [report("az24", "mb", D, "az24-mb-2026-10-12")],
    undefined,
    NOW,
  );
  assert.equal(draw.status, "complete");
  assert.equal(draw.verification, "single");
});

test("two sites on the same backend do not verify each other", () => {
  const draw = mergeReports(
    "mb",
    D,
    [
      report("az24", "mb", D, "az24-mb-2026-10-12"),
      report("xsmn-mobi", "mb", D, "xsmn-mobi-mb-2026-10-12"),
    ],
    undefined,
    NOW,
  );
  assert.equal(draw.verification, "single");
});

test("disagreeing sources are flagged and the majority wins", () => {
  const reports = nightReports();
  // minhngoc says a different special prize.
  reports[0].draw!.stations[0].prizes.db = ["11111"];
  const draw = mergeReports("mb", D, reports, undefined, NOW);
  assert.equal(draw.verification, "conflict");
  assert.equal(draw.stations[0].prizes.db?.[0], "38287");
  assert.equal(draw.stations[0].conflicts?.length, 2);
  const minh = draw.sources.find((s) => s.id === "minhngoc");
  assert.equal(minh?.agrees, false);
});

test("malformed numbers are dropped, so the draw stays incomplete", () => {
  const reports = [report("az24", "mb", D, "az24-mb-2026-10-12")];
  reports[0].draw!.stations[0].prizes.g7 = ["49", "86", "3", "75"];
  const draw = mergeReports("mb", D, reports, undefined, NOW);
  assert.equal(draw.status, "partial");
  assert.equal(draw.verification, "pending");
});

test("a failed fetch never erases a finished result", () => {
  const good = mergeReports("mb", D, nightReports(), undefined, NOW);
  const failed: SourceReport[] = SOURCES.map((s) => ({
    id: s.id,
    name: s.name,
    family: s.family,
    priority: s.priority,
    ok: false,
    error: "timed out",
    fetchedAt: NOW.toISOString(),
    durationMs: 12000,
  }));
  const next = mergeReports("mb", D, failed, good, NOW);
  assert.equal(next.status, "complete");
  assert.equal(next.stations[0].prizes.db?.[0], "38287");
});

test("a page that shows a different day is rejected", () => {
  const r = report("az24", "mb", "2026-10-11", "az24-mb-2026-10-12");
  assert.equal(r.ok, false);
  assert.match(r.error!, /2026-10-11|another day/);
});

test("Vietnam calendar day and draw times", () => {
  // 18:30 UTC on the 12th is already 01:30 on the 13th in Vietnam.
  assert.equal(vnDateKey(new Date("2026-10-12T18:30:00Z")), "2026-10-13");
  assert.equal(vnDateKey(new Date("2026-10-12T16:59:00Z")), "2026-10-12");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(weekdayOf("2026-10-12"), 1); // Monday
  assert.equal(
    drawInstant("2026-10-12", "mb").toISOString(),
    "2026-10-12T11:15:00.000Z",
  );
});

test("StoredDraw round-trips through JSON", () => {
  const draw = mergeReports("mn", D, dayReports(), undefined, NOW);
  const copy = JSON.parse(JSON.stringify(draw)) as StoredDraw;
  assert.deepEqual(copy, JSON.parse(JSON.stringify(draw)));
});

// ---- polling policy ---------------------------------------------------------

import { planFor } from "../lib/lottery/schedule.ts";

function storedDraw(over: Partial<StoredDraw>): StoredDraw {
  return {
    date: "2026-10-13",
    region: "mb",
    status: "pending",
    verification: "pending",
    stations: [],
    sources: [],
    updatedAt: "2026-10-13T11:00:00.000Z",
    lastAttemptAt: "2026-10-13T11:00:00.000Z",
    ...over,
  };
}

test("poller sleeps until 5 minutes before the draw", () => {
  const now = new Date("2026-10-13T10:00:00Z"); // 17:00 ICT, draw at 18:15
  const plan = planFor("2026-10-13", "mb", undefined, now, 0);
  assert.equal(plan.fetchNow, false);
  assert.equal(plan.recheckInMs, 70 * 60_000); // wakes at 18:10 ICT
});

test("poller polls every 10 s while the result is being released", () => {
  const now = new Date("2026-10-13T11:20:00Z"); // 18:20 ICT
  const plan = planFor("2026-10-13", "mb", storedDraw({ status: "partial" }), now, 0);
  assert.deepEqual(plan, { fetchNow: true, recheckInMs: 10_000 });
});

test("poller stops once a draw is complete and verified", () => {
  const now = new Date("2026-10-13T11:40:00Z");
  const plan = planFor(
    "2026-10-13",
    "mb",
    storedDraw({ status: "complete", verification: "verified" }),
    now,
    3,
  );
  assert.deepEqual(plan, { fetchNow: false, recheckInMs: null });
});

test("poller keeps trying when only one site family has the result", () => {
  const now = new Date("2026-10-13T11:40:00Z");
  const plan = planFor(
    "2026-10-13",
    "mb",
    storedDraw({
      status: "complete",
      verification: "single",
      firstCompleteAt: "2026-10-13T11:30:00.000Z",
    }),
    now,
    3,
  );
  assert.deepEqual(plan, { fetchNow: true, recheckInMs: 30_000 });
});

test("past days are backfilled with a capped retry budget", () => {
  const now = new Date("2026-10-13T10:00:00Z");
  assert.equal(planFor("2026-10-10", "mn", undefined, now, 0).fetchNow, true);
  assert.equal(planFor("2026-10-10", "mn", undefined, now, 99).recheckInMs, null);
  assert.equal(planFor("2026-10-14", "mn", undefined, now, 0).recheckInMs, null);
});

// ---- guess numbers ----------------------------------------------------------

import {
  MIN_SAMPLE_DAYS,
  mostFrequentNumber,
  predictShift,
  samplesOf,
} from "../lib/lottery/predict.ts";
import type { DayRecord } from "../lib/lottery/types.ts";

function nightDraw(date: string, db: string, g6: string[]): StoredDraw {
  return storedDraw({
    date,
    region: "mb",
    status: "complete",
    verification: "verified",
    stations: [
      {
        slug: "mb",
        name: "mb",
        prizes: { db: [db], g6 },
        complete: true,
        verification: "verified",
        agreeing: [],
      },
    ],
  });
}

function dayDraw(date: string, db6: string, g7: string): StoredDraw {
  return storedDraw({
    date,
    region: "mn",
    status: "complete",
    verification: "verified",
    stations: [
      {
        slug: "tp-hcm",
        name: "tp-hcm",
        prizes: { db: [db6], g7: [g7] },
        complete: true,
        verification: "verified",
        agreeing: [],
      },
    ],
  });
}

test("most frequent digit per place, ties go to the most recent", () => {
  // place 0: 1,1,2 -> 1 ; place 1: 5,6,6 -> 6 ; place 2: 0,7,0 -> 0
  assert.equal(mostFrequentNumber(["150", "167", "260"]), "160");
  // all places tied 1-1: the later sample's digits win
  assert.equal(mostFrequentNumber(["123", "456"]), "456");
  assert.equal(mostFrequentNumber([]), null);
});

test("samples follow the result-screen rows (night and day)", () => {
  // Night 12.10.2026: posA3 957/840/830, special 38287 -> B=287, C=382
  const n = samplesOf("night", nightDraw("2026-10-12", "38287", ["957", "840", "830"]));
  assert.deepEqual(n, { A: ["957", "840", "830"], B: ["287"], C: ["382"] });
  // Day 12.10.2026 station 1: G7 029, special 290770 -> 90770 -> B=770, C=907
  const d = samplesOf("day", dayDraw("2026-10-12", "290770", "029"));
  assert.deepEqual(d, { A: ["029"], B: ["770"], C: ["907"] });
  // Unfinished draws contribute nothing.
  assert.equal(samplesOf("night", storedDraw({ region: "mb" })), null);
});

test("guess uses only earlier days, needs enough history, and ignores the target day", () => {
  const records: DayRecord[] = [];
  for (let i = 1; i <= MIN_SAMPLE_DAYS; i++) {
    const date = `2026-09-${String(i).padStart(2, "0")}`;
    records.push({ date, mb: nightDraw(date, "38287", ["957", "840", "830"]) });
  }
  // The target day itself and a later day must not influence the guess.
  records.push({ date: "2026-10-01", mb: nightDraw("2026-10-01", "11111", ["111", "111", "111"]) });
  records.push({ date: "2026-10-02", mb: nightDraw("2026-10-02", "22222", ["222", "222", "222"]) });

  const p = predictShift("night", "2026-10-01", records)!;
  assert.equal(p.sampleDays, MIN_SAMPLE_DAYS);
  // A: first place 8 (60x vs 9 30x); second place 5/4/3 tie, newest wins -> 3;
  // third place 0 (60x). B and C never vary.
  assert.deepEqual(
    p.guesses.map((g) => `${g.pos}${g.value}`),
    ["A830", "B287", "C382"],
  );
  assert.equal(predictShift("night", "2026-09-05", records), null); // too little history
});

// ---- fetch strategy: early exit and circuit breaker --------------------------

import { fetchAllSources, resetSourceHealth } from "../lib/lottery/sources.ts";

const FIXTURE_FOR: Record<string, string> = {
  minhngoc: "minhngoc-mb-2026-10-12",
  az24: "az24-mb-2026-10-12",
  "xsmn-mobi": "xsmn-mobi-mb-2026-10-12",
  ngaydep: "ngaydep-mb-2026-10-12",
};

/** A fake network: each site answers after `delays[id]` ms, or fails. */
function fakeFetcher(
  delays: Record<string, number>,
  failing: string[] = [],
  calls: string[] = [],
) {
  return (s: Source, region: Region, date: string, signal?: AbortSignal) =>
    new Promise<SourceReport>((resolve) => {
      calls.push(s.id);
      const done = (r: SourceReport) => resolve(r);
      const timer = setTimeout(() => {
        if (failing.includes(s.id)) {
          done({
            id: s.id, name: s.name, family: s.family, priority: s.priority,
            ok: false, error: "HTTP 503", fetchedAt: "", durationMs: delays[s.id],
          });
        } else {
          done(report(s.id, region, date, FIXTURE_FOR[s.id]));
        }
      }, delays[s.id]);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        done({
          id: s.id, name: s.name, family: s.family, priority: s.priority,
          ok: false, error: "not needed", fetchedAt: "", durationMs: 0,
        });
      });
    });
}

test("returns as soon as two site families agree; hung sites are not awaited", async () => {
  resetSourceHealth();
  const started = Date.now();
  const reports = await fetchAllSources("mb", D, {
    fetcher: fakeFetcher({ minhngoc: 20, az24: 40, "xsmn-mobi": 6000, ngaydep: 6000 }),
  });
  assert.ok(Date.now() - started < 1000, "must not wait for the hung sites");
  const draw = mergeReports("mb", D, reports, undefined, NOW);
  assert.equal(draw.status, "complete");
  assert.equal(draw.verification, "verified");
  assert.equal(reports.length, 4); // every site is still accounted for
  assert.equal(reports.find((r) => r.id === "ngaydep")?.ok, false);
});

test("same-backend sites alone do not trigger an early exit", async () => {
  resetSourceHealth();
  const started = Date.now();
  const reports = await fetchAllSources("mb", D, {
    // az24 + mobi answer first (one family); minhngoc arrives later.
    fetcher: fakeFetcher({ az24: 10, "xsmn-mobi": 10, minhngoc: 150, ngaydep: 6000 }),
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 140 && elapsed < 1500, `waited for a second family (${elapsed}ms)`);
  assert.equal(mergeReports("mb", D, reports, undefined, NOW).verification, "verified");
});

test("a site that keeps failing is skipped (circuit breaker)", async () => {
  resetSourceHealth();
  const calls: string[] = [];
  const fetcher = fakeFetcher(
    { minhngoc: 5, az24: 5, "xsmn-mobi": 5, ngaydep: 5 },
    ["ngaydep"],
    calls,
  );
  // ngaydep fails three rounds in a row (the breaker opens on the 3rd). The
  // other sites are slower than its failure so it is always consulted first.
  const slow = fakeFetcher(
    { minhngoc: 60, az24: 60, "xsmn-mobi": 60, ngaydep: 5 },
    ["ngaydep"],
    calls,
  );
  for (let i = 0; i < 3; i++) await fetchAllSources("mb", D, { fetcher: slow });
  calls.length = 0;
  const reports = await fetchAllSources("mb", D, { fetcher });
  assert.ok(!calls.includes("ngaydep"), "open breaker => not requested");
  assert.equal(reports.find((r) => r.id === "ngaydep")?.error, "skipped while failing");
  resetSourceHealth();
});

test("one unconfirmed family: waits only the grace period, then returns it", async () => {
  resetSourceHealth();
  const started = Date.now();
  const reports = await fetchAllSources("mb", D, {
    graceMs: 120,
    // Only az24 + mobi (one family) answer; the other families hang.
    fetcher: fakeFetcher({ az24: 10, "xsmn-mobi": 10, minhngoc: 6000, ngaydep: 6000 }),
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 100 && elapsed < 1500, `returned after grace (${elapsed}ms)`);
  const draw = mergeReports("mb", D, reports, undefined, NOW);
  assert.equal(draw.status, "complete");
  assert.equal(draw.verification, "single");
});
