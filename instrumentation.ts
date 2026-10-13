/**
 * Runs once when the Next.js server starts. Starts the background poller that
 * keeps fetching lottery results while draws are being released, so results
 * are stored even when nobody has the dashboard open.
 *
 * Set LOTTERY_POLLER=off to disable (e.g. when a separate worker owns it).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.LOTTERY_POLLER === "off") return;

  const { startPoller } = await import("./lib/lottery/poller");
  startPoller();
}
