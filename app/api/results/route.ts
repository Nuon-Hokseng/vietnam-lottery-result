import { after, type NextRequest } from "next/server";

import { backfillSome, buildResults, resolveDate } from "@/lib/lottery/api";

/** GET /api/results?date=YYYY-MM-DD  (date optional, defaults to today in Vietnam). */
export async function GET(request: NextRequest) {
  const resolved = resolveDate(request.nextUrl.searchParams.get("date"));
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: 400 });
  }

  try {
    const payload = await buildResults(resolved.date);

    // Collecting older days for the guess statistics must never delay the
    // response, so it runs once the response has been sent.
    after(() =>
      backfillSome().catch((err) =>
        console.error("[lottery] backfill failed:", err),
      ),
    );

    return Response.json(payload, {
      headers: {
        // A finished past day never changes: let the CDN serve it instantly.
        "Cache-Control": payload.final
          ? "public, s-maxage=300, stale-while-revalidate=3600"
          : "no-store",
      },
    });
  } catch (err) {
    console.error("[lottery] /api/results failed:", err);
    return Response.json(
      { error: "Could not load results. Try again in a moment." },
      { status: 500 },
    );
  }
}
