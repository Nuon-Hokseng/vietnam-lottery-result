"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ResultsPayload } from "@/lib/lottery/api";
import PredictionPanel from "./PredictionPanel";
import ShiftCard, { KM, MoonIcon, SunIcon } from "./ShiftCard";

const NIGHT_LEAD_MS = 5 * 60_000;

type Shift = "day" | "night";
type DrawState = "complete" | "partial" | "pending";

const TODAY = "ថ្ងៃនេះ";
const YESTERDAY = "ម្សិលមិញ";
const LOAD_ERROR = "មិនអាចតភ្ជាប់បាន";

// Sunday first, matching Date#getUTCDay. Spelled out rather than taken from
// Intl so the labels do not depend on the browser's locale data.
const WEEKDAYS_KM = [
  "អាទិត្យ",
  "ច័ន្ទ",
  "អង្គារ",
  "ពុធ",
  "ព្រហស្បតិ៍",
  "សុក្រ",
  "សៅរ៍",
];

/** Khmer weekday + day of month, e.g. "ច័ន្ទ 12". */
function formatChip(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS_KM[weekday]} ${d}`;
}

function slotsOf(data: ResultsPayload): Map<string, string | null> {
  const slots = new Map<string, string | null>();
  for (const view of [data.day, data.night]) {
    for (const row of view.rows) {
      row.numbers.forEach((n, i) =>
        slots.set(`${view.shift}:${row.key}:${i}`, n),
      );
    }
    view.grid.forEach((n, i) => slots.set(`${view.shift}:grid:${i}`, n));
  }
  return slots;
}

/** Slots that were empty in `prev` and have a number now. */
function newlyArrived(prev: ResultsPayload, next: ResultsPayload): Set<string> {
  const out = new Set<string>();
  if (prev.date !== next.date) return out;
  const before = slotsOf(prev);
  for (const [id, value] of slotsOf(next)) {
    if (value !== null && before.get(id) === null) out.add(id);
  }
  return out;
}

/** Small sun / moon: coloured when that shift's result is in, faint when not. */
function ShiftMark({
  shift,
  state,
  onAccent,
}: {
  shift: Shift;
  state: DrawState;
  /** Drawn on the selected (purple) chip, where the usual colours vanish. */
  onAccent: boolean;
}) {
  const color = onAccent
    ? "#ffffff"
    : state === "pending"
      ? "var(--muted)"
      : shift === "day"
        ? "var(--day)"
        : "var(--night)";
  return (
    <span
      className="block size-4"
      style={{
        color,
        opacity: state === "complete" ? 1 : state === "partial" ? 0.75 : 0.4,
      }}
    >
      {shift === "day" ? <SunIcon /> : <MoonIcon />}
    </span>
  );
}

export default function Dashboard({
  initialDate = null,
}: {
  initialDate?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(initialDate); // null = today
  // Last payload received, plus every day seen so far. Switching to a day
  // that is already cached shows it instantly while it refreshes underneath.
  const [latestData, setLatestData] = useState<ResultsPayload | null>(null);
  const [cache, setCache] = useState<Record<string, ResultsPayload>>({});
  const [arrived, setArrived] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(0);
  const [picked, setPicked] = useState<Shift | null>(null);
  const latest = useRef<ResultsPayload | null>(null);

  // Fetch loop: re-armed with the server's hint (10 s while a draw is being
  // released, 60 s otherwise). Paused while the tab is hidden.
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const arm = (ms: number) => {
      if (!stopped) timer = setTimeout(load, ms);
    };

    async function load() {
      if (document.hidden) return arm(5_000);
      try {
        const query = selected ? `?date=${selected}` : "";
        // A request that never answers would otherwise stall the loop.
        const res = await fetch(`/api/results${query}`, {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(20_000),
          ]),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        if (stopped) return;
        const payload = body as ResultsPayload;
        setArrived(
          latest.current ? newlyArrived(latest.current, payload) : new Set(),
        );
        latest.current = payload;
        setLatestData(payload);
        setCache((c) => ({ ...c, [payload.date]: payload }));
        setFailed(false);
        arm(payload.pollHintMs);
      } catch {
        if (stopped) return;
        setFailed(true);
        arm(10_000);
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void load();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    void load();

    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [selected]);

  // Clock used only to flip "not out yet" to "coming out" at draw time.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  // Warm the cache once: fetch the other days quietly so every tab switch
  // after the first load is instant.
  const warmKey = latestData?.today ?? null;
  useEffect(() => {
    if (!warmKey) return;
    const dates = (latest.current?.history ?? []).map((h) => h.date);
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      for (const date of dates) {
        if (cancelled) return;
        if (date === latest.current?.date) continue;
        await new Promise((r) => setTimeout(r, 400));
        try {
          const res = await fetch(`/api/results?date=${date}`, {
            signal: controller.signal,
          });
          if (!res.ok) continue;
          const payload = (await res.json()) as ResultsPayload;
          if (!cancelled) {
            setCache((c) => (c[date] ? c : { ...c, [date]: payload }));
          }
        } catch {
          // best effort only
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [warmKey]);

  const wanted = selected ?? latestData?.today ?? null;
  const data = (wanted && cache[wanted]) || latestData;

  const isToday = data ? data.date === data.today : selected === null;
  const switching = Boolean(data && wanted && data.date !== wanted);
  const clock = now || (data ? Date.parse(data.serverTime) : 0);

  // On narrow screens one app-style screen is shown at a time. Default to the
  // shift that matters most right now; the viewer's own choice always wins.
  const autoShift: Shift = useMemo(() => {
    if (!data) return "night";
    if (data.date !== data.today) return "night";
    const nightStarted =
      data.night.status !== "pending" ||
      clock >= Date.parse(data.drawsAt.night) - NIGHT_LEAD_MS;
    return nightStarted ? "night" : "day";
  }, [data, clock]);
  const shift = picked ?? autoShift;

  return (
    <div className="mx-auto w-full max-w-5xl px-3 pb-12 pt-5 sm:px-6 sm:pt-8">
      <nav aria-label="ថ្ងៃ">
        <ul className="-mx-3 flex snap-x scroll-pl-3 gap-2 overflow-x-auto px-3 pb-2 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:scroll-pl-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          {(data?.history ?? []).map((entry, i) => {
            const active = data?.date === entry.date;
            return (
              <li key={entry.date} className="shrink-0 snap-start">
                <button
                  type="button"
                  onClick={() => {
                    const next = i === 0 ? null : entry.date;
                    setSelected(next);
                    setPicked(null);
                    window.history.replaceState(
                      null,
                      "",
                      next ? `/?date=${next}` : "/",
                    );
                  }}
                  aria-pressed={active}
                  className={`flex min-h-14 min-w-[4.6rem] flex-col items-center justify-center gap-1 rounded-2xl border px-3 py-1.5 text-[0.95rem] leading-snug transition-colors ${
                    active
                      ? "border-transparent bg-night text-white"
                      : "border-line bg-surface hover:bg-line/40"
                  }`}
                >
                  <span className="font-semibold">
                    {i === 0
                      ? TODAY
                      : i === 1
                        ? YESTERDAY
                        : formatChip(entry.date)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <ShiftMark shift="day" state={entry.day.status} onAccent={active} />
                    <ShiftMark
                      shift="night"
                      state={entry.night.status}
                      onAccent={active}
                    />
                  </span>
                </button>
              </li>
            );
          })}
          {!data &&
            Array.from({ length: 4 }, (_, i) => (
              <li
                key={i}
                className="h-14 w-[4.6rem] shrink-0 rounded-2xl bg-line/50"
              />
            ))}
        </ul>
      </nav>

      {failed && !data && (
        <p className="mt-4 text-center text-(--bad)" role="alert">
          {LOAD_ERROR}
        </p>
      )}

      {data && <PredictionPanel prediction={data.prediction} />}

      {/* Day / Night switch: only below the width where both screens fit. */}
      <div
        role="group"
        className="mt-3 grid grid-cols-2 gap-1 rounded-2xl border border-line bg-surface p-1 lg:hidden"
      >
        {(["day", "night"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={shift === s}
            onClick={() => setPicked(s)}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-xl text-base font-semibold leading-snug transition-colors ${
              shift === s
                ? s === "day"
                  ? "bg-day text-white"
                  : "bg-night text-white"
                : "text-muted hover:bg-line/40"
            }`}
          >
            <span className="block size-5">
              {s === "day" ? <SunIcon /> : <MoonIcon />}
            </span>
            {KM.pill[s]}
          </button>
        ))}
      </div>

      <main
        className={`mt-4 grid items-start gap-5 transition-opacity lg:grid-cols-2 ${
          switching ? "opacity-60" : ""
        }`}
        aria-busy={switching}
      >
        {data ? (
          <>
            <ShiftCard
              className={shift === "day" ? "" : "hidden lg:block"}
              view={data.day}
              drawsAt={data.drawsAt.day}
              isToday={isToday}
              now={clock}
              arrived={arrived}
            />
            <ShiftCard
              className={shift === "night" ? "" : "hidden lg:block"}
              view={data.night}
              drawsAt={data.drawsAt.night}
              isToday={isToday}
              now={clock}
              arrived={arrived}
            />
          </>
        ) : (
          <>
            <Skeleton />
            <Skeleton className="hidden lg:block" />
          </>
        )}
      </main>
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`mx-auto aspect-9/16 w-full max-w-120 animate-pulse rounded-3xl border border-line bg-surface motion-reduce:animate-none ${className}`}
      aria-hidden
    />
  );
}
