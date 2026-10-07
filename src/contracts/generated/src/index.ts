import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}

export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CAJAUKTFKRYZCIFCQOGNZJMCJITC574Z5DUFRINMXXR7VIYKRBEFPS7H",
  },
} as const;

export type Badge =
  | { tag: "Beginner"; values: void }
  | { tag: "Intermediate"; values: void }
  | { tag: "Advanced"; values: void }
  | { tag: "Expert"; values: void };

export interface Rating {
  client: string;
  escrow_id: u32;
  freelancer: string;
  rated_at: u32;
  rating: u32;
  review: string;
}

export type DataKey =
  | { tag: "Owner"; values: void }
  | { tag: "FeeCollector"; values: void }
  | { tag: "PlatformFeeBP"; values: void }
  | { tag: "NextEscrowId"; values: void }
  | { tag: "JobCreationPaused"; values: void }
  | { tag: "ContractPaused"; values: void }
  | { tag: "NativeToken"; values: void }
  | { tag: "WhitelistedToken"; values: readonly [string] }
  | { tag: "WhitelistedTokens"; values: void }
  | { tag: "BlacklistedToken"; values: readonly [string] }
  | { tag: "BlacklistedTokens"; values: void }
  | { tag: "AuthorizedArbiter"; values: readonly [string] }
  | { tag: "AuthorizedArbiters"; values: void }
  | { tag: "EscrowedAmount"; values: readonly [string] }
  | { tag: "TotalFeesByToken"; values: readonly [string] }
  | { tag: "Escrow"; values: readonly [u32] }
  | { tag: "Milestone"; values: readonly [u32, u32] }
  | { tag: "Applicants"; values: readonly [u32] }
  | { tag: "Application"; values: readonly [u32, string] }
  | { tag: "Declined"; values: readonly [u32, string] }
  | { tag: "JobManager"; values: readonly [u32] }
  | { tag: "Arbitrated"; values: readonly [u32] }
  | { tag: "OverdueRequest"; values: readonly [u32] }
  | { tag: "Evidence"; values: readonly [u32, u32] }
  | { tag: "DisputeVoters"; values: readonly [u32] }
  | { tag: "ResolutionVotes"; values: readonly [u32, u32, i128, i128] }
  | { tag: "UserEscrows"; values: readonly [string] }
  | { tag: "Reputation"; values: readonly [string] }
  | { tag: "CompletedEscrows"; values: readonly [string] }
  | { tag: "Rating"; values: readonly [u32] }
  | { tag: "AverageRating"; values: readonly [string] }
  | { tag: "ClientRating"; values: readonly [u32] }
  | { tag: "AverageClientRating"; values: readonly [string] }
  | { tag: "UserCancellations"; values: readonly [string] }
  | { tag: "LastCancellationLedger"; values: readonly [string] }
  | { tag: "Verifier"; values: void }
  | { tag: "Verification"; values: readonly [string] }
  | { tag: "IdentityBinding"; values: readonly [Buffer] };

export interface Milestone {
  amount: i128;
  approved_at: u32;
  /**
   * Freelancer's submission text (the client's requirement until the first
   * submission, or an approved scope change).
   */
  description: string;
  dispute_reason: Option<string>;
  disputed_at: u32;
  disputed_by: Option<string>;
  proposed_amount: i128;
  proposed_description: Option<string>;
  rejection_reason: Option<string>;
  /**
   * The client's original requirement. Set once and never overwritten, so
   * a dispute can always be judged against what was actually asked for.
   */
  requirements: string;
  resolution_client_amount: i128;
  resolution_freelancer_amount: i128;
  resolution_reason: Option<string>;
  resolved_at: u32;
  resolved_by: Option<string>;
  status: MilestoneStatus;
  submitted_at: u32;
}

/**
 * One escrow.
 *
 * FEE MODEL. The client deposits `total_amount + platform_fee`. Milestones
 * always sum to `total_amount`, so paying every milestone leaves exactly the
 * fee behind. The fee is HELD, not earned, until the job settles: cancelling,
 * shrinking the job or a refund ruling hands back the matching share of it.
 * Only a completed (or partly completed) job turns it into revenue.
 */
export interface EscrowData {
  arbiters: Array<string>;
  beneficiary: Option<string>;
  /**
   * Ledger sequence.
   */
  created_at: u32;
  /**
   * Ledger sequence.
   */
  deadline: u32;
  depositor: string;
  is_open_job: boolean;
  milestone_count: u32;
  paid_amount: i128;
  /**
   * Fee still held for this escrow (not yet earned or refunded).
   */
  platform_fee: i128;
  project_description: string;
  project_title: string;
  required_confirmations: u32;
  status: EscrowStatus;
  token: Option<string>;
  /**
   * Net of fee. Milestones sum to this.
   */
  total_amount: i128;
  work_started: boolean;
}

export interface Application {
  applied_at: u32;
  cover_letter: string;
  freelancer: string;
  proposed_timeline: u32;
}

export type EscrowStatus =
  | { tag: "Pending"; values: void }
  | { tag: "InProgress"; values: void }
  | { tag: "Released"; values: void }
  | { tag: "Refunded"; values: void }
  | { tag: "Disputed"; values: void }
  | { tag: "Expired"; values: void }
  | { tag: "Cancelled"; values: void };

export interface EvidenceEntry {
  cid: string;
  submitted_at: u64;
  submitter: string;
}

export interface OverdueRequest {
  reason: string;
  requested_at: u32;
  requester: string;
}

export type MilestoneStatus =
  | { tag: "NotStarted"; values: void }
  | { tag: "Submitted"; values: void }
  | { tag: "Approved"; values: void }
  | { tag: "Disputed"; values: void }
  | { tag: "Resolved"; values: void }
  | { tag: "Rejected"; values: void }
  | { tag: "ProposalPending"; values: void };

export interface ClientRatingData {
  client: string;
  escrow_id: u32;
  freelancer: string;
  rated_at: u32;
  rating: u32;
  review: string;
}

/**
 * A freelancer's identity verification, attested by the verifier after a
 * Didit check. Holds NO personal data: `identity_hash` is a salted hash of
 * the person's normalised identity, computed off-chain with a secret salt, so
 * it cannot be reversed — it only lets the contract notice the same person
 * verifying a second wallet.
 */
export interface FreelancerVerification {
  identity_hash: Buffer;
  /**
   * Ledger timestamp (seconds) of the attestation.
   */
  verified_at: u64;
  verifier: string;
}

export interface Client {
  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner replaces the contract code in place, keeping every escrow.
   *
   * What that costs, stated plainly: the CONTRACT cannot take anyone's
   * money, but the OWNER can change the contract. Do not describe this
   * deployment as trustless without that second clause.
   *
   * Storage is only safe across an upgrade if stored types stay readable:
   * never reorder, retype or remove a field of a stored struct (adding one
   * breaks old entries too — that is what forced the July redeploy). Bump
   * `CONTRACT_VERSION` with every upgrade.
   */
  upgrade: (
    { new_wasm_hash }: { new_wasm_hash: Buffer },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a version transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deployed implementation, readable from chain state alone.
   */
  version: (options?: MethodOptions) => Promise<AssembledTransaction<string>>;

  /**
   * Construct and simulate a get_badge transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_badge: (
    { freelancer }: { freelancer: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Badge>>;

  /**
   * Construct and simulate a get_owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_owner: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<string>>>;

  /**
   * Construct and simulate a set_owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Both the current and the new owner must sign.
   */
  set_owner: (
    { new_owner }: { new_owner: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a cancel_job transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Before work starts, cancel and take back the unpaid budget plus the
   * held fee, minus a penalty only if people applied.
   */
  cancel_job: (
    { escrow_id, depositor }: { escrow_id: u32; depositor: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_escrow: (
    { escrow_id }: { escrow_id: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Option<EscrowData>>>;

  /**
   * Construct and simulate a get_rating transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_rating: (
    { escrow_id }: { escrow_id: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Option<Rating>>>;

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-time setup. `owner` must sign.
   */
  initialize: (
    {
      owner,
      fee_collector,
      platform_fee_bp,
      default_whitelisted_tokens,
    }: {
      owner: string;
      fee_collector: string;
      platform_fee_bp: u32;
      default_whitelisted_tokens: Array<string>;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a reopen_job transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Put a declined or arbitrated job back on the board with its history.
   */
  reopen_job: (
    { escrow_id, depositor }: { escrow_id: u32; depositor: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a start_work transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  start_work: (
    { escrow_id, beneficiary }: { escrow_id: u32; beneficiary: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a has_applied transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  has_applied: (
    { escrow_id, freelancer }: { escrow_id: u32; freelancer: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<boolean>>;

  /**
   * Construct and simulate a is_verified transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_verified: (
    { wallet }: { wallet: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<boolean>>;

  /**
   * Construct and simulate a apply_to_job transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  apply_to_job: (
    {
      escrow_id,
      cover_letter,
      proposed_timeline,
      freelancer,
    }: {
      escrow_id: u32;
      cover_letter: string;
      proposed_timeline: u32;
      freelancer: string;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a delist_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  delist_token: (
    { token }: { token: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_evidence transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_evidence: (
    { escrow_id, milestone_index }: { escrow_id: u32; milestone_index: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Array<EvidenceEntry>>>;

  /**
   * Construct and simulate a get_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_verifier: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Option<string>>>;

  /**
   * Construct and simulate a set_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner appoints the verifier key that attests Didit results.
   */
  set_verifier: (
    { verifier }: { verifier: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a add_job_funds transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_job_funds: (
    {
      escrow_id,
      depositor,
      additional_amount,
      milestone_index,
    }: {
      escrow_id: u32;
      depositor: string;
      additional_amount: i128;
      milestone_index: u32;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a add_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Add a milestone, depositing its amount plus fee share.
   */
  add_milestone: (
    {
      escrow_id,
      amount,
      description,
      depositor,
    }: { escrow_id: u32; amount: i128; description: string; depositor: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a create_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Fund a milestone escrow. The depositor pays `total_amount` plus the
   * platform fee (see `quote_deposit`); milestone amounts must sum to
   * exactly `total_amount`. `beneficiary: None` posts an open job.
   * `duration` is in seconds (1 hour to 365 days).
   */
  create_escrow: (
    {
      depositor,
      beneficiary,
      arbiters,
      required_confirmations,
      milestones,
      token,
      total_amount,
      duration,
      project_title,
      project_description,
    }: {
      depositor: string;
      beneficiary: Option<string>;
      arbiters: Array<string>;
      required_confirmations: u32;
      milestones: Array<readonly [i128, string]>;
      token: Option<string>;
      total_amount: i128;
      duration: u32;
      project_title: string;
      project_description: string;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<u32>>>;

  /**
   * Construct and simulate a delete_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner deletes a settled escrow and everything stored under it.
   */
  delete_escrow: (
    { escrow_id }: { escrow_id: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_milestone: (
    { escrow_id, milestone_index }: { escrow_id: u32; milestone_index: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Option<Milestone>>>;

  /**
   * Construct and simulate a is_arbitrated transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_arbitrated: (
    { escrow_id }: { escrow_id: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<boolean>>;

  /**
   * Construct and simulate a quote_deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `(deposit, fee)` a client must pay to fund `total_amount` today.
   */
  quote_deposit: (
    { total_amount }: { total_amount: i128 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<readonly [i128, i128]>>>;

  /**
   * Construct and simulate a refund_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Same as `cancel_job`: before work starts, take the money back.
   */
  refund_escrow: (
    { escrow_id, depositor }: { escrow_id: u32; depositor: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a submit_rating transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Client rates the freelancer (escrow must be Released).
   */
  submit_rating: (
    {
      escrow_id,
      rating,
      review,
      client,
    }: { escrow_id: u32; rating: u32; review: string; client: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a withdraw_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  withdraw_fees: (
    { token, caller }: { token: Option<string>; caller: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_milestones transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_milestones: (
    { escrow_id }: { escrow_id: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Array<Milestone>>>;

  /**
   * Construct and simulate a get_reputation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_reputation: (
    { user }: { user: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<u32>>;

  /**
   * Construct and simulate a is_job_manager transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_job_manager: (
    { escrow_id, who }: { escrow_id: u32; who: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<boolean>>;

  /**
   * Construct and simulate a pause_contract transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pause_contract: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a remove_arbiter transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  remove_arbiter: (
    { arbiter }: { arbiter: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a set_milestones transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Replace the whole milestone list, settling any change in total.
   */
  set_milestones: (
    {
      escrow_id,
      milestones,
      depositor,
    }: {
      escrow_id: u32;
      milestones: Array<readonly [i128, string]>;
      depositor: string;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a blacklist_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  blacklist_token: (
    { token }: { token: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a extend_deadline transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `extra_seconds`: 1 second to 365 days.
   */
  extend_deadline: (
    {
      escrow_id,
      extra_seconds,
      depositor,
    }: { escrow_id: u32; extra_seconds: u32; depositor: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_application transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_application: (
    { escrow_id, freelancer }: { escrow_id: u32; freelancer: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Option<Application>>>;

  /**
   * Construct and simulate a get_job_manager transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_job_manager: (
    { escrow_id }: { escrow_id: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Option<string>>>;

  /**
   * Construct and simulate a resolve_dispute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Arbiter vote to split one milestone. Executes when enough arbiters
   * agree on the same split. `reason` is required.
   */
  resolve_dispute: (
    {
      escrow_id,
      milestone_index,
      arbiter,
      freelancer_amount,
      client_amount,
      reason,
    }: {
      escrow_id: u32;
      milestone_index: u32;
      arbiter: string;
      freelancer_amount: i128;
      client_amount: i128;
      reason: string;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a set_job_manager transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_job_manager: (
    {
      escrow_id,
      manager,
      depositor,
    }: { escrow_id: u32; manager: string; depositor: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a submit_evidence transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  submit_evidence: (
    {
      escrow_id,
      milestone_index,
      submitter,
      cid,
    }: { escrow_id: u32; milestone_index: u32; submitter: string; cid: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a whitelist_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  whitelist_token: (
    { token }: { token: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_applications transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_applications: (
    { escrow_id }: { escrow_id: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Array<Application>>>;

  /**
   * Construct and simulate a get_native_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_native_token: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<string>>;

  /**
   * Construct and simulate a get_user_escrows transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_user_escrows: (
    { user }: { user: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Array<u32>>>;

  /**
   * Construct and simulate a get_verification transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_verification: (
    { wallet }: { wallet: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Option<FreelancerVerification>>>;

  /**
   * Construct and simulate a reject_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `depositor` may be the client or their appointed job manager.
   */
  reject_milestone: (
    {
      escrow_id,
      milestone_index,
      reason,
      depositor,
    }: {
      escrow_id: u32;
      milestone_index: u32;
      reason: string;
      depositor: string;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a remove_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove a milestone, refunding its amount plus fee share.
   */
  remove_milestone: (
    {
      escrow_id,
      milestone_index,
      depositor,
    }: { escrow_id: u32; milestone_index: u32; depositor: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a submit_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deliver a milestone (also redelivers a rejected one).
   */
  submit_milestone: (
    {
      escrow_id,
      milestone_index,
      description,
      beneficiary,
    }: {
      escrow_id: u32;
      milestone_index: u32;
      description: string;
      beneficiary: string;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a unpause_contract transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  unpause_contract: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a accept_freelancer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `depositor` may be the client or their appointed job manager.
   */
  accept_freelancer: (
    {
      escrow_id,
      freelancer,
      depositor,
    }: { escrow_id: u32; freelancer: string; depositor: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a approve_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `depositor` may be the client or their appointed job manager.
   */
  approve_milestone: (
    {
      escrow_id,
      milestone_index,
      depositor,
    }: { escrow_id: u32; milestone_index: u32; depositor: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a authorize_arbiter transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  authorize_arbiter: (
    { arbiter }: { arbiter: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a dispute_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Client, freelancer or job manager escalates a milestone to arbitration.
   */
  dispute_milestone: (
    {
      escrow_id,
      milestone_index,
      reason,
      disputer,
    }: {
      escrow_id: u32;
      milestone_index: u32;
      reason: string;
      disputer: string;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_client_rating transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_client_rating: (
    { escrow_id }: { escrow_id: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Option<ClientRatingData>>>;

  /**
   * Construct and simulate a get_fee_collector transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_fee_collector: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<string>>>;

  /**
   * Construct and simulate a get_total_escrows transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_total_escrows: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<u32>>;

  /**
   * Construct and simulate a has_dispute_voted transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  has_dispute_voted: (
    { escrow_id, arbiter }: { escrow_id: u32; arbiter: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<boolean>>;

  /**
   * Construct and simulate a set_fee_collector transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_fee_collector: (
    { fee_collector }: { fee_collector: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a unblacklist_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  unblacklist_token: (
    { token }: { token: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a decline_assignment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The named freelancer hands the job back before starting it.
   */
  decline_assignment: (
    { escrow_id, beneficiary }: { escrow_id: u32; beneficiary: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_average_rating transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `(sum_of_ratings, count)`.
   */
  get_average_rating: (
    { freelancer }: { freelancer: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<readonly [u32, u32]>>;

  /**
   * Construct and simulate a get_required_votes transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Agreeing votes needed to execute a ruling on this escrow.
   */
  get_required_votes: (
    { escrow_id }: { escrow_id: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<u32>>>;

  /**
   * Construct and simulate a is_contract_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_contract_paused: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<boolean>>;

  /**
   * Construct and simulate a pause_job_creation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pause_job_creation: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a resubmit_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resubmit_milestone: (
    {
      escrow_id,
      milestone_index,
      description,
      beneficiary,
    }: {
      escrow_id: u32;
      milestone_index: u32;
      description: string;
      beneficiary: string;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a revoke_job_manager transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  revoke_job_manager: (
    { escrow_id, depositor }: { escrow_id: u32; depositor: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a withdraw_job_funds transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  withdraw_job_funds: (
    {
      escrow_id,
      depositor,
      withdraw_amount,
      milestone_index,
    }: {
      escrow_id: u32;
      depositor: string;
      withdraw_amount: i128;
      milestone_index: u32;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a attest_verification transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Verifier attests `wallet` as the person behind `identity_hash` (a
   * salted hash, no personal data). One person can verify one wallet.
   */
  attest_verification: (
    {
      verifier,
      wallet,
      identity_hash,
    }: { verifier: string; wallet: string; identity_hash: Buffer },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_escrowed_amount transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Everything still owed to escrows in this token (unpaid principal plus
   * held fees). `None` = native XLM.
   */
  get_escrowed_amount: (
    { token }: { token: Option<string> },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<i128>>;

  /**
   * Construct and simulate a get_overdue_request transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_overdue_request: (
    { escrow_id }: { escrow_id: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Option<OverdueRequest>>>;

  /**
   * Construct and simulate a get_platform_fee_bp transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_platform_fee_bp: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<u32>>;

  /**
   * Construct and simulate a revoke_verification transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Verifier or owner withdraws a verification and frees the identity.
   */
  revoke_verification: (
    { caller, wallet }: { caller: string; wallet: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a set_platform_fee_bp transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_platform_fee_bp: (
    { fee_bp }: { fee_bp: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_resolution_votes transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Votes recorded for one specific split. Use `milestone_index =
   * 4294967295` for an overdue (whole-escrow) ruling.
   */
  get_resolution_votes: (
    {
      escrow_id,
      milestone_index,
      freelancer_amount,
      client_amount,
    }: {
      escrow_id: u32;
      milestone_index: u32;
      freelancer_amount: i128;
      client_amount: i128;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Array<string>>>;

  /**
   * Construct and simulate a is_token_blacklisted transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_token_blacklisted: (
    { token }: { token: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<boolean>>;

  /**
   * Construct and simulate a is_token_whitelisted transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_token_whitelisted: (
    { token }: { token: Option<string> },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<boolean>>;

  /**
   * Construct and simulate a submit_client_rating transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Freelancer rates the client (escrow must be Released).
   */
  submit_client_rating: (
    {
      escrow_id,
      rating,
      review,
      freelancer,
    }: { escrow_id: u32; rating: u32; review: string; freelancer: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a unpause_job_creation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  unpause_job_creation: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a withdraw_stuck_funds transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner recovers only the surplus above everything owed and every fee.
   */
  withdraw_stuck_funds: (
    { token, to, amount }: { token: string; to: string; amount: i128 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_application_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_application_count: (
    { escrow_id }: { escrow_id: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<u32>>;

  /**
   * Construct and simulate a get_applications_page transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_applications_page: (
    { escrow_id, offset, limit }: { escrow_id: u32; offset: u32; limit: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Array<Application>>>;

  /**
   * Construct and simulate a get_completed_escrows transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_completed_escrows: (
    { user }: { user: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<u32>>;

  /**
   * Construct and simulate a get_withdrawable_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Earned, unwithdrawn fees. `None` = native XLM.
   */
  get_withdrawable_fees: (
    { token }: { token: Option<string> },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<i128>>;

  /**
   * Construct and simulate a is_authorized_arbiter transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_authorized_arbiter: (
    { arbiter }: { arbiter: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<boolean>>;

  /**
   * Construct and simulate a raise_overdue_dispute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  raise_overdue_dispute: (
    {
      escrow_id,
      requester,
      reason,
    }: { escrow_id: u32; requester: string; reason: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a arbiter_approve_refund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Arbiter vote: return all unpaid funds to the client.
   */
  arbiter_approve_refund: (
    { escrow_id, arbiter }: { escrow_id: u32; arbiter: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_blacklisted_tokens transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_blacklisted_tokens: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Array<string>>>;

  /**
   * Construct and simulate a get_dispute_vote_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Arbiters who have voted in this escrow's current dispute round.
   */
  get_dispute_vote_count: (
    { escrow_id }: { escrow_id: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<u32>>;

  /**
   * Construct and simulate a get_user_cancellations transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_user_cancellations: (
    { user }: { user: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<u32>>;

  /**
   * Construct and simulate a get_whitelisted_tokens transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_whitelisted_tokens: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Array<string>>>;

  /**
   * Construct and simulate a is_job_creation_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_job_creation_paused: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<boolean>>;

  /**
   * Construct and simulate a get_authorized_arbiters transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_authorized_arbiters: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Array<string>>>;

  /**
   * Construct and simulate a set_job_creation_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Same as `pause_job_creation` / `unpause_job_creation` in one call (the
   * admin page uses this form).
   */
  set_job_creation_paused: (
    { paused }: { paused: boolean },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a arbiter_award_freelancer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Arbiter vote: `freelancer_amount` of the unpaid balance to the
   * freelancer, the rest to the client.
   */
  arbiter_award_freelancer: (
    {
      escrow_id,
      arbiter,
      freelancer_amount,
    }: { escrow_id: u32; arbiter: string; freelancer_amount: i128 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a propose_milestone_change transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  propose_milestone_change: (
    {
      escrow_id,
      milestone_index,
      proposed_amount,
      proposed_description,
      freelancer,
    }: {
      escrow_id: u32;
      milestone_index: u32;
      proposed_amount: i128;
      proposed_description: string;
      freelancer: string;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a get_average_client_rating transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `(sum_of_ratings, count)`.
   */
  get_average_client_rating: (
    { client }: { client: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<readonly [u32, u32]>>;

  /**
   * Construct and simulate a reject_milestone_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  reject_milestone_proposal: (
    {
      escrow_id,
      milestone_index,
      depositor,
    }: { escrow_id: u32; milestone_index: u32; depositor: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a approve_milestone_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Accepting a price change moves the difference (plus fee share) in the
   * same call.
   */
  approve_milestone_proposal: (
    {
      escrow_id,
      milestone_index,
      depositor,
    }: { escrow_id: u32; milestone_index: u32; depositor: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;

  /**
   * Construct and simulate a emergency_refund_after_deadline transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  emergency_refund_after_deadline: (
    { escrow_id, depositor }: { escrow_id: u32; depositor: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;
}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      },
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options);
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([
        "AAAAAgAAAAAAAAAAAAAABUJhZGdlAAAAAAAABAAAAAAAAAAAAAAACEJlZ2lubmVyAAAAAAAAAAAAAAAMSW50ZXJtZWRpYXRlAAAAAAAAAAAAAAAIQWR2YW5jZWQAAAAAAAAAAAAAAAZFeHBlcnQAAA==",
        "AAAAAQAAAAAAAAAAAAAABlJhdGluZwAAAAAABgAAAAAAAAAGY2xpZW50AAAAAAATAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAApmcmVlbGFuY2VyAAAAAAATAAAAAAAAAAhyYXRlZF9hdAAAAAQAAAAAAAAABnJhdGluZwAAAAAABAAAAAAAAAAGcmV2aWV3AAAAAAAQ",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAJgAAAAAAAAAAAAAABU93bmVyAAAAAAAAAAAAAAAAAAAMRmVlQ29sbGVjdG9yAAAAAAAAAAAAAAANUGxhdGZvcm1GZWVCUAAAAAAAAAAAAAAAAAAADE5leHRFc2Nyb3dJZAAAAAAAAAAAAAAAEUpvYkNyZWF0aW9uUGF1c2VkAAAAAAAAAAAAAAAAAAAOQ29udHJhY3RQYXVzZWQAAAAAAAAAAACiQWRkcmVzcyBvZiB0aGUgbmF0aXZlIFhMTSBTdGVsbGFyIEFzc2V0IENvbnRyYWN0IG9uIHRoaXMgbmV0d29yaywKZGVyaXZlZCBhdCBpbml0aWFsaXNhdGlvbiByYXRoZXIgdGhhbiBoYXJkLWNvZGVkLCBzbyB0aGUgc2FtZSBXQVNNCndvcmtzIG9uIHRlc3RuZXQgYW5kIG1haW5uZXQuAAAAAAALTmF0aXZlVG9rZW4AAAAAAQAAAAAAAAAQV2hpdGVsaXN0ZWRUb2tlbgAAAAEAAAATAAAAAAAAAAAAAAARV2hpdGVsaXN0ZWRUb2tlbnMAAAAAAAABAAAAAAAAABBCbGFja2xpc3RlZFRva2VuAAAAAQAAABMAAAAAAAAAAAAAABFCbGFja2xpc3RlZFRva2VucwAAAAAAAAEAAAAAAAAAEUF1dGhvcml6ZWRBcmJpdGVyAAAAAAAAAQAAABMAAAAAAAAAAAAAABJBdXRob3JpemVkQXJiaXRlcnMAAAAAAAEAAABJdG9rZW4gLT4gZXZlcnl0aGluZyBzdGlsbCBvd2VkIHRvIGVzY3Jvd3MgKHVucGFpZCBwcmluY2lwYWwgKyBoZWxkIGZlZXMpLgAAAAAAAA5Fc2Nyb3dlZEFtb3VudAAAAAAAAQAAABMAAAABAAAAK3Rva2VuIC0+IGZlZXMgZWFybmVkIGFuZCBub3QgeWV0IHdpdGhkcmF3bi4AAAAAEFRvdGFsRmVlc0J5VG9rZW4AAAABAAAAEwAAAAEAAAAAAAAABkVzY3JvdwAAAAAAAQAAAAQAAAABAAAAAAAAAAlNaWxlc3RvbmUAAAAAAAACAAAABAAAAAQAAAABAAAANGVzY3JvdyAtPiBhcHBsaWNhbnQgYWRkcmVzc2VzLCBpbiBhcHBsaWNhdGlvbiBvcmRlci4AAAAKQXBwbGljYW50cwAAAAAAAQAAAAQAAAABAAAAAAAAAAtBcHBsaWNhdGlvbgAAAAACAAAABAAAABMAAAABAAAArUEgZnJlZWxhbmNlciB3aG8gd2FzIG5hbWVkIG9uIHRoZSBqb2IgYW5kIGRlY2xpbmVkIGl0LiBMZXRzIHRoZSBjbGllbnQKbmFtZSB0aGVtIGFnYWluIHdpdGhvdXQgYW4gYXBwbGljYXRpb24sIHdpdGhvdXQgY291bnRpbmcgYXMgYW4KYXBwbGljYW50IGZvciB0aGUgY2FuY2VsbGF0aW9uIHBlbmFsdHkuAAAAAAAACERlY2xpbmVkAAAAAgAAAAQAAAATAAAAAQAAAAAAAAAKSm9iTWFuYWdlcgAAAAAAAQAAAAQAAAABAAAAM1RoZSBqb2IgaGFzIGJlZW4gdGhyb3VnaCBhcmJpdHJhdGlvbiBhdCBsZWFzdCBvbmNlLgAAAAAKQXJiaXRyYXRlZAAAAAAAAQAAAAQAAAABAAAAAAAAAA5PdmVyZHVlUmVxdWVzdAAAAAAAAQAAAAQAAAABAAAAAAAAAAhFdmlkZW5jZQAAAAIAAAAEAAAABAAAAAEAAAA+QXJiaXRlcnMgd2hvIGhhdmUgdm90ZWQgaW4gdGhlIGVzY3JvdydzIGN1cnJlbnQgZGlzcHV0ZSByb3VuZC4AAAAAAA1EaXNwdXRlVm90ZXJzAAAAAAAAAQAAAAQAAAABAAAArihlc2Nyb3csIG1pbGVzdG9uZSwgYGZyZWVsYW5jZXJfYW1vdW50YCwgYGNsaWVudF9hbW91bnRgKSAtPiB2b3RlcnMuCktleWVkIGJ5IHRoZSBzcGxpdCwgc28gcXVvcnVtIG1lYW5zIE4gYXJiaXRlcnMgYWdyZWVpbmcgb24gb25lIG91dGNvbWUKcmF0aGVyIHRoYW4gTiBhcmJpdGVycyB0dXJuaW5nIHVwLgAAAAAAD1Jlc29sdXRpb25Wb3RlcwAAAAAEAAAABAAAAAQAAAALAAAACwAAAAEAAAAAAAAAC1VzZXJFc2Nyb3dzAAAAAAEAAAATAAAAAQAAAAAAAAAKUmVwdXRhdGlvbgAAAAAAAQAAABMAAAABAAAAAAAAABBDb21wbGV0ZWRFc2Nyb3dzAAAAAQAAABMAAAABAAAAAAAAAAZSYXRpbmcAAAAAAAEAAAAEAAAAAQAAAAAAAAANQXZlcmFnZVJhdGluZwAAAAAAAAEAAAATAAAAAQAAAAAAAAAMQ2xpZW50UmF0aW5nAAAAAQAAAAQAAAABAAAAAAAAABNBdmVyYWdlQ2xpZW50UmF0aW5nAAAAAAEAAAATAAAAAQAAAAAAAAARVXNlckNhbmNlbGxhdGlvbnMAAAAAAAABAAAAEwAAAAEAAAAAAAAAFkxhc3RDYW5jZWxsYXRpb25MZWRnZXIAAAAAAAEAAAATAAAAAAAAADZJbnN0YW5jZTogdGhlIGFkZHJlc3MgYWxsb3dlZCB0byBhdHRlc3QgdmVyaWZpY2F0aW9ucy4AAAAAAAhWZXJpZmllcgAAAAEAAAAvUGVyc2lzdGVudDogd2FsbGV0IC0+IGBGcmVlbGFuY2VyVmVyaWZpY2F0aW9uYC4AAAAADFZlcmlmaWNhdGlvbgAAAAEAAAATAAAAAQAAAD5QZXJzaXN0ZW50OiBpZGVudGl0eSBoYXNoIC0+IHRoZSBvbmUgd2FsbGV0IGl0IGlzIHZlcmlmaWVkIG9uLgAAAAAAD0lkZW50aXR5QmluZGluZwAAAAABAAAD7gAAACA=",
        "AAAAAQAAAAAAAAAAAAAACU1pbGVzdG9uZQAAAAAAABEAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAALYXBwcm92ZWRfYXQAAAAABAAAAHBGcmVlbGFuY2VyJ3Mgc3VibWlzc2lvbiB0ZXh0ICh0aGUgY2xpZW50J3MgcmVxdWlyZW1lbnQgdW50aWwgdGhlIGZpcnN0CnN1Ym1pc3Npb24sIG9yIGFuIGFwcHJvdmVkIHNjb3BlIGNoYW5nZSkuAAAAC2Rlc2NyaXB0aW9uAAAAABAAAAAAAAAADmRpc3B1dGVfcmVhc29uAAAAAAPoAAAAEAAAAAAAAAALZGlzcHV0ZWRfYXQAAAAABAAAAAAAAAALZGlzcHV0ZWRfYnkAAAAD6AAAABMAAAAAAAAAD3Byb3Bvc2VkX2Ftb3VudAAAAAALAAAAAAAAABRwcm9wb3NlZF9kZXNjcmlwdGlvbgAAA+gAAAAQAAAAAAAAABByZWplY3Rpb25fcmVhc29uAAAD6AAAABAAAACJVGhlIGNsaWVudCdzIG9yaWdpbmFsIHJlcXVpcmVtZW50LiBTZXQgb25jZSBhbmQgbmV2ZXIgb3ZlcndyaXR0ZW4sIHNvCmEgZGlzcHV0ZSBjYW4gYWx3YXlzIGJlIGp1ZGdlZCBhZ2FpbnN0IHdoYXQgd2FzIGFjdHVhbGx5IGFza2VkIGZvci4AAAAAAAAMcmVxdWlyZW1lbnRzAAAAEAAAAAAAAAAYcmVzb2x1dGlvbl9jbGllbnRfYW1vdW50AAAACwAAAAAAAAAccmVzb2x1dGlvbl9mcmVlbGFuY2VyX2Ftb3VudAAAAAsAAAAAAAAAEXJlc29sdXRpb25fcmVhc29uAAAAAAAD6AAAABAAAAAAAAAAC3Jlc29sdmVkX2F0AAAAAAQAAAAAAAAAC3Jlc29sdmVkX2J5AAAAA+gAAAATAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAPTWlsZXN0b25lU3RhdHVzAAAAAAAAAAAMc3VibWl0dGVkX2F0AAAABA==",
        "AAAAAQAAAXhPbmUgZXNjcm93LgoKRkVFIE1PREVMLiBUaGUgY2xpZW50IGRlcG9zaXRzIGB0b3RhbF9hbW91bnQgKyBwbGF0Zm9ybV9mZWVgLiBNaWxlc3RvbmVzCmFsd2F5cyBzdW0gdG8gYHRvdGFsX2Ftb3VudGAsIHNvIHBheWluZyBldmVyeSBtaWxlc3RvbmUgbGVhdmVzIGV4YWN0bHkgdGhlCmZlZSBiZWhpbmQuIFRoZSBmZWUgaXMgSEVMRCwgbm90IGVhcm5lZCwgdW50aWwgdGhlIGpvYiBzZXR0bGVzOiBjYW5jZWxsaW5nLApzaHJpbmtpbmcgdGhlIGpvYiBvciBhIHJlZnVuZCBydWxpbmcgaGFuZHMgYmFjayB0aGUgbWF0Y2hpbmcgc2hhcmUgb2YgaXQuCk9ubHkgYSBjb21wbGV0ZWQgKG9yIHBhcnRseSBjb21wbGV0ZWQpIGpvYiB0dXJucyBpdCBpbnRvIHJldmVudWUuAAAAAAAAAApFc2Nyb3dEYXRhAAAAAAAQAAAAAAAAAAhhcmJpdGVycwAAA+oAAAATAAAAAAAAAAtiZW5lZmljaWFyeQAAAAPoAAAAEwAAABBMZWRnZXIgc2VxdWVuY2UuAAAACmNyZWF0ZWRfYXQAAAAAAAQAAAAQTGVkZ2VyIHNlcXVlbmNlLgAAAAhkZWFkbGluZQAAAAQAAAAAAAAACWRlcG9zaXRvcgAAAAAAABMAAAAAAAAAC2lzX29wZW5fam9iAAAAAAEAAAAAAAAAD21pbGVzdG9uZV9jb3VudAAAAAAEAAAAAAAAAAtwYWlkX2Ftb3VudAAAAAALAAAAPEZlZSBzdGlsbCBoZWxkIGZvciB0aGlzIGVzY3JvdyAobm90IHlldCBlYXJuZWQgb3IgcmVmdW5kZWQpLgAAAAxwbGF0Zm9ybV9mZWUAAAALAAAAAAAAABNwcm9qZWN0X2Rlc2NyaXB0aW9uAAAAABAAAAAAAAAADXByb2plY3RfdGl0bGUAAAAAAAAQAAAAAAAAABZyZXF1aXJlZF9jb25maXJtYXRpb25zAAAAAAAEAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAMRXNjcm93U3RhdHVzAAAAAAAAAAV0b2tlbgAAAAAAA+gAAAATAAAAI05ldCBvZiBmZWUuIE1pbGVzdG9uZXMgc3VtIHRvIHRoaXMuAAAAAAx0b3RhbF9hbW91bnQAAAALAAAAAAAAAAx3b3JrX3N0YXJ0ZWQAAAAB",
        "AAAAAQAAAAAAAAAAAAAAC0FwcGxpY2F0aW9uAAAAAAQAAAAAAAAACmFwcGxpZWRfYXQAAAAAAAQAAAAAAAAADGNvdmVyX2xldHRlcgAAABAAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAAAAAAAEXByb3Bvc2VkX3RpbWVsaW5lAAAAAAAABA==",
        "AAAAAgAAAAAAAAAAAAAADEVzY3Jvd1N0YXR1cwAAAAcAAAAAAAAAAAAAAAdQZW5kaW5nAAAAAAAAAAAAAAAACkluUHJvZ3Jlc3MAAAAAAAAAAAAAAAAACFJlbGVhc2VkAAAAAAAAAAAAAAAIUmVmdW5kZWQAAAAAAAAAAAAAAAhEaXNwdXRlZAAAAAAAAAAAAAAAB0V4cGlyZWQAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAA",
        "AAAAAQAAAAAAAAAAAAAADUV2aWRlbmNlRW50cnkAAAAAAAADAAAAAAAAAANjaWQAAAAAEAAAAAAAAAAMc3VibWl0dGVkX2F0AAAABgAAAAAAAAAJc3VibWl0dGVyAAAAAAAAEw==",
        "AAAAAQAAAAAAAAAAAAAADk92ZXJkdWVSZXF1ZXN0AAAAAAADAAAAAAAAAAZyZWFzb24AAAAAABAAAAAAAAAADHJlcXVlc3RlZF9hdAAAAAQAAAAAAAAACXJlcXVlc3RlcgAAAAAAABM=",
        "AAAAAgAAAAAAAAAAAAAAD01pbGVzdG9uZVN0YXR1cwAAAAAHAAAAAAAAAAAAAAAKTm90U3RhcnRlZAAAAAAAAAAAAAAAAAAJU3VibWl0dGVkAAAAAAAAAAAAAAAAAAAIQXBwcm92ZWQAAAAAAAAAAAAAAAhEaXNwdXRlZAAAAAAAAAAAAAAACFJlc29sdmVkAAAAAAAAAAAAAAAIUmVqZWN0ZWQAAAAAAAAAAAAAAA9Qcm9wb3NhbFBlbmRpbmcA",
        "AAAAAQAAAAAAAAAAAAAAEENsaWVudFJhdGluZ0RhdGEAAAAGAAAAAAAAAAZjbGllbnQAAAAAABMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAAAAAAACHJhdGVkX2F0AAAABAAAAAAAAAAGcmF0aW5nAAAAAAAEAAAAAAAAAAZyZXZpZXcAAAAAABA=",
        "AAAAAQAAAUFBIGZyZWVsYW5jZXIncyBpZGVudGl0eSB2ZXJpZmljYXRpb24sIGF0dGVzdGVkIGJ5IHRoZSB2ZXJpZmllciBhZnRlciBhCkRpZGl0IGNoZWNrLiBIb2xkcyBOTyBwZXJzb25hbCBkYXRhOiBgaWRlbnRpdHlfaGFzaGAgaXMgYSBzYWx0ZWQgaGFzaCBvZgp0aGUgcGVyc29uJ3Mgbm9ybWFsaXNlZCBpZGVudGl0eSwgY29tcHV0ZWQgb2ZmLWNoYWluIHdpdGggYSBzZWNyZXQgc2FsdCwgc28KaXQgY2Fubm90IGJlIHJldmVyc2VkIOKAlCBpdCBvbmx5IGxldHMgdGhlIGNvbnRyYWN0IG5vdGljZSB0aGUgc2FtZSBwZXJzb24KdmVyaWZ5aW5nIGEgc2Vjb25kIHdhbGxldC4AAAAAAAAAAAAAFkZyZWVsYW5jZXJWZXJpZmljYXRpb24AAAAAAAMAAAAAAAAADWlkZW50aXR5X2hhc2gAAAAAAAPuAAAAIAAAAC5MZWRnZXIgdGltZXN0YW1wIChzZWNvbmRzKSBvZiB0aGUgYXR0ZXN0YXRpb24uAAAAAAALdmVyaWZpZWRfYXQAAAAABgAAAAAAAAAIdmVyaWZpZXIAAAAT",
        "AAAAAAAAAfhPd25lciByZXBsYWNlcyB0aGUgY29udHJhY3QgY29kZSBpbiBwbGFjZSwga2VlcGluZyBldmVyeSBlc2Nyb3cuCgpXaGF0IHRoYXQgY29zdHMsIHN0YXRlZCBwbGFpbmx5OiB0aGUgQ09OVFJBQ1QgY2Fubm90IHRha2UgYW55b25lJ3MKbW9uZXksIGJ1dCB0aGUgT1dORVIgY2FuIGNoYW5nZSB0aGUgY29udHJhY3QuIERvIG5vdCBkZXNjcmliZSB0aGlzCmRlcGxveW1lbnQgYXMgdHJ1c3RsZXNzIHdpdGhvdXQgdGhhdCBzZWNvbmQgY2xhdXNlLgoKU3RvcmFnZSBpcyBvbmx5IHNhZmUgYWNyb3NzIGFuIHVwZ3JhZGUgaWYgc3RvcmVkIHR5cGVzIHN0YXkgcmVhZGFibGU6Cm5ldmVyIHJlb3JkZXIsIHJldHlwZSBvciByZW1vdmUgYSBmaWVsZCBvZiBhIHN0b3JlZCBzdHJ1Y3QgKGFkZGluZyBvbmUKYnJlYWtzIG9sZCBlbnRyaWVzIHRvbyDigJQgdGhhdCBpcyB3aGF0IGZvcmNlZCB0aGUgSnVseSByZWRlcGxveSkuIEJ1bXAKYENPTlRSQUNUX1ZFUlNJT05gIHdpdGggZXZlcnkgdXBncmFkZS4AAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAADlEZXBsb3llZCBpbXBsZW1lbnRhdGlvbiwgcmVhZGFibGUgZnJvbSBjaGFpbiBzdGF0ZSBhbG9uZS4AAAAAAAAHdmVyc2lvbgAAAAAAAAAAAQAAABA=",
        "AAAAAAAAAAAAAAAJZ2V0X2JhZGdlAAAAAAAAAQAAAAAAAAAKZnJlZWxhbmNlcgAAAAAAEwAAAAEAAAfQAAAABUJhZGdlAAAA",
        "AAAAAAAAAAAAAAAJZ2V0X293bmVyAAAAAAAAAAAAAAEAAAPpAAAAEwAAAAM=",
        "AAAAAAAAAC1Cb3RoIHRoZSBjdXJyZW50IGFuZCB0aGUgbmV3IG93bmVyIG11c3Qgc2lnbi4AAAAAAAAJc2V0X293bmVyAAAAAAAAAQAAAAAAAAAJbmV3X293bmVyAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAHVCZWZvcmUgd29yayBzdGFydHMsIGNhbmNlbCBhbmQgdGFrZSBiYWNrIHRoZSB1bnBhaWQgYnVkZ2V0IHBsdXMgdGhlCmhlbGQgZmVlLCBtaW51cyBhIHBlbmFsdHkgb25seSBpZiBwZW9wbGUgYXBwbGllZC4AAAAAAAAKY2FuY2VsX2pvYgAAAAAAAgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAKZ2V0X2VzY3JvdwAAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAEAAAPoAAAH0AAAAApFc2Nyb3dEYXRhAAA=",
        "AAAAAAAAAAAAAAAKZ2V0X3JhdGluZwAAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAEAAAPoAAAH0AAAAAZSYXRpbmcAAA==",
        "AAAAAAAAACJPbmUtdGltZSBzZXR1cC4gYG93bmVyYCBtdXN0IHNpZ24uAAAAAAAKaW5pdGlhbGl6ZQAAAAAABAAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAA1mZWVfY29sbGVjdG9yAAAAAAAAEwAAAAAAAAAPcGxhdGZvcm1fZmVlX2JwAAAAAAQAAAAAAAAAGmRlZmF1bHRfd2hpdGVsaXN0ZWRfdG9rZW5zAAAAAAPqAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAERQdXQgYSBkZWNsaW5lZCBvciBhcmJpdHJhdGVkIGpvYiBiYWNrIG9uIHRoZSBib2FyZCB3aXRoIGl0cyBoaXN0b3J5LgAAAApyZW9wZW5fam9iAAAAAAACAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAAAAAAAKc3RhcnRfd29yawAAAAAAAgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAALYmVuZWZpY2lhcnkAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAALaGFzX2FwcGxpZWQAAAAAAgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAKZnJlZWxhbmNlcgAAAAAAEwAAAAEAAAAB",
        "AAAAAAAAAAAAAAALaXNfdmVyaWZpZWQAAAAAAQAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAMYXBwbHlfdG9fam9iAAAABAAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAMY292ZXJfbGV0dGVyAAAAEAAAAAAAAAARcHJvcG9zZWRfdGltZWxpbmUAAAAAAAAEAAAAAAAAAApmcmVlbGFuY2VyAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAAAAAAAMZGVsaXN0X3Rva2VuAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAAAAAAAMZ2V0X2V2aWRlbmNlAAAAAgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAABAAAD6gAAB9AAAAANRXZpZGVuY2VFbnRyeQAAAA==",
        "AAAAAAAAAAAAAAAMZ2V0X3ZlcmlmaWVyAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAADtPd25lciBhcHBvaW50cyB0aGUgdmVyaWZpZXIga2V5IHRoYXQgYXR0ZXN0cyBEaWRpdCByZXN1bHRzLgAAAAAMc2V0X3ZlcmlmaWVyAAAAAQAAAAAAAAAIdmVyaWZpZXIAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAAAAAAANYWRkX2pvYl9mdW5kcwAAAAAAAAQAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAACWRlcG9zaXRvcgAAAAAAABMAAAAAAAAAEWFkZGl0aW9uYWxfYW1vdW50AAAAAAAACwAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAADZBZGQgYSBtaWxlc3RvbmUsIGRlcG9zaXRpbmcgaXRzIGFtb3VudCBwbHVzIGZlZSBzaGFyZS4AAAAAAA1hZGRfbWlsZXN0b25lAAAAAAAABAAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAPNGdW5kIGEgbWlsZXN0b25lIGVzY3Jvdy4gVGhlIGRlcG9zaXRvciBwYXlzIGB0b3RhbF9hbW91bnRgIHBsdXMgdGhlCnBsYXRmb3JtIGZlZSAoc2VlIGBxdW90ZV9kZXBvc2l0YCk7IG1pbGVzdG9uZSBhbW91bnRzIG11c3Qgc3VtIHRvCmV4YWN0bHkgYHRvdGFsX2Ftb3VudGAuIGBiZW5lZmljaWFyeTogTm9uZWAgcG9zdHMgYW4gb3BlbiBqb2IuCmBkdXJhdGlvbmAgaXMgaW4gc2Vjb25kcyAoMSBob3VyIHRvIDM2NSBkYXlzKS4AAAAADWNyZWF0ZV9lc2Nyb3cAAAAAAAAKAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAAAAAAtiZW5lZmljaWFyeQAAAAPoAAAAEwAAAAAAAAAIYXJiaXRlcnMAAAPqAAAAEwAAAAAAAAAWcmVxdWlyZWRfY29uZmlybWF0aW9ucwAAAAAABAAAAAAAAAAKbWlsZXN0b25lcwAAAAAD6gAAA+0AAAACAAAACwAAABAAAAAAAAAABXRva2VuAAAAAAAD6AAAABMAAAAAAAAADHRvdGFsX2Ftb3VudAAAAAsAAAAAAAAACGR1cmF0aW9uAAAABAAAAAAAAAANcHJvamVjdF90aXRsZQAAAAAAABAAAAAAAAAAE3Byb2plY3RfZGVzY3JpcHRpb24AAAAAEAAAAAEAAAPpAAAABAAAAAM=",
        "AAAAAAAAAD5Pd25lciBkZWxldGVzIGEgc2V0dGxlZCBlc2Nyb3cgYW5kIGV2ZXJ5dGhpbmcgc3RvcmVkIHVuZGVyIGl0LgAAAAAADWRlbGV0ZV9lc2Nyb3cAAAAAAAABAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAAAAAAANZ2V0X21pbGVzdG9uZQAAAAAAAAIAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAQAAA+gAAAfQAAAACU1pbGVzdG9uZQAAAA==",
        "AAAAAAAAAAAAAAANaXNfYXJiaXRyYXRlZAAAAAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAABAAAAAQ==",
        "AAAAAAAAAEBgKGRlcG9zaXQsIGZlZSlgIGEgY2xpZW50IG11c3QgcGF5IHRvIGZ1bmQgYHRvdGFsX2Ftb3VudGAgdG9kYXkuAAAADXF1b3RlX2RlcG9zaXQAAAAAAAABAAAAAAAAAAx0b3RhbF9hbW91bnQAAAALAAAAAQAAA+kAAAPtAAAAAgAAAAsAAAALAAAAAw==",
        "AAAAAAAAAD5TYW1lIGFzIGBjYW5jZWxfam9iYDogYmVmb3JlIHdvcmsgc3RhcnRzLCB0YWtlIHRoZSBtb25leSBiYWNrLgAAAAAADXJlZnVuZF9lc2Nyb3cAAAAAAAACAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAADZDbGllbnQgcmF0ZXMgdGhlIGZyZWVsYW5jZXIgKGVzY3JvdyBtdXN0IGJlIFJlbGVhc2VkKS4AAAAAAA1zdWJtaXRfcmF0aW5nAAAAAAAABAAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAGcmF0aW5nAAAAAAAEAAAAAAAAAAZyZXZpZXcAAAAAABAAAAAAAAAABmNsaWVudAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAANd2l0aGRyYXdfZmVlcwAAAAAAAAIAAAAAAAAABXRva2VuAAAAAAAD6AAAABMAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAOZ2V0X21pbGVzdG9uZXMAAAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAABAAAD6gAAB9AAAAAJTWlsZXN0b25lAAAA",
        "AAAAAAAAAAAAAAAOZ2V0X3JlcHV0YXRpb24AAAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAAOaXNfam9iX21hbmFnZXIAAAAAAAIAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAAA3dobwAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAOcGF1c2VfY29udHJhY3QAAAAAAAAAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAAAAAAAOcmVtb3ZlX2FyYml0ZXIAAAAAAAEAAAAAAAAAB2FyYml0ZXIAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAD9SZXBsYWNlIHRoZSB3aG9sZSBtaWxlc3RvbmUgbGlzdCwgc2V0dGxpbmcgYW55IGNoYW5nZSBpbiB0b3RhbC4AAAAADnNldF9taWxlc3RvbmVzAAAAAAADAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAAptaWxlc3RvbmVzAAAAAAPqAAAD7QAAAAIAAAALAAAAEAAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAPYmxhY2tsaXN0X3Rva2VuAAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAACZgZXh0cmFfc2Vjb25kc2A6IDEgc2Vjb25kIHRvIDM2NSBkYXlzLgAAAAAAD2V4dGVuZF9kZWFkbGluZQAAAAADAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAA1leHRyYV9zZWNvbmRzAAAAAAAABAAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAPZ2V0X2FwcGxpY2F0aW9uAAAAAAIAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAABAAAD6AAAB9AAAAALQXBwbGljYXRpb24A",
        "AAAAAAAAAAAAAAAPZ2V0X2pvYl9tYW5hZ2VyAAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAABAAAD6AAAABM=",
        "AAAAAAAAAHFBcmJpdGVyIHZvdGUgdG8gc3BsaXQgb25lIG1pbGVzdG9uZS4gRXhlY3V0ZXMgd2hlbiBlbm91Z2ggYXJiaXRlcnMKYWdyZWUgb24gdGhlIHNhbWUgc3BsaXQuIGByZWFzb25gIGlzIHJlcXVpcmVkLgAAAAAAAA9yZXNvbHZlX2Rpc3B1dGUAAAAABgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAAAAAAAB2FyYml0ZXIAAAAAEwAAAAAAAAARZnJlZWxhbmNlcl9hbW91bnQAAAAAAAALAAAAAAAAAA1jbGllbnRfYW1vdW50AAAAAAAACwAAAAAAAAAGcmVhc29uAAAAAAAQAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAAAAAAAPc2V0X2pvYl9tYW5hZ2VyAAAAAAMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAAB21hbmFnZXIAAAAAEwAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAPc3VibWl0X2V2aWRlbmNlAAAAAAQAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAAAAAAlzdWJtaXR0ZXIAAAAAAAATAAAAAAAAAANjaWQAAAAAEAAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAPd2hpdGVsaXN0X3Rva2VuAAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAQZ2V0X2FwcGxpY2F0aW9ucwAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAABAAAD6gAAB9AAAAALQXBwbGljYXRpb24A",
        "AAAAAAAAAAAAAAAQZ2V0X25hdGl2ZV90b2tlbgAAAAAAAAABAAAAEw==",
        "AAAAAAAAAAAAAAAQZ2V0X3VzZXJfZXNjcm93cwAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAA+oAAAAE",
        "AAAAAAAAAAAAAAAQZ2V0X3ZlcmlmaWNhdGlvbgAAAAEAAAAAAAAABndhbGxldAAAAAAAEwAAAAEAAAPoAAAH0AAAABZGcmVlbGFuY2VyVmVyaWZpY2F0aW9uAAA=",
        "AAAAAAAAAD1gZGVwb3NpdG9yYCBtYXkgYmUgdGhlIGNsaWVudCBvciB0aGVpciBhcHBvaW50ZWQgam9iIG1hbmFnZXIuAAAAAAAAEHJlamVjdF9taWxlc3RvbmUAAAAEAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAAAAAAGcmVhc29uAAAAAAAQAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAADhSZW1vdmUgYSBtaWxlc3RvbmUsIHJlZnVuZGluZyBpdHMgYW1vdW50IHBsdXMgZmVlIHNoYXJlLgAAABByZW1vdmVfbWlsZXN0b25lAAAAAwAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAAAAAAACWRlcG9zaXRvcgAAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAADVEZWxpdmVyIGEgbWlsZXN0b25lIChhbHNvIHJlZGVsaXZlcnMgYSByZWplY3RlZCBvbmUpLgAAAAAAABBzdWJtaXRfbWlsZXN0b25lAAAABAAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAAAAAAAC2Rlc2NyaXB0aW9uAAAAABAAAAAAAAAAC2JlbmVmaWNpYXJ5AAAAABMAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAAAAAAAQdW5wYXVzZV9jb250cmFjdAAAAAAAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAD1gZGVwb3NpdG9yYCBtYXkgYmUgdGhlIGNsaWVudCBvciB0aGVpciBhcHBvaW50ZWQgam9iIG1hbmFnZXIuAAAAAAAAEWFjY2VwdF9mcmVlbGFuY2VyAAAAAAAAAwAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAKZnJlZWxhbmNlcgAAAAAAEwAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAD1gZGVwb3NpdG9yYCBtYXkgYmUgdGhlIGNsaWVudCBvciB0aGVpciBhcHBvaW50ZWQgam9iIG1hbmFnZXIuAAAAAAAAEWFwcHJvdmVfbWlsZXN0b25lAAAAAAAAAwAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAAAAAAACWRlcG9zaXRvcgAAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAAAAAAARYXV0aG9yaXplX2FyYml0ZXIAAAAAAAABAAAAAAAAAAdhcmJpdGVyAAAAABMAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAEdDbGllbnQsIGZyZWVsYW5jZXIgb3Igam9iIG1hbmFnZXIgZXNjYWxhdGVzIGEgbWlsZXN0b25lIHRvIGFyYml0cmF0aW9uLgAAAAARZGlzcHV0ZV9taWxlc3RvbmUAAAAAAAAEAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAAAAAAGcmVhc29uAAAAAAAQAAAAAAAAAAhkaXNwdXRlcgAAABMAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAAAAAAARZ2V0X2NsaWVudF9yYXRpbmcAAAAAAAABAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAA+gAAAfQAAAAEENsaWVudFJhdGluZ0RhdGE=",
        "AAAAAAAAAAAAAAARZ2V0X2ZlZV9jb2xsZWN0b3IAAAAAAAAAAAAAAQAAA+kAAAATAAAAAw==",
        "AAAAAAAAAAAAAAARZ2V0X3RvdGFsX2VzY3Jvd3MAAAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAARaGFzX2Rpc3B1dGVfdm90ZWQAAAAAAAACAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAAdhcmJpdGVyAAAAABMAAAABAAAAAQ==",
        "AAAAAAAAAAAAAAARc2V0X2ZlZV9jb2xsZWN0b3IAAAAAAAABAAAAAAAAAA1mZWVfY29sbGVjdG9yAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAARdW5ibGFja2xpc3RfdG9rZW4AAAAAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAADtUaGUgbmFtZWQgZnJlZWxhbmNlciBoYW5kcyB0aGUgam9iIGJhY2sgYmVmb3JlIHN0YXJ0aW5nIGl0LgAAAAASZGVjbGluZV9hc3NpZ25tZW50AAAAAAACAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAAtiZW5lZmljaWFyeQAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAABpgKHN1bV9vZl9yYXRpbmdzLCBjb3VudClgLgAAAAAAEmdldF9hdmVyYWdlX3JhdGluZwAAAAAAAQAAAAAAAAAKZnJlZWxhbmNlcgAAAAAAEwAAAAEAAAPtAAAAAgAAAAQAAAAE",
        "AAAAAAAAADlBZ3JlZWluZyB2b3RlcyBuZWVkZWQgdG8gZXhlY3V0ZSBhIHJ1bGluZyBvbiB0aGlzIGVzY3Jvdy4AAAAAAAASZ2V0X3JlcXVpcmVkX3ZvdGVzAAAAAAABAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAA+kAAAAEAAAAAw==",
        "AAAAAAAAAAAAAAASaXNfY29udHJhY3RfcGF1c2VkAAAAAAAAAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAScGF1c2Vfam9iX2NyZWF0aW9uAAAAAAAAAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAAAAAAAScmVzdWJtaXRfbWlsZXN0b25lAAAAAAAEAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAAAAAALZGVzY3JpcHRpb24AAAAAEAAAAAAAAAALYmVuZWZpY2lhcnkAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAScmV2b2tlX2pvYl9tYW5hZ2VyAAAAAAACAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAAAAAAASd2l0aGRyYXdfam9iX2Z1bmRzAAAAAAAEAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAAAAAA93aXRoZHJhd19hbW91bnQAAAAACwAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAINWZXJpZmllciBhdHRlc3RzIGB3YWxsZXRgIGFzIHRoZSBwZXJzb24gYmVoaW5kIGBpZGVudGl0eV9oYXNoYCAoYQpzYWx0ZWQgaGFzaCwgbm8gcGVyc29uYWwgZGF0YSkuIE9uZSBwZXJzb24gY2FuIHZlcmlmeSBvbmUgd2FsbGV0LgAAAAATYXR0ZXN0X3ZlcmlmaWNhdGlvbgAAAAADAAAAAAAAAAh2ZXJpZmllcgAAABMAAAAAAAAABndhbGxldAAAAAAAEwAAAAAAAAANaWRlbnRpdHlfaGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAGZFdmVyeXRoaW5nIHN0aWxsIG93ZWQgdG8gZXNjcm93cyBpbiB0aGlzIHRva2VuICh1bnBhaWQgcHJpbmNpcGFsIHBsdXMKaGVsZCBmZWVzKS4gYE5vbmVgID0gbmF0aXZlIFhMTS4AAAAAABNnZXRfZXNjcm93ZWRfYW1vdW50AAAAAAEAAAAAAAAABXRva2VuAAAAAAAD6AAAABMAAAABAAAACw==",
        "AAAAAAAAAAAAAAATZ2V0X292ZXJkdWVfcmVxdWVzdAAAAAABAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAA+gAAAfQAAAADk92ZXJkdWVSZXF1ZXN0AAA=",
        "AAAAAAAAAAAAAAATZ2V0X3BsYXRmb3JtX2ZlZV9icAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAEJWZXJpZmllciBvciBvd25lciB3aXRoZHJhd3MgYSB2ZXJpZmljYXRpb24gYW5kIGZyZWVzIHRoZSBpZGVudGl0eS4AAAAAABNyZXZva2VfdmVyaWZpY2F0aW9uAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAAAAAAATc2V0X3BsYXRmb3JtX2ZlZV9icAAAAAABAAAAAAAAAAZmZWVfYnAAAAAAAAQAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAG9Wb3RlcyByZWNvcmRlZCBmb3Igb25lIHNwZWNpZmljIHNwbGl0LiBVc2UgYG1pbGVzdG9uZV9pbmRleCA9CjQyOTQ5NjcyOTVgIGZvciBhbiBvdmVyZHVlICh3aG9sZS1lc2Nyb3cpIHJ1bGluZy4AAAAAFGdldF9yZXNvbHV0aW9uX3ZvdGVzAAAABAAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAAAAAAAEWZyZWVsYW5jZXJfYW1vdW50AAAAAAAACwAAAAAAAAANY2xpZW50X2Ftb3VudAAAAAAAAAsAAAABAAAD6gAAABM=",
        "AAAAAAAAAAAAAAAUaXNfdG9rZW5fYmxhY2tsaXN0ZWQAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAAAQ==",
        "AAAAAAAAAAAAAAAUaXNfdG9rZW5fd2hpdGVsaXN0ZWQAAAABAAAAAAAAAAV0b2tlbgAAAAAAA+gAAAATAAAAAQAAAAE=",
        "AAAAAAAAADZGcmVlbGFuY2VyIHJhdGVzIHRoZSBjbGllbnQgKGVzY3JvdyBtdXN0IGJlIFJlbGVhc2VkKS4AAAAAABRzdWJtaXRfY2xpZW50X3JhdGluZwAAAAQAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAABnJhdGluZwAAAAAABAAAAAAAAAAGcmV2aWV3AAAAAAAQAAAAAAAAAApmcmVlbGFuY2VyAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAAAAAAAUdW5wYXVzZV9qb2JfY3JlYXRpb24AAAAAAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAERPd25lciByZWNvdmVycyBvbmx5IHRoZSBzdXJwbHVzIGFib3ZlIGV2ZXJ5dGhpbmcgb3dlZCBhbmQgZXZlcnkgZmVlLgAAABR3aXRoZHJhd19zdHVja19mdW5kcwAAAAMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAVZ2V0X2FwcGxpY2F0aW9uX2NvdW50AAAAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAEAAAAE",
        "AAAAAAAAAAAAAAAVZ2V0X2FwcGxpY2F0aW9uc19wYWdlAAAAAAAAAwAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAGb2Zmc2V0AAAAAAAEAAAAAAAAAAVsaW1pdAAAAAAAAAQAAAABAAAD6gAAB9AAAAALQXBwbGljYXRpb24A",
        "AAAAAAAAAAAAAAAVZ2V0X2NvbXBsZXRlZF9lc2Nyb3dzAAAAAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAABA==",
        "AAAAAAAAAC5FYXJuZWQsIHVud2l0aGRyYXduIGZlZXMuIGBOb25lYCA9IG5hdGl2ZSBYTE0uAAAAAAAVZ2V0X3dpdGhkcmF3YWJsZV9mZWVzAAAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAPoAAAAEwAAAAEAAAAL",
        "AAAAAAAAAAAAAAAVaXNfYXV0aG9yaXplZF9hcmJpdGVyAAAAAAAAAQAAAAAAAAAHYXJiaXRlcgAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAVcmFpc2Vfb3ZlcmR1ZV9kaXNwdXRlAAAAAAAAAwAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAJcmVxdWVzdGVyAAAAAAAAEwAAAAAAAAAGcmVhc29uAAAAAAAQAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAADRBcmJpdGVyIHZvdGU6IHJldHVybiBhbGwgdW5wYWlkIGZ1bmRzIHRvIHRoZSBjbGllbnQuAAAAFmFyYml0ZXJfYXBwcm92ZV9yZWZ1bmQAAAAAAAIAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAAB2FyYml0ZXIAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAWZ2V0X2JsYWNrbGlzdGVkX3Rva2VucwAAAAAAAAAAAAEAAAPqAAAAEw==",
        "AAAAAAAAAD9BcmJpdGVycyB3aG8gaGF2ZSB2b3RlZCBpbiB0aGlzIGVzY3JvdydzIGN1cnJlbnQgZGlzcHV0ZSByb3VuZC4AAAAAFmdldF9kaXNwdXRlX3ZvdGVfY291bnQAAAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAABAAAABA==",
        "AAAAAAAAAAAAAAAWZ2V0X3VzZXJfY2FuY2VsbGF0aW9ucwAAAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAABA==",
        "AAAAAAAAAAAAAAAWZ2V0X3doaXRlbGlzdGVkX3Rva2VucwAAAAAAAAAAAAEAAAPqAAAAEw==",
        "AAAAAAAAAAAAAAAWaXNfam9iX2NyZWF0aW9uX3BhdXNlZAAAAAAAAAAAAAEAAAAB",
        "AAAAAAAAAAAAAAAXZ2V0X2F1dGhvcml6ZWRfYXJiaXRlcnMAAAAAAAAAAAEAAAPqAAAAEw==",
        "AAAAAAAAAGJTYW1lIGFzIGBwYXVzZV9qb2JfY3JlYXRpb25gIC8gYHVucGF1c2Vfam9iX2NyZWF0aW9uYCBpbiBvbmUgY2FsbCAodGhlCmFkbWluIHBhZ2UgdXNlcyB0aGlzIGZvcm0pLgAAAAAAF3NldF9qb2JfY3JlYXRpb25fcGF1c2VkAAAAAAEAAAAAAAAABnBhdXNlZAAAAAAAAQAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAGJBcmJpdGVyIHZvdGU6IGBmcmVlbGFuY2VyX2Ftb3VudGAgb2YgdGhlIHVucGFpZCBiYWxhbmNlIHRvIHRoZQpmcmVlbGFuY2VyLCB0aGUgcmVzdCB0byB0aGUgY2xpZW50LgAAAAAAGGFyYml0ZXJfYXdhcmRfZnJlZWxhbmNlcgAAAAMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAAB2FyYml0ZXIAAAAAEwAAAAAAAAARZnJlZWxhbmNlcl9hbW91bnQAAAAAAAALAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAAAAAAAYcHJvcG9zZV9taWxlc3RvbmVfY2hhbmdlAAAABQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAAAAAAAD3Byb3Bvc2VkX2Ftb3VudAAAAAALAAAAAAAAABRwcm9wb3NlZF9kZXNjcmlwdGlvbgAAABAAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAABpgKHN1bV9vZl9yYXRpbmdzLCBjb3VudClgLgAAAAAAGWdldF9hdmVyYWdlX2NsaWVudF9yYXRpbmcAAAAAAAABAAAAAAAAAAZjbGllbnQAAAAAABMAAAABAAAD7QAAAAIAAAAEAAAABA==",
        "AAAAAAAAAAAAAAAZcmVqZWN0X21pbGVzdG9uZV9wcm9wb3NhbAAAAAAAAAMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAFBBY2NlcHRpbmcgYSBwcmljZSBjaGFuZ2UgbW92ZXMgdGhlIGRpZmZlcmVuY2UgKHBsdXMgZmVlIHNoYXJlKSBpbiB0aGUKc2FtZSBjYWxsLgAAABphcHByb3ZlX21pbGVzdG9uZV9wcm9wb3NhbAAAAAAAAwAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAAAAAAACWRlcG9zaXRvcgAAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAAAAAAAfZW1lcmdlbmN5X3JlZnVuZF9hZnRlcl9kZWFkbGluZQAAAAACAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAABQAAAAAAAAAAAAAAC0pvYlJlb3BlbmVkAAAAAAEAAAAMam9iX3Jlb3BlbmVkAAAAAgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAEAAAAAAAAAE3ByZXZpb3VzX2ZyZWVsYW5jZXIAAAAD6AAAABMAAAABAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAC1ZlcmlmaWVyU2V0AAAAAAEAAAAMdmVyaWZpZXJfc2V0AAAAAQAAAAAAAAAIdmVyaWZpZXIAAAATAAAAAQAAAAI=",
        "AAAABQAAAAAAAAAAAAAAC1dvcmtTdGFydGVkAAAAAAEAAAAMd29ya19zdGFydGVkAAAAAwAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAEAAAAAAAAACWRlcG9zaXRvcgAAAAAAABMAAAABAAAAAAAAAAtiZW5lZmljaWFyeQAAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADE93bmVyQ2hhbmdlZAAAAAEAAAANb3duZXJfY2hhbmdlZAAAAAAAAAIAAAAAAAAADnByZXZpb3VzX293bmVyAAAAAAATAAAAAQAAAAAAAAAJbmV3X293bmVyAAAAAAAAEwAAAAEAAAAC",
        "AAAABQAAAAAAAAAAAAAADFBhdXNlQ2hhbmdlZAAAAAEAAAANcGF1c2VfY2hhbmdlZAAAAAAAAAIAAAAdYGNvbnRyYWN0YCBvciBgam9iX2NyZWF0aW9uYC4AAAAAAAAFc2NvcGUAAAAAAAARAAAAAAAAAAAAAAAGcGF1c2VkAAAAAAABAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADUVzY3Jvd0NyZWF0ZWQAAAAAAAABAAAADmVzY3Jvd19jcmVhdGVkAAAAAAAJAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAEAAAAAAAAAC2JlbmVmaWNpYXJ5AAAAA+gAAAATAAAAAQAAAAAAAAAMdG90YWxfYW1vdW50AAAACwAAAAAAAAAAAAAADHBsYXRmb3JtX2ZlZQAAAAsAAAAAAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAAAAAAAAhkZWFkbGluZQAAAAQAAAAAAAAAAAAAAA9taWxlc3RvbmVfY291bnQAAAAABAAAAAAAAAAAAAAAC2lzX29wZW5fam9iAAAAAAEAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADUVzY3Jvd0RlbGV0ZWQAAAAAAAABAAAADmVzY3Jvd19kZWxldGVkAAAAAAABAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAAAI=",
        "AAAABQAAAAAAAAAAAAAADUZlZXNXaXRoZHJhd24AAAAAAAABAAAADmZlZXNfd2l0aGRyYXduAAAAAAADAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADUpvYk1hbmFnZXJTZXQAAAAAAAABAAAAD2pvYl9tYW5hZ2VyX3NldAAAAAACAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAAAAAAAAHbWFuYWdlcgAAAAATAAAAAQAAAAI=",
        "AAAABQAAAAAAAAAAAAAADkFyYml0ZXJSZXZva2VkAAAAAAABAAAAD2FyYml0ZXJfcmV2b2tlZAAAAAABAAAAAAAAAAdhcmJpdGVyAAAAABMAAAABAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADkVzY3Jvd1JlZnVuZGVkAAAAAAABAAAAD2VzY3Jvd19yZWZ1bmRlZAAAAAAFAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAEAAAAAAAAAC2JlbmVmaWNpYXJ5AAAAA+gAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAABlgZW1lcmdlbmN5YCBvciBgYXJiaXRlcmAuAAAAAAAABGtpbmQAAAARAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAD0Rpc3B1dGVSZXNvbHZlZAAAAAABAAAAEGRpc3B1dGVfcmVzb2x2ZWQAAAAIAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAABAAAAAAAAAAtiZW5lZmljaWFyeQAAAAATAAAAAQAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAAAAAAAAAAAEWZyZWVsYW5jZXJfYW1vdW50AAAAAAAACwAAAAAAAAAAAAAADWNsaWVudF9hbW91bnQAAAAAAAALAAAAAAAAAAAAAAALcmVzb2x2ZWRfYnkAAAAAEwAAAAAAAAAAAAAABnJlYXNvbgAAAAAAEAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAD0Rpc3B1dGVWb3RlQ2FzdAAAAAABAAAAEWRpc3B1dGVfdm90ZV9jYXN0AAAAAAAABwAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAEAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAQAAAAAAAAAHYXJiaXRlcgAAAAATAAAAAAAAAAAAAAARZnJlZWxhbmNlcl9hbW91bnQAAAAAAAALAAAAAAAAAAAAAAANY2xpZW50X2Ftb3VudAAAAAAAAAsAAAAAAAAAAAAAAAV2b3RlcwAAAAAAAAQAAAAAAAAAAAAAAAhyZXF1aXJlZAAAAAQAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAD0VzY3Jvd0NhbmNlbGxlZAAAAAABAAAAEGVzY3Jvd19jYW5jZWxsZWQAAAAFAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAAAAAAAALYmVuZWZpY2lhcnkAAAAD6AAAABMAAAABAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAAAAAAAAAAAGcmVmdW5kAAAAAAALAAAAAAAAAAAAAAAHcGVuYWx0eQAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAD0VzY3Jvd0NvbXBsZXRlZAAAAAABAAAAEGVzY3Jvd19jb21wbGV0ZWQAAAAFAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAAAAAAAALYmVuZWZpY2lhcnkAAAAAEwAAAAEAAAAAAAAACWRlcG9zaXRvcgAAAAAAABMAAAAAAAAAAAAAAAp0b3RhbF9wYWlkAAAAAAALAAAAAAAAAAAAAAAKZmVlX2Vhcm5lZAAAAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAD0pvYkZ1bmRzVXBkYXRlZAAAAAABAAAAEWpvYl9mdW5kc191cGRhdGVkAAAAAAAABQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAEAAAAAAAAAC2JlbmVmaWNpYXJ5AAAAA+gAAAATAAAAAQAAAAAAAAAJb2xkX3RvdGFsAAAAAAAACwAAAAAAAAAAAAAACW5ld190b3RhbAAAAAAAAAsAAAAAAAAAAAAAAA9taWxlc3RvbmVfY291bnQAAAAABAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAD092ZXJkdWVSZXNvbHZlZAAAAAABAAAAEG92ZXJkdWVfcmVzb2x2ZWQAAAAGAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAAAAAAAALYmVuZWZpY2lhcnkAAAAAEwAAAAEAAAAAAAAACWRlcG9zaXRvcgAAAAAAABMAAAAAAAAAAAAAABFmcmVlbGFuY2VyX2Ftb3VudAAAAAAAAAsAAAAAAAAAAAAAAA1jbGllbnRfYW1vdW50AAAAAAAACwAAAAAAAAAAAAAAC3Jlc29sdmVkX2J5AAAAABMAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAD1JhdGluZ1N1Ym1pdHRlZAAAAAABAAAAEHJhdGluZ19zdWJtaXR0ZWQAAAAEAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAAAAAAAAFcmF0ZWQAAAAAAAATAAAAAQAAAAAAAAAFcmF0ZXIAAAAAAAATAAAAAAAAAAAAAAAFc2NvcmUAAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEERlYWRsaW5lRXh0ZW5kZWQAAAABAAAAEWRlYWRsaW5lX2V4dGVuZGVkAAAAAAAABAAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAEAAAAAAAAAC2JlbmVmaWNpYXJ5AAAAA+gAAAATAAAAAQAAAAAAAAAMb2xkX2RlYWRsaW5lAAAABAAAAAAAAAAAAAAADG5ld19kZWFkbGluZQAAAAQAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAEFRva2VuTGlzdENoYW5nZWQAAAABAAAAEnRva2VuX2xpc3RfY2hhbmdlZAAAAAAAAgAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAADxgd2hpdGVsaXN0ZWRgLCBgZGVsaXN0ZWRgLCBgYmxhY2tsaXN0ZWRgIG9yIGB1bmJsYWNrbGlzdGVkYC4AAAAGY2hhbmdlAAAAAAARAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEUFyYml0ZXJBdXRob3JpemVkAAAAAAAAAQAAABJhcmJpdGVyX2F1dGhvcml6ZWQAAAAAAAEAAAAAAAAAB2FyYml0ZXIAAAAAEwAAAAEAAAAC",
        "AAAABQAAAAAAAAAAAAAAEUV2aWRlbmNlU3VibWl0dGVkAAAAAAAAAQAAABJldmlkZW5jZV9zdWJtaXR0ZWQAAAAAAAQAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAABAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAEAAAAAAAAACXN1Ym1pdHRlcgAAAAAAABMAAAAAAAAAAAAAAANjaWQAAAAAEAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAEUpvYk1hbmFnZXJSZXZva2VkAAAAAAAAAQAAABNqb2JfbWFuYWdlcl9yZXZva2VkAAAAAAIAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAABAAAAAAAAAAdtYW5hZ2VyAAAAABMAAAABAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAEU1pbGVzdG9uZUFwcHJvdmVkAAAAAAAAAQAAABJtaWxlc3RvbmVfYXBwcm92ZWQAAAAAAAUAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAABAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAEAAAAAAAAAC2JlbmVmaWNpYXJ5AAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAAthcHByb3ZlZF9ieQAAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEU1pbGVzdG9uZURpc3B1dGVkAAAAAAAAAQAAABJtaWxlc3RvbmVfZGlzcHV0ZWQAAAAAAAUAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAABAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAEAAAAAAAAADGNvdW50ZXJwYXJ0eQAAABMAAAABAAAAAAAAAAhkaXNwdXRlcgAAABMAAAAAAAAAAAAAAAZyZWFzb24AAAAAABAAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAEU1pbGVzdG9uZVJlamVjdGVkAAAAAAAAAQAAABJtaWxlc3RvbmVfcmVqZWN0ZWQAAAAAAAUAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAABAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAEAAAAAAAAAC2JlbmVmaWNpYXJ5AAAAABMAAAABAAAAAAAAAAZyZWFzb24AAAAAABAAAAAAAAAAAAAAAAtyZWplY3RlZF9ieQAAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEkFzc2lnbm1lbnREZWNsaW5lZAAAAAAAAQAAABNhc3NpZ25tZW50X2RlY2xpbmVkAAAAAAMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAABAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAQAAAAAAAAAKZnJlZWxhbmNlcgAAAAAAEwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAEkZyZWVsYW5jZXJBY2NlcHRlZAAAAAAAAQAAABNmcmVlbGFuY2VyX2FjY2VwdGVkAAAAAAMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAABAAAAAAAAAApmcmVlbGFuY2VyAAAAAAATAAAAAQAAAAAAAAALYWNjZXB0ZWRfYnkAAAAAEwAAAAAAAAAC",
        "AAAABQAAAD5Ub3BpY3M6IFtuYW1lLCB3YWxsZXRdIOKAlCB0aGUgcG9sbGVyIG5vdGlmaWVzIHRoZSBmcmVlbGFuY2VyLgAAAAAAAAAAABJGcmVlbGFuY2VyVmVyaWZpZWQAAAAAAAEAAAATZnJlZWxhbmNlcl92ZXJpZmllZAAAAAABAAAAAAAAAAZ3YWxsZXQAAAAAABMAAAABAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAEk1pbGVzdG9uZVN1Ym1pdHRlZAAAAAAAAQAAABNtaWxlc3RvbmVfc3VibWl0dGVkAAAAAAUAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAABAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAEAAAAAAAAACWRlcG9zaXRvcgAAAAAAABMAAAABAAAAAAAAAAtiZW5lZmljaWFyeQAAAAATAAAAAAAAAAAAAAALZGVzY3JpcHRpb24AAAAAEAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAElBsYXRmb3JtRmVlVXBkYXRlZAAAAAAAAQAAABRwbGF0Zm9ybV9mZWVfdXBkYXRlZAAAAAEAAAAAAAAABmZlZV9icAAAAAAABAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAE0ZlZUNvbGxlY3RvclVwZGF0ZWQAAAAAAQAAABVmZWVfY29sbGVjdG9yX3VwZGF0ZWQAAAAAAAABAAAAAAAAAA1mZWVfY29sbGVjdG9yAAAAAAAAEwAAAAEAAAAC",
        "AAAABQAAAAAAAAAAAAAAE1N0dWNrRnVuZHNXaXRoZHJhd24AAAAAAQAAABVzdHVja19mdW5kc193aXRoZHJhd24AAAAAAAADAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAE1ZlcmlmaWNhdGlvblJldm9rZWQAAAAAAQAAABR2ZXJpZmljYXRpb25fcmV2b2tlZAAAAAIAAAAAAAAABndhbGxldAAAAAAAEwAAAAEAAAAAAAAACnJldm9rZWRfYnkAAAAAABMAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAFEFwcGxpY2F0aW9uU3VibWl0dGVkAAAAAQAAABVhcHBsaWNhdGlvbl9zdWJtaXR0ZWQAAAAAAAAEAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAEAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAAAAAAAAAAAABFwcm9wb3NlZF90aW1lbGluZQAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAFE92ZXJkdWVEaXNwdXRlUmFpc2VkAAAAAQAAABZvdmVyZHVlX2Rpc3B1dGVfcmFpc2VkAAAAAAAEAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAAAAAAAAMY291bnRlcnBhcnR5AAAAEwAAAAEAAAAAAAAACXJlcXVlc3RlcgAAAAAAABMAAAAAAAAAAAAAAAZyZWFzb24AAAAAABAAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAGU1pbGVzdG9uZVByb3Bvc2FsQXBwcm92ZWQAAAAAAAABAAAAG21pbGVzdG9uZV9wcm9wb3NhbF9hcHByb3ZlZAAAAAAEAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAABAAAAAAAAAAtiZW5lZmljaWFyeQAAAAATAAAAAQAAAAAAAAAKbmV3X2Ftb3VudAAAAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAGU1pbGVzdG9uZVByb3Bvc2FsUmVqZWN0ZWQAAAAAAAABAAAAG21pbGVzdG9uZV9wcm9wb3NhbF9yZWplY3RlZAAAAAADAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAABAAAAAAAAAAtiZW5lZmljaWFyeQAAAAATAAAAAQAAAAI=",
        "AAAABQAAAAAAAAAAAAAAGk1pbGVzdG9uZVByb3Bvc2FsU3VibWl0dGVkAAAAAAABAAAAHG1pbGVzdG9uZV9wcm9wb3NhbF9zdWJtaXR0ZWQAAAAFAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAABAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAQAAAAAAAAAPcHJvcG9zZWRfYW1vdW50AAAAAAsAAAAAAAAAAAAAABRwcm9wb3NlZF9kZXNjcmlwdGlvbgAAABAAAAAAAAAAAg==",
      ]),
      options,
    );
  }
  public readonly fromJSON = {
    upgrade: this.txFromJSON<Result<void>>,
    version: this.txFromJSON<string>,
    get_badge: this.txFromJSON<Badge>,
    get_owner: this.txFromJSON<Result<string>>,
    set_owner: this.txFromJSON<Result<void>>,
    cancel_job: this.txFromJSON<Result<void>>,
    get_escrow: this.txFromJSON<Option<EscrowData>>,
    get_rating: this.txFromJSON<Option<Rating>>,
    initialize: this.txFromJSON<Result<void>>,
    reopen_job: this.txFromJSON<Result<void>>,
    start_work: this.txFromJSON<Result<void>>,
    has_applied: this.txFromJSON<boolean>,
    is_verified: this.txFromJSON<boolean>,
    apply_to_job: this.txFromJSON<Result<void>>,
    delist_token: this.txFromJSON<Result<void>>,
    get_evidence: this.txFromJSON<Array<EvidenceEntry>>,
    get_verifier: this.txFromJSON<Option<string>>,
    set_verifier: this.txFromJSON<Result<void>>,
    add_job_funds: this.txFromJSON<Result<void>>,
    add_milestone: this.txFromJSON<Result<void>>,
    create_escrow: this.txFromJSON<Result<u32>>,
    delete_escrow: this.txFromJSON<Result<void>>,
    get_milestone: this.txFromJSON<Option<Milestone>>,
    is_arbitrated: this.txFromJSON<boolean>,
    quote_deposit: this.txFromJSON<Result<readonly [i128, i128]>>,
    refund_escrow: this.txFromJSON<Result<void>>,
    submit_rating: this.txFromJSON<Result<void>>,
    withdraw_fees: this.txFromJSON<Result<void>>,
    get_milestones: this.txFromJSON<Array<Milestone>>,
    get_reputation: this.txFromJSON<u32>,
    is_job_manager: this.txFromJSON<boolean>,
    pause_contract: this.txFromJSON<Result<void>>,
    remove_arbiter: this.txFromJSON<Result<void>>,
    set_milestones: this.txFromJSON<Result<void>>,
    blacklist_token: this.txFromJSON<Result<void>>,
    extend_deadline: this.txFromJSON<Result<void>>,
    get_application: this.txFromJSON<Option<Application>>,
    get_job_manager: this.txFromJSON<Option<string>>,
    resolve_dispute: this.txFromJSON<Result<void>>,
    set_job_manager: this.txFromJSON<Result<void>>,
    submit_evidence: this.txFromJSON<Result<void>>,
    whitelist_token: this.txFromJSON<Result<void>>,
    get_applications: this.txFromJSON<Array<Application>>,
    get_native_token: this.txFromJSON<string>,
    get_user_escrows: this.txFromJSON<Array<u32>>,
    get_verification: this.txFromJSON<Option<FreelancerVerification>>,
    reject_milestone: this.txFromJSON<Result<void>>,
    remove_milestone: this.txFromJSON<Result<void>>,
    submit_milestone: this.txFromJSON<Result<void>>,
    unpause_contract: this.txFromJSON<Result<void>>,
    accept_freelancer: this.txFromJSON<Result<void>>,
    approve_milestone: this.txFromJSON<Result<void>>,
    authorize_arbiter: this.txFromJSON<Result<void>>,
    dispute_milestone: this.txFromJSON<Result<void>>,
    get_client_rating: this.txFromJSON<Option<ClientRatingData>>,
    get_fee_collector: this.txFromJSON<Result<string>>,
    get_total_escrows: this.txFromJSON<u32>,
    has_dispute_voted: this.txFromJSON<boolean>,
    set_fee_collector: this.txFromJSON<Result<void>>,
    unblacklist_token: this.txFromJSON<Result<void>>,
    decline_assignment: this.txFromJSON<Result<void>>,
    get_average_rating: this.txFromJSON<readonly [u32, u32]>,
    get_required_votes: this.txFromJSON<Result<u32>>,
    is_contract_paused: this.txFromJSON<boolean>,
    pause_job_creation: this.txFromJSON<Result<void>>,
    resubmit_milestone: this.txFromJSON<Result<void>>,
    revoke_job_manager: this.txFromJSON<Result<void>>,
    withdraw_job_funds: this.txFromJSON<Result<void>>,
    attest_verification: this.txFromJSON<Result<void>>,
    get_escrowed_amount: this.txFromJSON<i128>,
    get_overdue_request: this.txFromJSON<Option<OverdueRequest>>,
    get_platform_fee_bp: this.txFromJSON<u32>,
    revoke_verification: this.txFromJSON<Result<void>>,
    set_platform_fee_bp: this.txFromJSON<Result<void>>,
    get_resolution_votes: this.txFromJSON<Array<string>>,
    is_token_blacklisted: this.txFromJSON<boolean>,
    is_token_whitelisted: this.txFromJSON<boolean>,
    submit_client_rating: this.txFromJSON<Result<void>>,
    unpause_job_creation: this.txFromJSON<Result<void>>,
    withdraw_stuck_funds: this.txFromJSON<Result<void>>,
    get_application_count: this.txFromJSON<u32>,
    get_applications_page: this.txFromJSON<Array<Application>>,
    get_completed_escrows: this.txFromJSON<u32>,
    get_withdrawable_fees: this.txFromJSON<i128>,
    is_authorized_arbiter: this.txFromJSON<boolean>,
    raise_overdue_dispute: this.txFromJSON<Result<void>>,
    arbiter_approve_refund: this.txFromJSON<Result<void>>,
    get_blacklisted_tokens: this.txFromJSON<Array<string>>,
    get_dispute_vote_count: this.txFromJSON<u32>,
    get_user_cancellations: this.txFromJSON<u32>,
    get_whitelisted_tokens: this.txFromJSON<Array<string>>,
    is_job_creation_paused: this.txFromJSON<boolean>,
    get_authorized_arbiters: this.txFromJSON<Array<string>>,
    set_job_creation_paused: this.txFromJSON<Result<void>>,
    arbiter_award_freelancer: this.txFromJSON<Result<void>>,
    propose_milestone_change: this.txFromJSON<Result<void>>,
    get_average_client_rating: this.txFromJSON<readonly [u32, u32]>,
    reject_milestone_proposal: this.txFromJSON<Result<void>>,
    approve_milestone_proposal: this.txFromJSON<Result<void>>,
    emergency_refund_after_deadline: this.txFromJSON<Result<void>>,
  };
}
