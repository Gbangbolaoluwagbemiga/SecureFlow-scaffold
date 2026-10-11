/**
 * Keeps opted-in escrows' idle money earning.
 *
 * The contract brings an escrow's funds home before every payment, and does
 * not put the remainder back by itself: that's a separate public call,
 * `invest_idle`, which can only move an escrow's own unpaid funds into its
 * configured pool. This loop makes that call for every live, opted-in escrow
 * with money sitting idle, so a client never has to sign anything for it.
 */
import * as chain from "./chain.js";
import { enumName } from "./chain.js";

const KEEPER_MS = Number(process.env.YIELD_KEEPER_MS ?? 120_000);
/** Only recent escrows are worth scanning; old ones are long finished. */
const SCAN_LAST = 200;

let running = false;

export async function keepIdleFundsEarning(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const total = Number(await chain.getTotalEscrows());
    const from = Math.max(1, total - SCAN_LAST + 1);
    const ids = Array.from({ length: total - from + 1 }, (_, i) => from + i);
    const escrows = await chain.getEscrows(ids);

    for (const [id, escrow] of escrows) {
      const status = enumName(escrow.status);
      if (status !== "Pending" && status !== "InProgress") continue;
      const unpaid = BigInt(escrow.total_amount) - BigInt(escrow.paid_amount);
      if (unpaid <= 0n) continue;

      const info = await chain.getYieldInfo(id).catch(() => null);
      if (!info?.opted_in || !info.available) continue;
      if (BigInt(info.principal) >= unpaid) continue; // already all earning

      try {
        await chain.investIdle(id);
        console.log(`[yield] escrow ${id}: reinvested idle funds`);
      } catch (err) {
        // The pool may be briefly unavailable; the next pass retries.
        console.warn(
          `[yield] escrow ${id}: invest_idle failed —`,
          err instanceof Error ? err.message.slice(0, 160) : err,
        );
      }
    }
  } catch (err) {
    console.warn(
      "[yield] keeper pass failed:",
      err instanceof Error ? err.message.slice(0, 160) : err,
    );
  } finally {
    running = false;
  }
}

export function startYieldKeeper(): void {
  if (!chain.isAutopilotConfigured()) return;
  console.log(`[yield] keeper running every ${Math.round(KEEPER_MS / 1000)}s`);
  setInterval(() => void keepIdleFundsEarning(), KEEPER_MS);
  void keepIdleFundsEarning();
}
