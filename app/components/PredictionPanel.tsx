import type { ResultsPayload } from "@/lib/lottery/api";
import { KM, MoonIcon, SunIcon } from "./ShiftCard";

const TITLE = "ទាយ";

/**
 * "ទាយ" (guess): one 3-digit number for posA, posB and posC of each shift.
 * Always shown for the selected day, before and after the result is out.
 * Renders nothing until enough history exists to compute a guess.
 */
export default function PredictionPanel({
  prediction,
}: {
  prediction: ResultsPayload["prediction"];
}) {
  const shifts = (["day", "night"] as const).filter((s) => prediction[s]);
  if (shifts.length === 0) return null;

  return (
    <section aria-labelledby="guess-heading" className="guess mt-4">
      <h2 id="guess-heading" className="guess-title serif">
        {TITLE}
      </h2>
      <div className="guess-grid">
        {shifts.map((shift) => (
          <div
            key={shift}
            className="guess-col"
            style={{
              ["--accent" as string]:
                shift === "day" ? "var(--day)" : "var(--night)",
            }}
          >
            <div className="guess-head">
              <span className="guess-icon">
                {shift === "day" ? <SunIcon /> : <MoonIcon />}
              </span>
              {KM.pill[shift]}
            </div>
            <ul className="m-0 list-none p-0">
              {prediction[shift]!.guesses.map((g, i) => (
                <li
                  key={g.pos}
                  className="guess-row"
                  data-band={i % 2 === 0 ? "light" : "slate"}
                >
                  <span className="guess-pos serif">
                    {KM.pos} {g.pos}
                  </span>
                  <span className="guess-num serif">{g.value}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
