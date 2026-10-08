/**
 * Didit identity verification + on-chain attestation.
 *
 * Flow:
 *   1. Freelancer asks for a session → Didit hosted URL (vendor_data = wallet).
 *   2. Didit calls our webhook with a signed result.
 *   3. On "Approved" we derive a salted identity hash (no personal data leaves
 *      this process) and the VERIFIER key attests it on the SecureFlow
 *      contract, which refuses the same person on a second wallet.
 *
 * Required env (backend only, never VITE_*):
 *   DIDIT_API_KEY, DIDIT_WORKFLOW_ID, DIDIT_WEBHOOK_SECRET
 *   DIDIT_CALLBACK_URL       where Didit sends the user afterwards
 *   IDENTITY_HASH_SALT       long random secret; changing it re-opens every identity
 *   VERIFIER_SECRET_KEY      the contract's appointed verifier (NOT the owner key)
 *   SECUREFLOW_CONTRACT_ID
 *   STELLAR_RPC_URL, STELLAR_NETWORK_PASSPHRASE (default: testnet)
 */

import crypto from "node:crypto";
import {
  Address,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { Api, Server as RpcServer } from "@stellar/stellar-sdk/rpc";

const DIDIT_BASE = "https://verification.didit.me/v3";
const SIGNATURE_MAX_AGE_SECONDS = 300;

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function isDiditConfigured(): boolean {
  return [
    "DIDIT_API_KEY",
    "DIDIT_WORKFLOW_ID",
    "DIDIT_WEBHOOK_SECRET",
    "IDENTITY_HASH_SALT",
    "VERIFIER_SECRET_KEY",
    "SECUREFLOW_CONTRACT_ID",
  ].every((n) => !!process.env[n]?.trim());
}

// ─── Didit API ───────────────────────────────────────────────────────────────

export async function createDiditSession(
  wallet: string,
): Promise<{ url: string; sessionId: string }> {
  const res = await fetch(`${DIDIT_BASE}/session/`, {
    method: "POST",
    headers: {
      "x-api-key": env("DIDIT_API_KEY"),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      workflow_id: env("DIDIT_WORKFLOW_ID"),
      // Didit echoes this back in the webhook; it is how we know which wallet
      // the result belongs to. Re-requesting returns the same unfinished
      // session instead of creating duplicates.
      vendor_data: wallet,
      ...(process.env.DIDIT_CALLBACK_URL
        ? { callback: process.env.DIDIT_CALLBACK_URL }
        : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Didit session failed (${res.status})`);
  }
  const body = (await res.json()) as { url?: string; session_id?: string };
  if (!body.url || !body.session_id) {
    throw new Error("Didit session response missing url/session_id");
  }
  return { url: body.url, sessionId: body.session_id };
}

/**
 * Ask Didit for a session's result directly. Used when a webhook can't reach
 * us (local development) or was missed; same shape as the webhook decision.
 */
export async function fetchDiditDecision(
  sessionId: string,
): Promise<{ status?: string; [key: string]: unknown } | null> {
  const res = await fetch(
    `${DIDIT_BASE}/session/${encodeURIComponent(sessionId)}/decision/`,
    {
      headers: { "x-api-key": env("DIDIT_API_KEY") },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) return null;
  return (await res.json()) as { status?: string; [key: string]: unknown };
}

// ─── Webhook signatures (per Didit docs) ─────────────────────────────────────

function shortenFloats(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(shortenFloats);
  if (data !== null && typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, shortenFloats(v)]),
    );
  }
  if (typeof data === "number" && !Number.isInteger(data) && data % 1 === 0) {
    return Math.trunc(data);
  }
  return data;
}

function sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj !== null && typeof obj === "object") {
    return Object.keys(obj as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((obj as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return obj;
}

function safeEqual(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Verify a Didit webhook. Tries X-Signature-V2 (canonical JSON, survives body
 * re-encoding) and falls back to X-Signature over the raw bytes.
 */
export function verifyDiditWebhook(params: {
  body: unknown;
  rawBody?: Buffer;
  signatureV2?: string;
  signatureRaw?: string;
  timestamp?: string;
}): boolean {
  const secret = env("DIDIT_WEBHOOK_SECRET");
  const ts = Number.parseInt(params.timestamp ?? "", 10);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > SIGNATURE_MAX_AGE_SECONDS)
    return false;

  if (params.signatureV2) {
    const canonical = JSON.stringify(sortKeys(shortenFloats(params.body)));
    const expected = crypto
      .createHmac("sha256", secret)
      .update(canonical, "utf8")
      .digest("hex");
    if (safeEqual(expected, params.signatureV2)) return true;
  }
  if (params.signatureRaw && params.rawBody) {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(params.rawBody)
      .digest("hex");
    if (safeEqual(expected, params.signatureRaw)) return true;
  }
  return false;
}

// ─── Identity hash ───────────────────────────────────────────────────────────

interface IdVerification {
  status?: string;
  first_name?: string;
  last_name?: string;
  date_of_birth?: string;
  issuing_state?: string;
}

function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .trim();
}

/**
 * Salted hash of a PERSON (not a document): name words sorted so first/last
 * order between documents doesn't matter, plus date of birth and issuing
 * country. A passport and a national ID for the same person hash the same, so
 * one human cannot verify two wallets by using two documents.
 *
 * Returns null if the decision lacks the fields needed.
 */
export function identityHashFromDecision(decision: unknown): Buffer | null {
  const ids = (decision as { id_verifications?: IdVerification[] } | null)
    ?.id_verifications;
  const id = ids?.find((v) => v.status === "Approved") ?? ids?.[0];
  if (!id?.date_of_birth || !(id.first_name || id.last_name)) return null;

  const nameWords = normalise(`${id.first_name ?? ""} ${id.last_name ?? ""}`)
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
  const fingerprint = [
    nameWords,
    id.date_of_birth.trim(),
    normalise(id.issuing_state ?? ""),
  ].join("|");
  return crypto
    .createHmac("sha256", env("IDENTITY_HASH_SALT"))
    .update(fingerprint, "utf8")
    .digest();
}

// ─── On-chain ────────────────────────────────────────────────────────────────

function rpc(): RpcServer {
  return new RpcServer(
    process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
  );
}

function passphrase(): string {
  return (process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET).trim();
}

export async function isVerifiedOnChain(wallet: string): Promise<boolean> {
  const server = rpc();
  const contract = new Contract(env("SECUREFLOW_CONTRACT_ID"));
  const source = await server.getAccount(
    Keypair.fromSecret(env("VERIFIER_SECRET_KEY")).publicKey(),
  );
  const tx = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: passphrase(),
  })
    .addOperation(
      contract.call("is_verified", nativeToScVal(wallet, { type: "address" })),
    )
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (Api.isSimulationError(sim) || !sim.result) return false;
  return Boolean(scValToNative(sim.result.retval));
}

export type AttestOutcome =
  | { ok: true; txHash: string }
  | {
      ok: false;
      reason: "duplicate_identity" | "wallet_bound" | "error";
      detail: string;
    };

/** Verifier attests the wallet on-chain. */
export async function attestOnChain(
  wallet: string,
  identityHash: Buffer,
): Promise<AttestOutcome> {
  const verifier = Keypair.fromSecret(env("VERIFIER_SECRET_KEY"));
  const server = rpc();
  const contract = new Contract(env("SECUREFLOW_CONTRACT_ID"));
  const source = await server.getAccount(verifier.publicKey());

  const tx = new TransactionBuilder(source, {
    fee: "1000000",
    networkPassphrase: passphrase(),
  })
    .addOperation(
      contract.call(
        "attest_verification",
        new Address(verifier.publicKey()).toScVal(),
        new Address(wallet).toScVal(),
        xdr.ScVal.scvBytes(identityHash),
      ),
    )
    .setTimeout(60)
    .build();

  // Simulation surfaces contract errors before we pay for anything.
  const sim = await server.simulateTransaction(tx);
  if (Api.isSimulationError(sim)) {
    const code = /Error\(Contract, #(\d+)\)/.exec(sim.error)?.[1];
    if (code === "2802")
      return {
        ok: false,
        reason: "duplicate_identity",
        detail: "identity already verified on another wallet",
      };
    if (code === "2803")
      return {
        ok: false,
        reason: "wallet_bound",
        detail: "wallet already verified as another person",
      };
    return { ok: false, reason: "error", detail: sim.error.slice(0, 200) };
  }

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(verifier);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    return { ok: false, reason: "error", detail: "send failed" };
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const result = await server.getTransaction(sent.hash);
    if (result.status === Api.GetTransactionStatus.SUCCESS)
      return { ok: true, txHash: sent.hash };
    if (result.status === Api.GetTransactionStatus.FAILED)
      return { ok: false, reason: "error", detail: "transaction failed" };
  }
  return {
    ok: false,
    reason: "error",
    detail: "transaction not confirmed in time",
  };
}
