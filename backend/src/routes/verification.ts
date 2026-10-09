import { Router, type Request } from "express";
import {
  attestOnChain,
  createDiditSession,
  fetchDiditDecision,
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
const lastOutcome = new Map<
  string,
  {
    state: VerificationState;
    at: number;
    sessionId?: string;
    lastPolledAt?: number;
  }
>();

function setOutcome(
  wallet: string,
  state: VerificationState,
  sessionId?: string,
) {
  const previous = lastOutcome.get(wallet);
  lastOutcome.set(wallet, {
    state,
    at: Date.now(),
    sessionId: sessionId ?? previous?.sessionId,
    lastPolledAt: previous?.lastPolledAt,
  });
}

/**
 * Act on a Didit result, whether it arrived by webhook or by asking Didit.
 * Approved → salted identity hash → on-chain attestation (refused for a
 * person already verified on another wallet).
 */
async function processResult(
  wallet: string,
  status: unknown,
  decision: unknown,
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  if (status === "Declined") setOutcome(wallet, "declined");
  if (status === "In Review") setOutcome(wallet, "in_review");
  if (status !== "Approved") {
    return { httpStatus: 200, body: { ok: true } };
  }

  const identityHash = identityHashFromDecision(decision);
  if (!identityHash) {
    setOutcome(wallet, "error");
    return {
      httpStatus: 200,
      body: { ok: true, attested: false, reason: "missing identity fields" },
    };
  }
  try {
    const outcome = await attestOnChain(wallet, identityHash);
    if (outcome.ok) {
      setOutcome(wallet, "approved");
      return {
        httpStatus: 200,
        body: { ok: true, attested: true, txHash: outcome.txHash },
      };
    }
    setOutcome(wallet, outcome.reason);
    // 200 for business refusals (duplicate person): retrying can't change it.
    return {
      httpStatus: outcome.reason === "error" ? 500 : 200,
      body: {
        ok: outcome.reason !== "error",
        attested: false,
        reason: outcome.reason,
      },
    };
  } catch (error) {
    setOutcome(wallet, "error");
    // 500 lets Didit retry a transient RPC failure.
    return {
      httpStatus: 500,
      body: {
        error: error instanceof Error ? error.message : "attestation failed",
      },
    };
  }
}

const DECISION_POLL_INTERVAL_MS = 10_000;

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
    setOutcome(wallet, "pending", session.sessionId);
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

  // No webhook yet? Ask Didit directly (throttled). Covers local development,
  // where Didit can't reach us, and any webhook that went missing.
  const known = lastOutcome.get(wallet);
  if (
    !verified &&
    known?.sessionId &&
    (known.state === "pending" || known.state === "in_review") &&
    Date.now() - (known.lastPolledAt ?? 0) > DECISION_POLL_INTERVAL_MS
  ) {
    known.lastPolledAt = Date.now();
    try {
      const decision = await fetchDiditDecision(known.sessionId);
      if (decision?.status) {
        const result = await processResult(wallet, decision.status, decision);
        verified = result.body.attested === true;
      }
    } catch {
      // keep the previous state; the next poll retries
    }
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

    const result = await processResult(wallet, status, decision);
    res.status(result.httpStatus).json(result.body);
  },
);
