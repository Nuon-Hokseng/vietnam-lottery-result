import type { ShiftView } from "@/lib/lottery/derive";

/**
 * One phone-style result screen, laid out like the reference app:
 *   app bar -> date bar -> banded pos rows -> Lo banner -> number grid.
 * Only Khmer labels, numbers and the day/night indicator are shown.
 */

type RowColor = "blue" | "orange" | "red" | "pink" | "brick" | "mint" | "white";

/** Row text colour per shift and pos, as in the reference screenshots. */
const ROW_COLOR: Record<string, RowColor> = {
  "night:posA3": "blue",
  "night:posA2": "mint",
  "night:posB": "orange",
  "night:posC": "white",
  "night:posD": "pink",
  "day:posA": "blue",
  "day:posB": "white",
  "day:posC": "red",
  "day:posD": "mint",
  "day:posF": "orange",
  "day:posI": "mint",
  "day:posN": "brick",
};

export const KM = {
  title: { day: "លទ្ធផលពេលថ្ងៃ", night: "លទ្ធផលពេលយប់" },
  pill: { day: "ពេលថ្ងៃ", night: "ពេលយប់" },
  date: "ថ្ងៃទី",
  pos: "ប៉ុស្តិ៍",
  lo: "ប៉ុស្តិ៍ Lo",
  notOut: "មិនទាន់ចេញ",
  coming: "កំពុងចេញ",
  unconfirmed: "មិនទាន់បញ្ជាក់",
  differs: "ខុសគ្នា",
};

/** "2026-10-12" -> "12.10.2026" */
function dotted(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${d}.${m}.${y}`;
}

/** "posA3" -> "ប៉ុស្តិ៍ A3" */
function posLabel(key: string): string {
  return `${KM.pos} ${key.replace(/^pos/, "")}`;
}

type Tone = "ok" | "warn" | "bad" | "wait" | "live";

/** 3725000 ms -> "01:02:05" */
function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/**
 * A short chip next to the title: the countdown while today's result is still
 * due, a state word when something needs attention, nothing for a normal
 * finished result.
 */
function chipFor(
  view: ShiftView,
  drawsAt: string,
  isToday: boolean,
  now: number,
): { tone: Tone; text: string; timer?: boolean } | null {
  if (view.status === "complete") {
    if (view.verification === "conflict") {
      return { tone: "bad", text: KM.differs };
    }
    if (view.verification === "single") {
      return { tone: "warn", text: KM.unconfirmed };
    }
    return null;
  }
  if (view.status === "partial") return { tone: "live", text: KM.coming };
  if (isToday) {
    const left = Date.parse(drawsAt) - now;
    if (left > 0) return { tone: "wait", text: countdown(left), timer: true };
    return { tone: "live", text: KM.coming };
  }
  return { tone: "wait", text: KM.notOut };
}

function Num({
  value,
  arrived,
}: {
  value: string | null;
  arrived: boolean;
}) {
  if (value === null) {
    return (
      <span className="serif pending-num" aria-label={KM.notOut}>
        ···
      </span>
    );
  }
  return <span className={`serif ${arrived ? "arrived" : ""}`}>{value}</span>;
}

export function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4.2" fill="currentColor" />
      <path
        d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z"
        fill="currentColor"
      />
    </svg>
  );
}

export interface ShiftCardProps {
  view: ShiftView;
  drawsAt: string;
  isToday: boolean;
  now: number;
  /** Slot ids ("day:posA:1", "night:grid:4") that filled in since last poll. */
  arrived: ReadonlySet<string>;
  className?: string;
}

export default function ShiftCard({
  view,
  drawsAt,
  isToday,
  now,
  arrived,
  className = "",
}: ShiftCardProps) {
  const isDay = view.shift === "day";
  const chip = chipFor(view, drawsAt, isToday, now);
  const headingId = `${view.shift}-heading`;

  return (
    <div className={className}>
      <section
        aria-labelledby={headingId}
        className="screen"
        style={{
          ["--accent" as string]: isDay ? "var(--day)" : "var(--night)",
        }}
      >
        <header className="screen-bar">
          <h2 id={headingId} className="screen-title">
            {KM.title[view.shift]}
          </h2>
          {chip && (
            <span
              className="status-chip tabular-nums"
              data-tone={chip.tone}
              role={chip.timer ? "timer" : "status"}
            >
              {chip.tone === "live" && (
                <span
                  className="live-dot inline-block size-[0.55em] rounded-full bg-current"
                  aria-hidden
                />
              )}
              {chip.text}
            </span>
          )}
        </header>

        <div className="sub-bar">
          <span className="sub-pill">{KM.pill[view.shift]}</span>
          <span className="sub-date serif">
            {KM.date} {dotted(view.date)}
          </span>
        </div>

        <ol className="rows">
          {view.rows.map((row, i) => (
            <li
              key={row.key}
              className="row"
              data-band={i % 2 === 0 ? "light" : "slate"}
              style={{
                ["--row-fg" as string]: `var(--c-${
                  ROW_COLOR[`${view.shift}:${row.key}`] ?? "blue"
                })`,
              }}
            >
              <span className="row-label serif">{posLabel(row.key)}</span>
              <span className="row-nums">
                {row.numbers.map((value, n) => (
                  <Num
                    key={`${n}-${value ?? "x"}`}
                    value={value}
                    arrived={arrived.has(`${view.shift}:${row.key}:${n}`)}
                  />
                ))}
              </span>
            </li>
          ))}
        </ol>

        <div className="banner">
          <span className="banner-icon">
            {isDay ? <SunIcon /> : <MoonIcon />}
          </span>
          <h3 className="banner-title serif">{KM.lo}</h3>
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            aria-hidden
            className="shrink-0"
          >
            <path
              d="m9 5 7 7-7 7"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="lo-grid">
          {view.grid.map((value, i) => (
            <span key={i} className="lo-cell">
              <Num
                key={`${i}-${value ?? "x"}`}
                value={value}
                arrived={arrived.has(`${view.shift}:grid:${i}`)}
              />
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
