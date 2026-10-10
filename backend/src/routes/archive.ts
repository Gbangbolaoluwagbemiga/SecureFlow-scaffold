import { Router } from "express";
import { StrKey } from "@stellar/stellar-sdk";
import { getSupabase } from "../lib/supabase.js";
import * as chain from "../lib/autopilot/chain.js";

/**
 * Archived escrows: a per-wallet "hide this finished job from my dashboard".
 * A view preference only — the on-chain record is never touched, and one
 * party archiving a job doesn't hide it from the other.
 */
export const archiveRouter = Router();

const FINAL = new Set(["Released", "Refunded", "Cancelled", "Expired"]);

function parseBody(body: unknown): { wallet: string; escrowId: number } | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const wallet = typeof b.wallet === "string" ? b.wallet.trim() : "";
  const escrowId = Number(b.escrowId);
  if (!StrKey.isValidEd25519PublicKey(wallet)) return null;
  if (!Number.isInteger(escrowId) || escrowId <= 0) return null;
  return { wallet, escrowId };
}

/**
 * Only a party to a finished job may archive it. Checked against the chain
 * when the backend can read it; skipped (not refused) when it can't, since
 * the worst an unchecked archive does is hide a card the owner can unhide.
 */
async function canArchive(
  wallet: string,
  escrowId: number,
): Promise<string | null> {
  if (!chain.isAutopilotConfigured()) return null;
  try {
    const escrow = await chain.getEscrow(escrowId);
    if (!escrow) return "Escrow not found";
    if (escrow.depositor !== wallet && escrow.beneficiary !== wallet) {
      return "Only the client or freelancer on this job can archive it";
    }
    if (!FINAL.has(chain.enumName(escrow.status))) {
      return "Only finished jobs can be archived";
    }
    return null;
  } catch {
    return null;
  }
}

archiveRouter.get("/", async (req, res) => {
  const wallet = String(req.query.wallet ?? "").trim();
  if (!StrKey.isValidEd25519PublicKey(wallet)) {
    return void res
      .status(400)
      .json({ error: "wallet must be a Stellar G-address" });
  }
  const supabase = getSupabase();
  if (!supabase) return void res.json({ escrowIds: [] });

  const { data, error } = await supabase
    .from("archived_escrows")
    .select("escrow_id")
    .eq("wallet_address", wallet);
  if (error) return void res.status(500).json({ error: error.message });
  res.json({ escrowIds: (data ?? []).map((r) => Number(r.escrow_id)) });
});

archiveRouter.post("/", async (req, res) => {
  const parsed = parseBody(req.body);
  if (!parsed)
    return void res
      .status(400)
      .json({ error: "wallet and escrowId are required" });
  const supabase = getSupabase();
  if (!supabase)
    return void res
      .status(503)
      .json({ error: "Archive storage is unavailable" });

  const refusal = await canArchive(parsed.wallet, parsed.escrowId);
  if (refusal) return void res.status(403).json({ error: refusal });

  const { error } = await supabase
    .from("archived_escrows")
    .upsert(
      { escrow_id: parsed.escrowId, wallet_address: parsed.wallet },
      { onConflict: "escrow_id,wallet_address", ignoreDuplicates: true },
    );
  if (error) return void res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

archiveRouter.delete("/", async (req, res) => {
  const parsed = parseBody(req.body);
  if (!parsed)
    return void res
      .status(400)
      .json({ error: "wallet and escrowId are required" });
  const supabase = getSupabase();
  if (!supabase)
    return void res
      .status(503)
      .json({ error: "Archive storage is unavailable" });

  const { error } = await supabase
    .from("archived_escrows")
    .delete()
    .eq("escrow_id", parsed.escrowId)
    .eq("wallet_address", parsed.wallet);
  if (error) return void res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
