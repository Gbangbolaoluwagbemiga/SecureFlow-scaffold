/**
 * Autopilot: the AI job manager a client can hand a job to.
 *
 * The agent is an ordinary Stellar account. Handing over is two steps: the
 * client signs the criteria and application window they approved (so nobody
 * else can set them), then names the agent on-chain with set_job_manager. From
 * then on the contract lets it hire, approve, reject and dispute — never
 * cancel, move funds or be paid.
 */
import { apiFetch, isApiConfigured } from "@/lib/api";
import { signMessage } from "@/lib/web3/wallet-signer";

export interface AutopilotInfo {
  enabled: boolean;
  agent: string | null;
  model: string | null;
  verifiedEdge: number;
  hireThreshold: number;
  maxRounds: number;
  window: { min: number; max: number };
}

export type AutopilotPhase =
  | "awaiting_handover"
  | "hiring"
  | "working"
  | "disputed"
  | "completed"
  | "released";

export interface AutopilotDecision {
  id: string;
  at: number;
  type:
    | "handed_over"
    | "window_open"
    | "applicant_scored"
    | "no_suitable_applicant"
    | "hired"
    | "work_approved"
    | "revision_requested"
    | "escalated"
    | "taken_back"
    | "completed"
    | "error";
  summary: string;
  detail?: string;
  target?: string;
  score?: number;
  verified?: boolean;
  milestone?: number;
  txHash?: string;
}

export interface AutopilotJob {
  managed: boolean;
  phase?: AutopilotPhase;
  criteria?: string[];
  deliverableFormat?: string;
  windowMinutes?: number;
  closesAt?: number | null;
  hired?: string | null;
  decisions?: AutopilotDecision[];
}

export interface CriteriaPreview {
  criteria: string[];
  deliverableFormat: string;
  titleConflict?: string;
}

let infoPromise: Promise<AutopilotInfo | null> | null = null;

/** Cached for the session: the agent's address does not change under us. */
export function getAutopilotInfo(): Promise<AutopilotInfo | null> {
  if (!isApiConfigured()) return Promise.resolve(null);
  infoPromise ??= apiFetch<AutopilotInfo>("/v1/autopilot/info").catch(() => {
    infoPromise = null;
    return null;
  });
  return infoPromise;
}

export function getAutopilotJob(escrowId: number): Promise<AutopilotJob> {
  return apiFetch<AutopilotJob>(`/v1/autopilot/jobs/${escrowId}`);
}

export async function getAutopilotJobIds(): Promise<Set<number>> {
  if (!isApiConfigured()) return new Set();
  try {
    const { jobs } = await apiFetch<{ jobs: { escrowId: number }[] }>(
      "/v1/autopilot/jobs",
    );
    return new Set(jobs.map((j) => j.escrowId));
  } catch {
    return new Set();
  }
}

export function previewCriteria(escrowId: number): Promise<CriteriaPreview> {
  return apiFetch<CriteriaPreview>("/v1/autopilot/preview", {
    method: "POST",
    body: JSON.stringify({ escrowId }),
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Must match handoverMessage in backend/src/routes/autopilot.ts exactly. */
async function handoverMessage(p: {
  escrowId: number;
  windowMinutes: number;
  criteria: string[];
  client: string;
  issued: string;
}): Promise<string> {
  return [
    "SecureFlow Autopilot",
    `Hand job #${p.escrowId} to Autopilot`,
    `Application window: ${p.windowMinutes} minute(s)`,
    `Criteria: ${await sha256Hex(p.criteria.join("\n"))}`,
    `Client: ${p.client}`,
    `Issued: ${p.issued}`,
  ].join("\n");
}

/** Step one of handing over: sign and record what the client approved. */
export async function approveHandover(p: {
  escrowId: number;
  windowMinutes: number;
  criteria: string[];
  client: string;
}): Promise<{ agent: string }> {
  const issued = new Date().toISOString();
  const message = await handoverMessage({ ...p, issued });
  const signature = await signMessage(message, p.client);
  return apiFetch<{ agent: string }>("/v1/autopilot/handover", {
    method: "POST",
    body: JSON.stringify({ ...p, issued, signature }),
  });
}

/** Ask the agent to look now rather than on its next pass. */
export function nudgeAutopilot(escrowId: number): void {
  void apiFetch(`/v1/autopilot/jobs/${escrowId}/nudge`, {
    method: "POST",
  }).catch(() => {});
}
