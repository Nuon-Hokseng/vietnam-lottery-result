import { slugify, stationName, stationSlug } from "./stations.ts";
import { formatDMY } from "./time.ts";
import type {
  ParsedDraw,
  ParsedStation,
  PrizeKey,
  Prizes,
  Region,
} from "./types.ts";

/**
 * Result pages are scraped with regexes over small, regular tables. Two rules
 * keep this safe:
 *  1. only text nodes made purely of digits count as numbers, so loading
 *     spinners, "&zwj;" placeholders and images are ignored (-> pending);
 *  2. a page that has no recognisable result table throws, so a layout change
 *     shows up as a source error instead of a silently empty result.
 */

const ZERO_WIDTH = /[​-‍﻿]/g;

function decodeEntities(text: string): string {
  return text
    .replace(/&(?:zwj|zwnj);|&#8205;|&#8204;/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(
      /&([a-z])(?:grave|acute|circ|tilde|uml|cedil|ring|horn|breve);/gi,
      "$1",
    );
}

/** Visible text fragments of an HTML snippet, in document order. */
function textTokens(html: string): string[] {
  return html
    .replace(/<[^>]*>/g, "|")
    .split("|")
    .map((t) => decodeEntities(t).replace(ZERO_WIDTH, "").trim())
    .filter(Boolean);
}

function numbersIn(html: string): string[] {
  return textTokens(html).filter((t) => /^\d+$/.test(t));
}

const LABELS: Record<string, PrizeKey | "ignore"> = {
  db: "db",
  gdb: "db",
  dacbiet: "db",
  giaidb: "db",
  giaidacbiet: "db",
  g1: "g1",
  giainhat: "g1",
  g2: "g2",
  giainhi: "g2",
  g3: "g3",
  giaiba: "g3",
  g4: "g4",
  giaitu: "g4",
  g5: "g5",
  giainam: "g5",
  g6: "g6",
  giaisau: "g6",
  g7: "g7",
  giaibay: "g7",
  g8: "g8",
  giaitam: "g8",
  madb: "ignore",
};

/** "Giải nhì" / "G.2" / "G2" -> "g2"; null when the cell is not a prize label. */
function labelKey(cellHtml: string): PrizeKey | "ignore" | null {
  const text = textTokens(cellHtml).join(" ");
  if (!text) return null;
  return LABELS[slugify(text).replace(/-/g, "")] ?? null;
}

const PRIZE_BY_MINHNGOC_CLASS: Record<string, PrizeKey> = {
  db: "db",
  "1": "g1",
  "2": "g2",
  "3": "g3",
  "4": "g4",
  "5": "g5",
  "6": "g6",
  "7": "g7",
  "8": "g8",
};

function readRows(tableHtml: string): string[][] {
  return [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(
      (cell) => cell[2],
    ),
  );
}

/** Tables that contain no other table: the actual result grids. */
function innermostTables(html: string): { html: string; index: number }[] {
  const re = /<table\b(?:(?!<table\b)[\s\S])*?<\/table>/gi;
  return [...html.matchAll(re)].map((m) => ({ html: m[0], index: m.index }));
}

function labelsOf(rows: string[][]): Set<PrizeKey | "ignore"> {
  const found = new Set<PrizeKey | "ignore">();
  for (const row of rows) {
    const key = row[0] === undefined ? null : labelKey(row[0]);
    if (key) found.add(key);
  }
  return found;
}

/** Does the text just before the table (title + heading) mention this date? */
function mentionsDate(html: string, tableIndex: number, dateKey: string) {
  const [y, m, d] = dateKey.split("-");
  const dd = `0?${Number(d)}`;
  const mm = `0?${Number(m)}`;
  const patterns = [
    new RegExp(`\\b${dd}[-/.]${mm}[-/.]${y}\\b`),
    new RegExp(`\\b${dd}\\s+tháng\\s+${mm}\\s+năm\\s+${y}\\b`, "i"),
  ];
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const nearby = html.slice(Math.max(0, tableIndex - 6000), tableIndex);
  return patterns.some((p) => p.test(title) || p.test(nearby));
}

function parseNorthTable(rows: string[][]): ParsedDraw {
  const prizes: Prizes = {};
  let current: PrizeKey | null = null;

  for (const row of rows) {
    if (row.length === 0) continue;
    const key = labelKey(row[0]);
    let valueCells: string[];
    if (key) {
      current = key === "ignore" ? null : key;
      valueCells = row.slice(1);
    } else {
      // Second line of a prize that spans two table rows (G3, G5 on some sites).
      valueCells = row;
    }
    if (!current) continue;
    const found = valueCells.flatMap(numbersIn);
    if (found.length) prizes[current] = [...(prizes[current] ?? []), ...found];
  }

  return { stations: [{ slug: "mb", name: "Miền Bắc", prizes }] };
}

function parseSouthTable(rows: string[][]): ParsedDraw {
  const headerIdx = rows.findIndex(
    (row) =>
      row.length >= 2 &&
      labelKey(row[0]) === null &&
      row.slice(1).some((cell) => textTokens(cell).length > 0),
  );
  if (headerIdx === -1) return { stations: [] };

  const columns = rows[headerIdx].slice(1).map((cell) => {
    const raw = textTokens(cell).join(" ");
    if (!raw) return null;
    const slug = stationSlug(raw);
    return { slug, name: stationName(slug, raw), prizes: {} as Prizes };
  });

  for (const row of rows.slice(headerIdx + 1)) {
    const key = row[0] === undefined ? null : labelKey(row[0]);
    if (!key || key === "ignore") continue;
    row.slice(1).forEach((cell, i) => {
      const col = columns[i];
      if (!col) return;
      const found = numbersIn(cell);
      if (found.length) col.prizes[key] = found;
    });
  }

  const stations = columns.filter((c): c is ParsedStation => c !== null);
  return { stations };
}

/**
 * az24.vn, xsmn.mobi and ngaydep.com: one HTML table per draw, prize label in
 * the first column.
 */
export function parseGenericPage(
  html: string,
  region: Region,
  dateKey: string,
): ParsedDraw {
  for (const table of innermostTables(html)) {
    const rows = readRows(table.html);
    const labels = labelsOf(rows);
    const isSouth = labels.has("g8") && labels.has("g7") && labels.has("db");
    const isNorth =
      !labels.has("g8") && labels.has("g7") && labels.has("db") && labels.has("g1");
    if (region === "mn" ? !isSouth : !isNorth) continue;

    if (!mentionsDate(html, table.index, dateKey)) {
      throw new Error(`page does not show ${dateKey} (site returned another day)`);
    }
    return region === "mn" ? parseSouthTable(rows) : parseNorthTable(rows);
  }
  throw new Error("result table not found (site layout may have changed)");
}

/**
 * minhngoc.net.vn lists several days on one page; each day sits in a
 * `box_kqxs` block titled with its date.
 */
export function parseMinhNgoc(
  html: string,
  region: Region,
  dateKey: string,
): ParsedDraw {
  const dmy = formatDMY(dateKey, "/");
  const block = html
    .split(/class="box_kqxs"/)
    .find((chunk) => chunk.includes(`>${dmy}</a></div>`));
  if (!block) throw new Error(`no block for ${dmy} on page`);

  const prizeCells = (segment: string): Prizes => {
    const prizes: Prizes = {};
    for (const m of segment.matchAll(
      /<td class="giai(db|[1-8])">([\s\S]*?)<\/td>/g,
    )) {
      const found = numbersIn(m[2]);
      if (found.length) prizes[PRIZE_BY_MINHNGOC_CLASS[m[1]]] = found;
    }
    return prizes;
  };

  if (region === "mb") {
    if (!/class="giaidb"/.test(block)) throw new Error("northern table missing");
    return {
      stations: [{ slug: "mb", name: "Miền Bắc", prizes: prizeCells(block) }],
    };
  }

  // Southern: the first segment is the label column; each later one a station.
  const segments = block.split(/<td class="tinh">/).slice(1);
  if (segments.length === 0) throw new Error("southern stations missing");
  const stations = segments.map((segment) => {
    const raw = textTokens(segment.split("</td>")[0]).join(" ");
    const slug = stationSlug(raw);
    return { slug, name: stationName(slug, raw), prizes: prizeCells(segment) };
  });
  return { stations };
}
