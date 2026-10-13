# Vietnam lottery results (Khmer UI)

Day (XSMN, drawn 16:15) and night (XSMB, drawn 18:15) results, laid out like the
reference app: `ប៉ុស្តិ៍ A…N` rows plus the `ប៉ុស្តិ៍ Lo` number grid. Shows today,
yesterday and the previous week.

```bash
npm install
npm run dev      # or: npm run build && npm start
npm test         # parsers, cross-checking, scheduling, screenshot equality
```

## How it works

- **Poller** (`instrumentation.ts` -> `lib/lottery/poller.ts`) starts with the
  server. It sleeps until 5 minutes before each draw, then fetches every 10 s
  until the result is complete and confirmed by two independent sites. Past days
  are backfilled on start-up.
- **Sources** (`lib/lottery/sources.ts`): minhngoc.net.vn, az24.vn, xsmn.mobi,
  ngaydep.com. az24.vn and xsmn.mobi share a backend, so they count as one
  family; a result is *confirmed* only when two families agree on every number.
- **Cleaning** (`parsers.ts`, `verify.ts`): only exact-length digit strings are
  accepted, a page showing another date is rejected, and a failed fetch never
  overwrites a finished result.
- **Store**: one JSON file per day in `.data/` (override with
  `LOTTERY_DATA_DIR`). Needs a long-running Node server with a writable disk.
- **Guess panel** (`ទាយ`, `lib/lottery/predict.ts`): one 3-digit number for
  posA, posB and posC of each shift. None of the trusted sites publish 3-digit
  predictions (xskt.com.vn says its pages are statistics, baoquocte.vn only
  carries live results), so the guess is the most frequent digit at each place
  over the last 60 completed draws, taken from the app's own verified history.
  It only uses days before the target date and is stored per day, so it stays
  the same after the result is out. It appears once 30 days of history exist;
  the poller backfills 60 days in the background.
- **Board mapping** (`lib/lottery/derive.ts`): documented there and pinned by
  `tests/lottery.test.ts` against the 12.10.2026 screenshots.
- **API**: `GET /api/results?date=YYYY-MM-DD`, `GET /api/health`.
- `/?date=YYYY-MM-DD` opens a specific day.

Set `LOTTERY_POLLER=off` to disable the background poller.
