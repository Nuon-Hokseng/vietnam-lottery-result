import type { NextRequest } from "next/server";

import { buildResults, resolveDate } from "@/lib/lottery/api";

/** GET /api/results?date=YYYY-MM-DD  (date optional, defaults to today in Vietnam). */
export async function GET(request: NextRequest) {
  const resolved = resolveDate(request.nextUrl.searchParams.get("date"));
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: 400 });
  }

  try {
    const payload = await buildResults(resolved.date);
    return Response.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[lottery] /api/results failed:", err);
    return Response.json(
      { error: "Could not load results. Try again in a moment." },
      { status: 500 },
    );
  }
}
