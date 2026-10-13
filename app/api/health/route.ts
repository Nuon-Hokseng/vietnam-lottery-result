import { pollerStatus } from "@/lib/lottery/poller";
import { SOURCES } from "@/lib/lottery/sources";

/** GET /api/health: is the background poller alive, and which sites feed it. */
export async function GET() {
  return Response.json(
    {
      ok: true,
      time: new Date().toISOString(),
      poller: pollerStatus(),
      sources: SOURCES.map((s) => ({ id: s.id, name: s.name, family: s.family })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
