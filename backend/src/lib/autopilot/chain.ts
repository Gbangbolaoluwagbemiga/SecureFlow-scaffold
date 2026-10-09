/**
 * The agent's hands on the SecureFlow contract.
 *
 * Autopilot is an ordinary Stellar account the client appoints with
 * `set_job_manager`. The contract then lets it accept a freelancer, approve,
 * reject and dispute on that one job — and nothing else: it can never cancel,
 * move funds, or be paid. Every write here goes through simulation first, so a
 * contract refusal surfaces as an error before a fee is spent.
 */
import {
  Address,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  type xdr,
} from "@stellar/stellar-sdk";
import { Api, Server as RpcServer } from "@stellar/stellar-sdk/rpc";

export function isAutopilotConfigured(): boolean {
  return (
    !!process.env.AUTOPILOT_SECRET_KEY?.trim() &&
    !!process.env.SECUREFLOW_CONTRACT_ID?.trim()
  );
}

function agentKeypair(): Keypair {
  const secret = process.env.AUTOPILOT_SECRET_KEY?.trim();
  if (!secret) throw new Error("AUTOPILOT_SECRET_KEY is not configured");
  return Keypair.fromSecret(secret);
}

export function agentAddress(): string | null {
  try {
    return agentKeypair().publicKey();
  } catch {
    return null;
  }
}

function rpc(): RpcServer {
  return new RpcServer(
    process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
  );
}

function passphrase(): string {
  return (process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET).trim();
}

function contract(): Contract {
  const id = process.env.SECUREFLOW_CONTRACT_ID?.trim();
  if (!id) throw new Error("SECUREFLOW_CONTRACT_ID is not configured");
  return new Contract(id);
}

const u32 = (n: number) => nativeToScVal(n, { type: "u32" });
const addr = (a: string) => new Address(a).toScVal();
const str = (s: string) => nativeToScVal(s, { type: "string" });

/** Read-only call: simulate and decode, never submitted. */
async function read<T>(method: string, ...args: xdr.ScVal[]): Promise<T> {
  const server = rpc();
  const source = await server.getAccount(agentKeypair().publicKey());
  const tx = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: passphrase(),
  })
    .addOperation(contract().call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (Api.isSimulationError(sim)) throw new Error(sim.error.slice(0, 300));
  if (!sim.result) throw new Error(`${method} returned nothing`);
  return scValToNative(sim.result.retval) as T;
}

/** Signed call as the agent. Resolves once the ledger has confirmed it. */
async function invoke(method: string, ...args: xdr.ScVal[]): Promise<string> {
  const server = rpc();
  const kp = agentKeypair();
  const source = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(source, {
    fee: "1000000",
    networkPassphrase: passphrase(),
  })
    .addOperation(contract().call(method, ...args))
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (Api.isSimulationError(sim)) {
    throw new Error(`${method} refused: ${sim.error.slice(0, 300)}`);
  }
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(kp);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`${method}: send failed`);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await server.getTransaction(sent.hash);
    if (res.status === Api.GetTransactionStatus.SUCCESS) return sent.hash;
    if (res.status === Api.GetTransactionStatus.FAILED) {
      throw new Error(`${method}: transaction ${sent.hash} failed`);
    }
  }
  throw new Error(`${method}: transaction ${sent.hash} not confirmed in time`);
}

// ─── Shapes as scValToNative returns them ────────────────────────────────────

/** Unit enum variants decode as `["Pending"]`; normalise to the name. */
export function enumName(raw: unknown): string {
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return String(raw ?? "");
}

export interface ChainEscrow {
  depositor: string;
  beneficiary?: string | null;
  total_amount: bigint;
  paid_amount: bigint;
  deadline: number;
  status: unknown;
  work_started: boolean;
  milestone_count: number;
  is_open_job: boolean;
  project_title: string;
  project_description: string;
  token?: string | null;
}

export interface ChainMilestone {
  description: string;
  requirements: string;
  amount: bigint;
  status: unknown;
  submitted_at: number;
  rejection_reason?: string | null;
}

export interface ChainApplication {
  freelancer: string;
  cover_letter: string;
  proposed_timeline: number;
  applied_at: number;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export const getEscrow = (id: number) =>
  read<ChainEscrow | null | undefined>("get_escrow", u32(id));

export const getMilestones = (id: number) =>
  read<ChainMilestone[]>("get_milestones", u32(id));

export const getApplications = (id: number) =>
  read<ChainApplication[]>("get_applications", u32(id));

export const getJobManager = (id: number) =>
  read<string | null | undefined>("get_job_manager", u32(id));

export const isVerified = (wallet: string) =>
  read<boolean>("is_verified", addr(wallet));

export const getAverageRating = (wallet: string) =>
  read<[number, number]>("get_average_rating", addr(wallet));

export const getCompletedEscrows = (wallet: string) =>
  read<number>("get_completed_escrows", addr(wallet));

// ─── Writes (as the appointed job manager) ───────────────────────────────────

export const acceptFreelancer = (id: number, freelancer: string) =>
  invoke(
    "accept_freelancer",
    u32(id),
    addr(freelancer),
    addr(agentKeypair().publicKey()),
  );

export const approveMilestone = (id: number, index: number) =>
  invoke(
    "approve_milestone",
    u32(id),
    u32(index),
    addr(agentKeypair().publicKey()),
  );

export const rejectMilestone = (id: number, index: number, reason: string) =>
  invoke(
    "reject_milestone",
    u32(id),
    u32(index),
    str(reason),
    addr(agentKeypair().publicKey()),
  );

export const disputeMilestone = (id: number, index: number, reason: string) =>
  invoke(
    "dispute_milestone",
    u32(id),
    u32(index),
    str(reason),
    addr(agentKeypair().publicKey()),
  );

export interface ChainEvidence {
  submitter: string;
  cid: string;
  submitted_at: bigint;
}

export const getEvidence = (id: number, index: number) =>
  read<ChainEvidence[]>("get_evidence", u32(id), u32(index));

export async function latestLedger(): Promise<number> {
  return (await rpc().getLatestLedger()).sequence;
}
