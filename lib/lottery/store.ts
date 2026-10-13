import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ShiftPrediction } from "./predict.ts";
import type { DayRecord, Region, StoredDraw } from "./types.ts";

/**
 * File-backed store: one JSON file per Vietnam calendar day, holding both
 * draws. Plain files keep the project dependency-free; swap this module for a
 * database if the app ever runs on more than one server.
 *
 * Next.js may bundle this module separately for the poller and for route
 * handlers, so the write queue lives on globalThis rather than module scope.
 */

const g = globalThis as typeof globalThis & {
  __lotteryWriteQueue?: Map<string, Promise<void>>;
};
const writeQueue = (g.__lotteryWriteQueue ??= new Map());

function dataDir(): string {
  return process.env.LOTTERY_DATA_DIR ?? path.join(process.cwd(), ".data");
}

function fileFor(date: string): string {
  return path.join(dataDir(), `${date}.json`);
}

export async function readDay(date: string): Promise<DayRecord> {
  try {
    const raw = await readFile(fileFor(date), "utf8");
    const parsed = JSON.parse(raw) as DayRecord;
    return { ...parsed, date };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || err instanceof SyntaxError) return { date };
    throw err;
  }
}

async function replaceFile(tmp: string, target: string): Promise<void> {
  // Windows can briefly lock the target while a reader has it open.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, target);
      return;
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
    }
  }
}

/** Read-modify-write one day file. Writes for a day are serialised. */
function updateDay(
  date: string,
  mutate: (record: DayRecord) => void,
): Promise<void> {
  const previous = writeQueue.get(date) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const record = await readDay(date);
      mutate(record);
      await mkdir(dataDir(), { recursive: true });
      const target = fileFor(date);
      const tmp = `${target}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
      await replaceFile(tmp, target);
    });
  writeQueue.set(date, next);
  return next;
}

/** Replace one draw inside its day file. */
export function writeDraw(draw: StoredDraw): Promise<void> {
  return updateDay(draw.date, (record) => {
    record[draw.region as Region] = draw;
  });
}

/** Keep the first guess made for a day; later calls never overwrite it. */
export function writePrediction(prediction: ShiftPrediction): Promise<void> {
  return updateDay(prediction.date, (record) => {
    record.predictions ??= {};
    record.predictions[prediction.shift] ??= prediction;
  });
}
