import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ShiftPrediction } from "./predict.ts";
import type { DayRecord, Region, StoredDraw } from "./types.ts";

/**
 * One record per Vietnam calendar day, holding both draws and the day's
 * guesses. Backends, chosen from the environment:
 *
 *  1. Redis over REST (Upstash / Vercel KV): persistent and shared between
 *     serverless instances. Used when UPSTASH_REDIS_REST_URL/_TOKEN or
 *     KV_REST_API_URL/_TOKEN are set. Needed for history on Vercel.
 *  2. JSON files in LOTTERY_DATA_DIR or ./.data (long-running Node servers).
 *  3. If that disk is read-only (serverless), files in the OS temp dir, and as
 *     a last resort process memory. Results still show because every request
 *     can refresh from the sources, but history does not survive.
 *
 * A failing backend never throws out of here: reads fall back to memory and
 * writes are kept in memory, so the page keeps working.
 *
 * Next.js may bundle this module separately per entry point, so shared state
 * lives on globalThis.
 */

const g = globalThis as typeof globalThis & {
  __lotteryWriteQueue?: Map<string, Promise<void>>;
  __lotteryMemory?: Map<string, DayRecord>;
  __lotteryDiskDir?: string;
};
const writeQueue = (g.__lotteryWriteQueue ??= new Map());
const memory = (g.__lotteryMemory ??= new Map<string, DayRecord>());

/**
 * Upstash / Vercel KV expose "<PREFIX>_REST_API_URL" and "<PREFIX>_REST_API_TOKEN"
 * (KV, STORAGE, UPSTASH_REDIS ... depending on the prefix chosen when the
 * database was connected), so any matching pair is accepted.
 */
function findRedis(): { url?: string; token?: string } {
  const env = process.env;
  for (const key of Object.keys(env)) {
    const m = key.match(/^(.*)_REST_API_URL$/) ?? key.match(/^(.*)_REST_URL$/);
    if (!m) continue;
    const token =
      env[`${m[1]}_REST_API_TOKEN`] ?? env[`${m[1]}_REST_TOKEN`];
    if (env[key] && token) return { url: env[key], token };
  }
  return {};
}
const found = findRedis();
const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? found.url;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? found.token;
const useRedis = Boolean(redisUrl && redisToken);

export function storeBackend(): "redis" | "disk" {
  return useRedis ? "redis" : "disk";
}

// ---- Redis (REST) ----------------------------------------------------------

const TTL_SECONDS = 120 * 24 * 60 * 60;
const redisKey = (date: string) => `lottery:day:${date}`;

async function redis<T>(command: (string | number)[]): Promise<T> {
  const res = await fetch(redisUrl!, {
    method: "POST",
    headers: {
      authorization: `Bearer ${redisToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
  });
  const body = (await res.json()) as { result?: T; error?: string };
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `redis HTTP ${res.status}`);
  }
  return body.result as T;
}

// ---- Disk ------------------------------------------------------------------

function preferredDir(): string {
  return process.env.LOTTERY_DATA_DIR ?? path.join(process.cwd(), ".data");
}

/** First directory we can actually create and write to. */
async function diskDir(): Promise<string> {
  if (g.__lotteryDiskDir) return g.__lotteryDiskDir;
  const candidates = [preferredDir(), path.join(os.tmpdir(), "lottery-data")];
  for (const dir of candidates) {
    try {
      await mkdir(dir, { recursive: true });
      const probe = path.join(dir, `.probe-${process.pid}`);
      await writeFile(probe, "ok", "utf8");
      g.__lotteryDiskDir = dir;
      return dir;
    } catch {
      // try the next one
    }
  }
  throw new Error("no writable data directory");
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

// ---- Public API ------------------------------------------------------------

async function readBackend(date: string): Promise<DayRecord | undefined> {
  if (useRedis) {
    const raw = await redis<string | null>(["GET", redisKey(date)]);
    return raw ? (JSON.parse(raw) as DayRecord) : undefined;
  }
  const dir = await diskDir();
  try {
    return JSON.parse(
      await readFile(path.join(dir, `${date}.json`), "utf8"),
    ) as DayRecord;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || err instanceof SyntaxError) return undefined;
    throw err;
  }
}

async function writeBackend(record: DayRecord): Promise<void> {
  if (useRedis) {
    await redis([
      "SET",
      redisKey(record.date),
      JSON.stringify(record),
      "EX",
      TTL_SECONDS,
    ]);
    return;
  }
  const dir = await diskDir();
  const target = path.join(dir, `${record.date}.json`);
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
  await replaceFile(tmp, target);
}

export async function readDay(date: string): Promise<DayRecord> {
  try {
    const stored = await readBackend(date);
    if (stored) return { ...stored, date };
  } catch (err) {
    console.error(`[lottery] read ${date} failed:`, (err as Error).message);
  }
  const cached = memory.get(date);
  return cached ? { ...cached, date } : { date };
}

/** Read-modify-write one day. Writes for a day are serialised. */
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
      memory.set(date, record); // always keep the latest in memory
      try {
        await writeBackend(record);
      } catch (err) {
        // Never fail the request because persistence is unavailable.
        console.error(`[lottery] write ${date} failed:`, (err as Error).message);
      }
    });
  writeQueue.set(date, next);
  return next;
}

/** Replace one draw inside its day record. */
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
