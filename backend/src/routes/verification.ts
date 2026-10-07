import { Router, type Request } from "express";
import {
  attestOnChain,
  createDiditSession,
  identityHashFromDecision,
  isDiditConfigured,
  isVerifiedOnChain,
  verifyDiditWebhook,
} from "../lib/didit.js";

const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;

/**
 * Last known Didit outcome per wallet, so the UI can explain a decline or a
 * duplicate. Deliberately in memory: the source of truth for "verified" is
 * the contract, and this holds no personal data. Lost on restart, which only
 * means the UI falls back to the on-chain answer.
 */
type VerificationState =
  | "pending"
  | "approved"
  | "declined"
  | "in_review"
  | "duplicate_identity"
  | "wallet_bound"
  | "error";
const lastOutcome = new Map<string, { state: VerificationState; at: number }>();

function setOutcome(wallet: string, state: VerificationState) {
  lastOutcome.set(wallet, { state, at: Date.now() });
}

// ─── Authenticated (frontend) routes ─────────────────────────────────────────

export const verificationRouter = Router();

verificationRouter.post("/session", async (req, res) => {
  if (!isDiditConfigured()) {
    res.status(503).json({ error: "Identity verification is not configured" });
    return;
  }
  const wallet = String(req.body?.wallet ?? "").trim();
  if (!STELLAR_ADDRESS.test(wallet)) {
    res.status(400).json({ error: "wallet must be a Stellar G-address" });
    return;
  }
  try {
    if (await isVerifiedOnChain(wallet)) {
      res.json({ verified: true });
      return;
    }
    const session = await createDiditSession(wallet);
    setOutcome(wallet, "pending");
    res.json({ verified: false, ...session });
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Verification failed",
    });
  }
});

verificationRouter.get("/status", async (req, res) => {
  const wallet = String(req.query.wallet ?? "").trim();
  if (!STELLAR_ADDRESS.test(wallet)) {
    res.status(400).json({ error: "wallet must be a Stellar G-address" });
    return;
  }
  let verified = false;
  try {
    verified = isDiditConfigured() ? await isVerifiedOnChain(wallet) : false;
  } catch {
    // fall through with the last known outcome
  }
  res.json({
    verified,
    state: verified ? "approved" : (lastOutcome.get(wallet)?.state ?? null),
  });
});

// ─── Didit webhook (public; authenticated by Didit's HMAC signature) ─────────

export const diditWebhookRouter = Router();

diditWebhookRouter.post(
  "/",
  async (req: Request & { rawBody?: Buffer }, res) => {
    if (!isDiditConfigured()) {
      res.status(503).json({ error: "not configured" });
      return;
    }
    const valid = verifyDiditWebhook({
      body: req.body,
      rawBody: req.rawBody,
      signatureV2: req.header("x-signature-v2") ?? undefined,
      signatureRaw: req.header("x-signature") ?? undefined,
      timestamp: req.header("x-timestamp") ?? undefined,
    });
    if (!valid) {
      res.status(401).json({ error: "invalid signature" });
      return;
    }

    const { webhook_type, status, vendor_data, decision } = req.body ?? {};
    const wallet = String(vendor_data ?? "");
    // Acknowledge anything we don't act on, so Didit doesn't retry it.
    if (webhook_type !== "status.updated" || !STELLAR_ADDRESS.test(wallet)) {
      res.json({ ok: true, ignored: true });
      return;
    }

    if (status === "Declined") setOutcome(wallet, "declined");
    if (status === "In Review") setOutcome(wallet, "in_review");
    if (status !== "Approved") {
      res.json({ ok: true });
      return;
    }

    const identityHash = identityHashFromDecision(decision);
    if (!identityHash) {
      setOutcome(wallet, "error");
      res.json({
        ok: true,
        attested: false,
        reason: "missing identity fields",
      });
      return;
    }
    try {
      const outcome = await attestOnChain(wallet, identityHash);
      if (outcome.ok) {
        setOutcome(wallet, "approved");
        res.json({ ok: true, attested: true, txHash: outcome.txHash });
      } else {
        setOutcome(wallet, outcome.reason);
        // 200 for business refusals (duplicate person): retrying can't change it.
        res.status(outcome.reason === "error" ? 500 : 200).json({
          ok: outcome.reason !== "error",
          attested: false,
          reason: outcome.reason,
        });
      }
    } catch (error) {
      setOutcome(wallet, "error");
      // 500 lets Didit retry a transient RPC failure.
      res.status(500).json({
        error: error instanceof Error ? error.message : "attestation failed",
      });
    }
  },
);
