import crypto from "node:crypto";
import { Router } from "express";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import * as chain from "../lib/autopilot/chain.js";
import { HIRE_THRESHOLD, VERIFIED_EDGE } from "../lib/autopilot/brain.js";
import { llmName } from "../lib/autopilot/llm.js";
import { MAX_ROUNDS, previewFor, tick } from "../lib/autopilot/runner.js";
import * as store from "../lib/autopilot/store.js";

export const autopilotRouter = Router();

const MIN_WINDOW = 1;
const MAX_WINDOW = 7 * 24 * 60;
const SIGNATURE_MAX_AGE_MS = 15 * 60_000;

function escrowIdParam(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The exact text the client signs. The frontend builds the same string. */
export function handoverMessage(p: {
  escrowId: number;
  windowMinutes: number;
  criteria: string[];
  client: string;
  issued: string;
}): string {
  const digest = crypto
    .createHash("sha256")
    .update(p.criteria.join("\n"))
    .digest("hex");
  return [
    "SecureFlow Autopilot",
    `Hand job #${p.escrowId} to Autopilot`,
    `Application window: ${p.windowMinutes} minute(s)`,
    `Criteria: ${digest}`,
    `Client: ${p.client}`,
    `Issued: ${p.issued}`,
  ].join("\n");
}

/**
 * SEP-53 signed message: ed25519 over sha256("Stellar Signed Message:\n" + m).
 * Older wallets signed the raw message or its hash, so those are accepted too —
 * each still proves the holder of the client's key signed this exact text.
 */
function verifySignedMessage(
  address: string,
  message: string,
  signature: string,
): boolean {
  if (!StrKey.isValidEd25519PublicKey(address)) return false;
  const kp = Keypair.fromPublicKey(address);
  const sigs: Buffer[] = [];
  if (/^[0-9a-f]{128}$/i.test(signature))
    sigs.push(Buffer.from(signature, "hex"));
  try {
    sigs.push(Buffer.from(signature, "base64"));
  } catch {
    /* not base64 */
  }
  const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
  const payloads = [
    sha(
      Buffer.concat([
        Buffer.from("Stellar Signed Message:\n"),
        Buffer.from(message),
      ]),
    ),
    sha(Buffer.from(message)),
    Buffer.from(message),
  ];
  return sigs.some(
    (sig) =>
      sig.length === 64 &&
      payloads.some((p) => {
        try {
          return kp.verify(p, sig);
        } catch {
          return false;
        }
      }),
  );
}

autopilotRouter.get("/info", (_req, res) => {
  res.json({
    enabled: chain.isAutopilotConfigured() && !!llmName(),
    agent: chain.agentAddress(),
    model: llmName(),
    verifiedEdge: VERIFIED_EDGE,
    hireThreshold: HIRE_THRESHOLD,
    maxRounds: MAX_ROUNDS,
    window: { min: MIN_WINDOW, max: MAX_WINDOW },
  });
});

/** Which jobs Autopilot is running, for badges on lists. */
autopilotRouter.get("/jobs", (_req, res) => {
  res.json({
    jobs: store
      .listJobs()
      .filter((j) => j.phase !== "released" && j.phase !== "awaiting_handover")
      .map((j) => ({ escrowId: j.escrowId, phase: j.phase })),
  });
});

/**
 * Public on purpose: a freelancer should read the standard their work will be
 * judged by before applying, and the client watches the decisions as they land.
 */
autopilotRouter.get("/jobs/:id", (req, res) => {
  const id = escrowIdParam(req.params.id);
  if (!id) return void res.status(400).json({ error: "Invalid escrow id" });
  const job = store.getJob(id);
  if (!job) return void res.json({ managed: false });
  res.json({
    managed: job.phase !== "released" && job.phase !== "awaiting_handover",
    phase: job.phase,
    criteria: job.criteria,
    deliverableFormat: job.deliverableFormat,
    windowMinutes: job.windowMinutes,
    closesAt: job.adoptedAt ? job.adoptedAt + job.windowMinutes * 60_000 : null,
    hired: job.hired ?? null,
    decisions: [...job.decisions].reverse(),
  });
});

/** Criteria Autopilot would judge by, shown before the client hands over. */
autopilotRouter.post("/preview", async (req, res) => {
  const id = escrowIdParam(req.body?.escrowId);
  if (!id) return void res.status(400).json({ error: "Invalid escrow id" });
  if (!llmName()) {
    return void res
      .status(503)
      .json({ error: "Autopilot has no language model configured" });
  }
  try {
    res.json(await previewFor(id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[autopilot] preview failed:", msg);
    res
      .status(502)
      .json({
        error: "Autopilot could not write criteria just now. Try again.",
      });
  }
});

/**
 * Record what the client approved. Signed by the client's wallet so nobody
 * else — least of all a freelancer hoping for an easy bar — can set the
 * criteria on someone else's job. Takes effect once the client also names the
 * agent on-chain with set_job_manager.
 */
autopilotRouter.post("/handover", async (req, res) => {
  if (!chain.isAutopilotConfigured()) {
    return void res
      .status(503)
      .json({ error: "Autopilot is not configured on this server" });
  }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const id = escrowIdParam(b.escrowId);
  const windowMinutes = Math.round(Number(b.windowMinutes));
  const criteria = Array.isArray(b.criteria)
    ? b.criteria
        .map((c) => String(c).trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];
  const client = typeof b.client === "string" ? b.client : "";
  const issued = typeof b.issued === "string" ? b.issued : "";
  const signature = typeof b.signature === "string" ? b.signature : "";

  if (!id) return void res.status(400).json({ error: "Invalid escrow id" });
  if (
    !Number.isFinite(windowMinutes) ||
    windowMinutes < MIN_WINDOW ||
    windowMinutes > MAX_WINDOW
  ) {
    return void res
      .status(400)
      .json({
        error: "Application window must be between 1 minute and 7 days",
      });
  }
  if (criteria.length < 1 || criteria.some((c) => c.length > 400)) {
    return void res
      .status(400)
      .json({
        error: "Give between 1 and 10 criteria, each under 400 characters",
      });
  }
  const issuedAt = Date.parse(issued);
  if (
    !Number.isFinite(issuedAt) ||
    Math.abs(Date.now() - issuedAt) > SIGNATURE_MAX_AGE_MS
  ) {
    return void res
      .status(400)
      .json({ error: "Signature expired; sign again" });
  }

  const message = handoverMessage({
    escrowId: id,
    windowMinutes,
    criteria,
    client,
    issued,
  });
  if (!verifySignedMessage(client, message, signature)) {
    return void res
      .status(401)
      .json({ error: "Signature does not match this wallet" });
  }

  try {
    const escrow = await chain.getEscrow(id);
    if (!escrow)
      return void res.status(404).json({ error: "Escrow not found" });
    if (escrow.depositor !== client) {
      return void res
        .status(403)
        .json({
          error: "Only the client who posted this job can hand it over",
        });
    }
    const status = chain.enumName(escrow.status);
    if (status !== "Pending" && status !== "InProgress") {
      return void res
        .status(409)
        .json({
          error: `This job is ${status.toLowerCase()} and can't be handed over`,
        });
    }

    const preview = store.getPreview(id);
    const existing = store.getJob(id);
    const job: store.JobState = {
      escrowId: id,
      client,
      criteria,
      deliverableFormat:
        preview?.deliverableFormat ?? existing?.deliverableFormat ?? "",
      windowMinutes,
      approvedAt: Date.now(),
      phase: "awaiting_handover",
      reviews: existing?.reviews ?? {},
      decisions: existing?.decisions ?? [],
    };
    store.putJob(job);
    store.addDecision(id, {
      type: "handed_over",
      summary: `Client approved ${criteria.length} criteria and a ${windowMinutes}-minute application window.`,
    });
    res.json({ ok: true, agent: chain.agentAddress() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[autopilot] handover failed:", msg);
    res
      .status(502)
      .json({ error: "Could not read this job from the chain. Try again." });
  }
});

/** Called by the app right after set_job_manager confirms, so nobody waits a poll. */
autopilotRouter.post("/jobs/:id/nudge", (req, res) => {
  if (!escrowIdParam(req.params.id))
    return void res.status(400).json({ error: "Invalid escrow id" });
  void tick();
  res.json({ ok: true });
});
