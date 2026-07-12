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
  Timepoint,
  Duration,
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
    contractId: "CAPRZNXYATFSXZKLRM2TM3BCT63CX2FRPJMCQFFVM66ZHDH56LA5XZXI",
  }
} as const

export type Badge = {tag: "Beginner", values: void} | {tag: "Intermediate", values: void} | {tag: "Advanced", values: void} | {tag: "Expert", values: void};


export interface Rating {
  client: string;
  escrow_id: u32;
  freelancer: string;
  rated_at: u32;
  rating: u32;
  review: string;
}

export type DataKey = {tag: "Escrow", values: readonly [u32]} | {tag: "Milestone", values: readonly [u32, u32]} | {tag: "Application", values: readonly [u32, u32]} | {tag: "UserEscrows", values: readonly [string]} | {tag: "AuthorizedArbiter", values: readonly [string]} | {tag: "AuthorizedArbiters", values: void} | {tag: "WhitelistedToken", values: readonly [string]} | {tag: "WhitelistedTokens", values: void} | {tag: "EscrowedAmount", values: readonly [string]} | {tag: "TotalFeesByToken", values: readonly [string]} | {tag: "Reputation", values: readonly [string]} | {tag: "CompletedEscrows", values: readonly [string]} | {tag: "Rating", values: readonly [u32]} | {tag: "FreelancerRating", values: readonly [string]} | {tag: "AverageRating", values: readonly [string]} | {tag: "ClientRating", values: readonly [u32]} | {tag: "AverageClientRating", values: readonly [string]} | {tag: "NextEscrowId", values: void} | {tag: "PlatformFeeBP", values: void} | {tag: "FeeCollector", values: void} | {tag: "Owner", values: void} | {tag: "JobCreationPaused", values: void} | {tag: "ContractPaused", values: void} | {tag: "OverdueRequest", values: readonly [u32]} | {tag: "Evidence", values: readonly [u32, u32]} | {tag: "BlacklistedToken", values: readonly [string]} | {tag: "BlacklistedTokens", values: void} | {tag: "DisputeVote", values: readonly [u32, string]} | {tag: "DisputeVoteCount", values: readonly [u32]} | {tag: "UserCancellations", values: readonly [string]} | {tag: "LastCancellationLedger", values: readonly [string]};


export interface Milestone {
  amount: i128;
  approved_at: u32;
  description: string;
  dispute_reason: Option<string>;
  disputed_at: u32;
  disputed_by: Option<string>;
  proposed_amount: i128;
  proposed_description: Option<string>;
  rejection_reason: Option<string>;
  requirements: string;
  resolution_client_amount: i128;
  resolution_freelancer_amount: i128;
  resolution_reason: Option<string>;
  resolved_at: u32;
  resolved_by: Option<string>;
  status: MilestoneStatus;
  submitted_at: u32;
}


export interface EscrowData {
  arbiters: Array<string>;
  beneficiary: Option<string>;
  created_at: u32;
  deadline: u32;
  depositor: string;
  is_open_job: boolean;
  milestone_count: u32;
  paid_amount: i128;
  platform_fee: i128;
  project_description: string;
  project_title: string;
  required_confirmations: u32;
  status: EscrowStatus;
  token: Option<string>;
  total_amount: i128;
  work_started: boolean;
}


export interface Application {
  applied_at: u32;
  cover_letter: string;
  freelancer: string;
  proposed_timeline: u32;
}

export type EscrowStatus = {tag: "Pending", values: void} | {tag: "InProgress", values: void} | {tag: "Released", values: void} | {tag: "Refunded", values: void} | {tag: "Disputed", values: void} | {tag: "Expired", values: void} | {tag: "Cancelled", values: void};


/**
 * A single piece of evidence submitted by a party during a dispute.
 */
export interface EvidenceEntry {
  cid: string;
  submitted_at: u64;
  submitter: string;
}


/**
 * Stored when either party raises an overdue dispute, awaiting arbiter resolution.
 */
export interface OverdueRequest {
  reason: string;
  requested_at: u32;
  requester: string;
}

export type MilestoneStatus = {tag: "NotStarted", values: void} | {tag: "Submitted", values: void} | {tag: "Approved", values: void} | {tag: "Disputed", values: void} | {tag: "Resolved", values: void} | {tag: "Rejected", values: void} | {tag: "ProposalPending", values: void};


export interface ClientRatingData {
  client: string;
  escrow_id: u32;
  freelancer: string;
  rated_at: u32;
  rating: u32;
  review: string;
}

export interface Client {
  /**
   * Construct and simulate a get_badge transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get badge for a freelancer
   */
  get_badge: ({freelancer}: {freelancer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Badge>>

  /**
   * Construct and simulate a get_owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get the contract owner
   */
  get_owner: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a set_owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_owner: ({new_owner}: {new_owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_job transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Depositor cancels an open (unassigned) job and receives a tiered refund.
   */
  cancel_job: ({escrow_id, depositor}: {escrow_id: u32, depositor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_escrow: ({escrow_id}: {escrow_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<EscrowData>>>

  /**
   * Construct and simulate a get_rating transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get rating for an escrow
   */
  get_rating: ({escrow_id}: {escrow_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Rating>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initialize the contract
   */
  initialize: ({owner, fee_collector, platform_fee_bp, default_whitelisted_tokens}: {owner: string, fee_collector: string, platform_fee_bp: u32, default_whitelisted_tokens: Array<string>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a start_work transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Start work on an escrow
   */
  start_work: ({escrow_id, beneficiary}: {escrow_id: u32, beneficiary: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a has_applied transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Check if a freelancer has applied to a job
   */
  has_applied: ({escrow_id, freelancer}: {escrow_id: u32, freelancer: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a apply_to_job transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Apply to a job
   */
  apply_to_job: ({escrow_id, cover_letter, proposed_timeline, freelancer}: {escrow_id: u32, cover_letter: string, proposed_timeline: u32, freelancer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a delist_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner-only: remove a token from the whitelist so it can no longer be used for new escrows.
   */
  delist_token: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_evidence transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get all evidence entries for a specific escrow milestone.
   */
  get_evidence: ({escrow_id, milestone_index}: {escrow_id: u32, milestone_index: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<EvidenceEntry>>>

  /**
   * Construct and simulate a add_job_funds transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Add funds to a specific milestone on an open job (before freelancer assigned).
   */
  add_job_funds: ({escrow_id, depositor, additional_amount, milestone_index}: {escrow_id: u32, depositor: string, additional_amount: i128, milestone_index: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a add_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Add a new milestone to a Pending escrow (only before work starts).
   */
  add_milestone: ({escrow_id, amount, description, depositor}: {escrow_id: u32, amount: i128, description: string, depositor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create an escrow with token
   * Note: Milestone amounts and descriptions are combined into tuples to reduce parameter count
   */
  create_escrow: ({depositor, beneficiary, arbiters, required_confirmations, milestones, token, total_amount, duration, project_title, project_description}: {depositor: string, beneficiary: Option<string>, arbiters: Array<string>, required_confirmations: u32, milestones: Array<readonly [i128, string]>, token: Option<string>, total_amount: i128, duration: u32, project_title: string, project_description: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a delete_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner-only: permanently delete a terminal escrow with no remaining funds.
   */
  delete_escrow: ({escrow_id}: {escrow_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get a milestone by escrow_id and milestone_index
   */
  get_milestone: ({escrow_id, milestone_index}: {escrow_id: u32, milestone_index: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Milestone>>>

  /**
   * Construct and simulate a refund_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Refund an escrow
   */
  refund_escrow: ({escrow_id, depositor}: {escrow_id: u32, depositor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_rating transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Submit a rating for a completed escrow
   */
  submit_rating: ({escrow_id, rating, review, client}: {escrow_id: u32, rating: u32, review: string, client: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a withdraw_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Fee collector: withdraw all accumulated platform fees for a given token.
   */
  withdraw_fees: ({token, caller}: {token: Option<string>, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_milestones transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get all milestones for an escrow
   */
  get_milestones: ({escrow_id}: {escrow_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Milestone>>>

  /**
   * Construct and simulate a get_reputation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_reputation: ({user}: {user: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a pause_contract transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner-only: pause ALL contract write operations (emergency).
   */
  pause_contract: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a remove_arbiter transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner-only: revoke an arbiter's authorization (e.g. compromised or malicious wallet).
   */
  remove_arbiter: ({arbiter}: {arbiter: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a blacklist_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner-only: blacklist a token so it can no longer be used for new escrows.
   */
  blacklist_token: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a extend_deadline transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend deadline
   */
  extend_deadline: ({escrow_id, extra_seconds, depositor}: {escrow_id: u32, extra_seconds: u32, depositor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_application transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get an application by escrow_id and freelancer
   */
  get_application: ({escrow_id, freelancer}: {escrow_id: u32, freelancer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Application>>>

  /**
   * Construct and simulate a resolve_dispute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Authorized arbiter casts a vote to resolve a disputed milestone.
   * Executes when `required_confirmations` votes have been cast.
   */
  resolve_dispute: ({escrow_id, milestone_index, arbiter, freelancer_amount, client_amount, reason}: {escrow_id: u32, milestone_index: u32, arbiter: string, freelancer_amount: i128, client_amount: i128, reason: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_evidence transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Submit evidence for a disputed milestone (stored on-chain in Soroban).
   * `submitter` must be the depositor, beneficiary, or an arbiter for the escrow.
   * `cid` is the IPFS CID (optionally suffixed with `|description`).
   */
  submit_evidence: ({escrow_id, milestone_index, submitter, cid}: {escrow_id: u32, milestone_index: u32, submitter: string, cid: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a whitelist_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  whitelist_token: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_applications transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get all applications for an escrow
   */
  get_applications: ({escrow_id}: {escrow_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Application>>>

  /**
   * Construct and simulate a get_user_escrows transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_user_escrows: ({user}: {user: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<u32>>>

  /**
   * Construct and simulate a reject_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reject a milestone
   */
  reject_milestone: ({escrow_id, milestone_index, reason, depositor}: {escrow_id: u32, milestone_index: u32, reason: string, depositor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a remove_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove a milestone from a Pending escrow by index (only before work starts).
   */
  remove_milestone: ({escrow_id, milestone_index, depositor}: {escrow_id: u32, milestone_index: u32, depositor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Submit a milestone
   */
  submit_milestone: ({escrow_id, milestone_index, description, beneficiary}: {escrow_id: u32, milestone_index: u32, description: string, beneficiary: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a unpause_contract transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner-only: lift the emergency pause.
   */
  unpause_contract: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a accept_freelancer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Accept a freelancer for an open job
   */
  accept_freelancer: ({escrow_id, freelancer, depositor}: {escrow_id: u32, freelancer: string, depositor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a approve_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Approve a milestone
   */
  approve_milestone: ({escrow_id, milestone_index, depositor}: {escrow_id: u32, milestone_index: u32, depositor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a authorize_arbiter transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  authorize_arbiter: ({arbiter}: {arbiter: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a dispute_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Dispute a milestone
   */
  dispute_milestone: ({escrow_id, milestone_index, reason, disputer}: {escrow_id: u32, milestone_index: u32, reason: string, disputer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_client_rating transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get client rating for an escrow (set by freelancer)
   */
  get_client_rating: ({escrow_id}: {escrow_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<ClientRatingData>>>

  /**
   * Construct and simulate a get_fee_collector transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_fee_collector: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a get_total_escrows transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_total_escrows: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a has_dispute_voted transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Check whether a specific arbiter has already voted on an escrow's dispute.
   */
  has_dispute_voted: ({escrow_id, arbiter}: {escrow_id: u32, arbiter: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a set_fee_collector transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_fee_collector: ({fee_collector}: {fee_collector: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a unblacklist_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner-only: remove a token from the blacklist.
   */
  unblacklist_token: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_average_rating transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get average rating for a freelancer (returns (total_rating, count))
   */
  get_average_rating: ({freelancer}: {freelancer: string}, options?: MethodOptions) => Promise<AssembledTransaction<readonly [u32, u32]>>

  /**
   * Construct and simulate a is_contract_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns true when the contract is in emergency-paused state.
   */
  is_contract_paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a pause_job_creation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pause job creation
   */
  pause_job_creation: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a resubmit_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Resubmit a rejected milestone
   */
  resubmit_milestone: ({escrow_id, milestone_index, description, beneficiary}: {escrow_id: u32, milestone_index: u32, description: string, beneficiary: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a withdraw_job_funds transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Withdraw funds from a specific milestone on an open job (before freelancer assigned).
   */
  withdraw_job_funds: ({escrow_id, depositor, withdraw_amount, milestone_index}: {escrow_id: u32, depositor: string, withdraw_amount: i128, milestone_index: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_overdue_request transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * View: get the pending overdue request for an escrow, if any.
   */
  get_overdue_request: ({escrow_id}: {escrow_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<OverdueRequest>>>

  /**
   * Construct and simulate a get_platform_fee_bp transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_platform_fee_bp: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a set_platform_fee_bp transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_platform_fee_bp: ({fee_bp}: {fee_bp: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a is_token_blacklisted transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns true when the given token is blacklisted.
   */
  is_token_blacklisted: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a is_token_whitelisted transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_token_whitelisted: ({token}: {token: Option<string>}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a submit_client_rating transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Submit a rating for the client (called by freelancer after completion)
   */
  submit_client_rating: ({escrow_id, rating, review, freelancer}: {escrow_id: u32, rating: u32, review: string, freelancer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a unpause_job_creation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Unpause job creation
   */
  unpause_job_creation: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a withdraw_stuck_funds transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner-only: withdraw stuck funds (excess above escrowed amounts) for a given token contract.
   */
  withdraw_stuck_funds: ({token, to, amount}: {token: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_application_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the total number of applications for an escrow.
   */
  get_application_count: ({escrow_id}: {escrow_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_applications_page transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get a page of applications for an escrow (zero-based offset).
   */
  get_applications_page: ({escrow_id, offset, limit}: {escrow_id: u32, offset: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Application>>>

  /**
   * Construct and simulate a get_completed_escrows transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get completed escrows count for a user
   */
  get_completed_escrows: ({user}: {user: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_withdrawable_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the accumulated (unclaimed) platform fees for a given token.
   * Pass `None` for native XLM fees.
   */
  get_withdrawable_fees: ({token}: {token: Option<string>}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a is_authorized_arbiter transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_authorized_arbiter: ({arbiter}: {arbiter: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a raise_overdue_dispute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Raise an overdue dispute after the project deadline (callable by client OR freelancer).
   * Puts the escrow into Disputed state and queues it for arbiter review.
   */
  raise_overdue_dispute: ({escrow_id, requester, reason}: {escrow_id: u32, requester: string, reason: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a arbiter_approve_refund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Arbiter: approve refund — return all unreleased funds to the client.
   */
  arbiter_approve_refund: ({escrow_id, arbiter}: {escrow_id: u32, arbiter: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_blacklisted_tokens transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the list of all blacklisted tokens.
   */
  get_blacklisted_tokens: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a get_dispute_vote_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get the number of dispute votes cast for an escrow.
   */
  get_dispute_vote_count: ({escrow_id}: {escrow_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_user_cancellations transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get the user's lifetime cancellation count.
   */
  get_user_cancellations: ({user}: {user: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_whitelisted_tokens transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_whitelisted_tokens: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a is_job_creation_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Check if job creation is paused
   */
  is_job_creation_paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_authorized_arbiters transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_authorized_arbiters: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a arbiter_award_freelancer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Arbiter: award portion to the freelancer, return the rest to the client.
   */
  arbiter_award_freelancer: ({escrow_id, arbiter, freelancer_amount}: {escrow_id: u32, arbiter: string, freelancer_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a propose_milestone_change transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Freelancer proposes a change to a milestone's amount and/or description.
   */
  propose_milestone_change: ({escrow_id, milestone_index, proposed_amount, proposed_description, freelancer}: {escrow_id: u32, milestone_index: u32, proposed_amount: i128, proposed_description: string, freelancer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_average_client_rating transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get average rating for a client address → (total, count)
   */
  get_average_client_rating: ({client}: {client: string}, options?: MethodOptions) => Promise<AssembledTransaction<readonly [u32, u32]>>

  /**
   * Construct and simulate a reject_milestone_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Client rejects the freelancer's milestone change proposal.
   */
  reject_milestone_proposal: ({escrow_id, milestone_index, depositor}: {escrow_id: u32, milestone_index: u32, depositor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a approve_milestone_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Client approves the freelancer's milestone change proposal.
   */
  approve_milestone_proposal: ({escrow_id, milestone_index, depositor}: {escrow_id: u32, milestone_index: u32, depositor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a emergency_refund_after_deadline transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Emergency refund after deadline
   */
  emergency_refund_after_deadline: ({escrow_id, depositor}: {escrow_id: u32, depositor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAgAAAAAAAAAAAAAABUJhZGdlAAAAAAAABAAAAAAAAAAAAAAACEJlZ2lubmVyAAAAAAAAAAAAAAAMSW50ZXJtZWRpYXRlAAAAAAAAAAAAAAAIQWR2YW5jZWQAAAAAAAAAAAAAAAZFeHBlcnQAAA==",
        "AAAAAQAAAAAAAAAAAAAABlJhdGluZwAAAAAABgAAAAAAAAAGY2xpZW50AAAAAAATAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAApmcmVlbGFuY2VyAAAAAAATAAAAAAAAAAhyYXRlZF9hdAAAAAQAAAAAAAAABnJhdGluZwAAAAAABAAAAAAAAAAGcmV2aWV3AAAAAAAQ",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAHwAAAAEAAAAAAAAABkVzY3JvdwAAAAAAAQAAAAQAAAABAAAAAAAAAAlNaWxlc3RvbmUAAAAAAAACAAAABAAAAAQAAAABAAAAAAAAAAtBcHBsaWNhdGlvbgAAAAACAAAABAAAAAQAAAABAAAAAAAAAAtVc2VyRXNjcm93cwAAAAABAAAAEwAAAAEAAAAAAAAAEUF1dGhvcml6ZWRBcmJpdGVyAAAAAAAAAQAAABMAAAAAAAAAAAAAABJBdXRob3JpemVkQXJiaXRlcnMAAAAAAAEAAAAAAAAAEFdoaXRlbGlzdGVkVG9rZW4AAAABAAAAEwAAAAAAAAAAAAAAEVdoaXRlbGlzdGVkVG9rZW5zAAAAAAAAAQAAAAAAAAAORXNjcm93ZWRBbW91bnQAAAAAAAEAAAATAAAAAQAAAAAAAAAQVG90YWxGZWVzQnlUb2tlbgAAAAEAAAATAAAAAQAAAAAAAAAKUmVwdXRhdGlvbgAAAAAAAQAAABMAAAABAAAAAAAAABBDb21wbGV0ZWRFc2Nyb3dzAAAAAQAAABMAAAABAAAAAAAAAAZSYXRpbmcAAAAAAAEAAAAEAAAAAQAAAAAAAAAQRnJlZWxhbmNlclJhdGluZwAAAAEAAAATAAAAAQAAAAAAAAANQXZlcmFnZVJhdGluZwAAAAAAAAEAAAATAAAAAQAAAAAAAAAMQ2xpZW50UmF0aW5nAAAAAQAAAAQAAAABAAAAAAAAABNBdmVyYWdlQ2xpZW50UmF0aW5nAAAAAAEAAAATAAAAAAAAAAAAAAAMTmV4dEVzY3Jvd0lkAAAAAAAAAAAAAAANUGxhdGZvcm1GZWVCUAAAAAAAAAAAAAAAAAAADEZlZUNvbGxlY3RvcgAAAAAAAAAAAAAABU93bmVyAAAAAAAAAAAAAAAAAAARSm9iQ3JlYXRpb25QYXVzZWQAAAAAAAAAAAAAAAAAAA5Db250cmFjdFBhdXNlZAAAAAAAAQAAAAAAAAAOT3ZlcmR1ZVJlcXVlc3QAAAAAAAEAAAAEAAAAAQAAAAAAAAAIRXZpZGVuY2UAAAACAAAABAAAAAQAAAABAAAAAAAAABBCbGFja2xpc3RlZFRva2VuAAAAAQAAABMAAAAAAAAAAAAAABFCbGFja2xpc3RlZFRva2VucwAAAAAAAAEAAAAAAAAAC0Rpc3B1dGVWb3RlAAAAAAIAAAAEAAAAEwAAAAEAAAAAAAAAEERpc3B1dGVWb3RlQ291bnQAAAABAAAABAAAAAEAAAAAAAAAEVVzZXJDYW5jZWxsYXRpb25zAAAAAAAAAQAAABMAAAABAAAAAAAAABZMYXN0Q2FuY2VsbGF0aW9uTGVkZ2VyAAAAAAABAAAAEw==",
        "AAAAAQAAAAAAAAAAAAAACU1pbGVzdG9uZQAAAAAAABEAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAALYXBwcm92ZWRfYXQAAAAABAAAAAAAAAALZGVzY3JpcHRpb24AAAAAEAAAAAAAAAAOZGlzcHV0ZV9yZWFzb24AAAAAA+gAAAAQAAAAAAAAAAtkaXNwdXRlZF9hdAAAAAAEAAAAAAAAAAtkaXNwdXRlZF9ieQAAAAPoAAAAEwAAAAAAAAAPcHJvcG9zZWRfYW1vdW50AAAAAAsAAAAAAAAAFHByb3Bvc2VkX2Rlc2NyaXB0aW9uAAAD6AAAABAAAAAAAAAAEHJlamVjdGlvbl9yZWFzb24AAAPoAAAAEAAAAAAAAAAMcmVxdWlyZW1lbnRzAAAAEAAAAAAAAAAYcmVzb2x1dGlvbl9jbGllbnRfYW1vdW50AAAACwAAAAAAAAAccmVzb2x1dGlvbl9mcmVlbGFuY2VyX2Ftb3VudAAAAAsAAAAAAAAAEXJlc29sdXRpb25fcmVhc29uAAAAAAAD6AAAABAAAAAAAAAAC3Jlc29sdmVkX2F0AAAAAAQAAAAAAAAAC3Jlc29sdmVkX2J5AAAAA+gAAAATAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAPTWlsZXN0b25lU3RhdHVzAAAAAAAAAAAMc3VibWl0dGVkX2F0AAAABA==",
        "AAAAAQAAAAAAAAAAAAAACkVzY3Jvd0RhdGEAAAAAABAAAAAAAAAACGFyYml0ZXJzAAAD6gAAABMAAAAAAAAAC2JlbmVmaWNpYXJ5AAAAA+gAAAATAAAAAAAAAApjcmVhdGVkX2F0AAAAAAAEAAAAAAAAAAhkZWFkbGluZQAAAAQAAAAAAAAACWRlcG9zaXRvcgAAAAAAABMAAAAAAAAAC2lzX29wZW5fam9iAAAAAAEAAAAAAAAAD21pbGVzdG9uZV9jb3VudAAAAAAEAAAAAAAAAAtwYWlkX2Ftb3VudAAAAAALAAAAAAAAAAxwbGF0Zm9ybV9mZWUAAAALAAAAAAAAABNwcm9qZWN0X2Rlc2NyaXB0aW9uAAAAABAAAAAAAAAADXByb2plY3RfdGl0bGUAAAAAAAAQAAAAAAAAABZyZXF1aXJlZF9jb25maXJtYXRpb25zAAAAAAAEAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAMRXNjcm93U3RhdHVzAAAAAAAAAAV0b2tlbgAAAAAAA+gAAAATAAAAAAAAAAx0b3RhbF9hbW91bnQAAAALAAAAAAAAAAx3b3JrX3N0YXJ0ZWQAAAAB",
        "AAAAAQAAAAAAAAAAAAAAC0FwcGxpY2F0aW9uAAAAAAQAAAAAAAAACmFwcGxpZWRfYXQAAAAAAAQAAAAAAAAADGNvdmVyX2xldHRlcgAAABAAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAAAAAAAEXByb3Bvc2VkX3RpbWVsaW5lAAAAAAAABA==",
        "AAAAAgAAAAAAAAAAAAAADEVzY3Jvd1N0YXR1cwAAAAcAAAAAAAAAAAAAAAdQZW5kaW5nAAAAAAAAAAAAAAAACkluUHJvZ3Jlc3MAAAAAAAAAAAAAAAAACFJlbGVhc2VkAAAAAAAAAAAAAAAIUmVmdW5kZWQAAAAAAAAAAAAAAAhEaXNwdXRlZAAAAAAAAAAAAAAAB0V4cGlyZWQAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAA",
        "AAAAAQAAAEFBIHNpbmdsZSBwaWVjZSBvZiBldmlkZW5jZSBzdWJtaXR0ZWQgYnkgYSBwYXJ0eSBkdXJpbmcgYSBkaXNwdXRlLgAAAAAAAAAAAAANRXZpZGVuY2VFbnRyeQAAAAAAAAMAAAAAAAAAA2NpZAAAAAAQAAAAAAAAAAxzdWJtaXR0ZWRfYXQAAAAGAAAAAAAAAAlzdWJtaXR0ZXIAAAAAAAAT",
        "AAAAAQAAAFBTdG9yZWQgd2hlbiBlaXRoZXIgcGFydHkgcmFpc2VzIGFuIG92ZXJkdWUgZGlzcHV0ZSwgYXdhaXRpbmcgYXJiaXRlciByZXNvbHV0aW9uLgAAAAAAAAAOT3ZlcmR1ZVJlcXVlc3QAAAAAAAMAAAAAAAAABnJlYXNvbgAAAAAAEAAAAAAAAAAMcmVxdWVzdGVkX2F0AAAABAAAAAAAAAAJcmVxdWVzdGVyAAAAAAAAEw==",
        "AAAAAgAAAAAAAAAAAAAAD01pbGVzdG9uZVN0YXR1cwAAAAAHAAAAAAAAAAAAAAAKTm90U3RhcnRlZAAAAAAAAAAAAAAAAAAJU3VibWl0dGVkAAAAAAAAAAAAAAAAAAAIQXBwcm92ZWQAAAAAAAAAAAAAAAhEaXNwdXRlZAAAAAAAAAAAAAAACFJlc29sdmVkAAAAAAAAAAAAAAAIUmVqZWN0ZWQAAAAAAAAAAAAAAA9Qcm9wb3NhbFBlbmRpbmcA",
        "AAAAAQAAAAAAAAAAAAAAEENsaWVudFJhdGluZ0RhdGEAAAAGAAAAAAAAAAZjbGllbnQAAAAAABMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAAAAAAACHJhdGVkX2F0AAAABAAAAAAAAAAGcmF0aW5nAAAAAAAEAAAAAAAAAAZyZXZpZXcAAAAAABA=",
        "AAAAAAAAABpHZXQgYmFkZ2UgZm9yIGEgZnJlZWxhbmNlcgAAAAAACWdldF9iYWRnZQAAAAAAAAEAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAABAAAH0AAAAAVCYWRnZQAAAA==",
        "AAAAAAAAABZHZXQgdGhlIGNvbnRyYWN0IG93bmVyAAAAAAAJZ2V0X293bmVyAAAAAAAAAAAAAAEAAAPpAAAAEwAAAAM=",
        "AAAAAAAAAAAAAAAJc2V0X293bmVyAAAAAAAAAQAAAAAAAAAJbmV3X293bmVyAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAEhEZXBvc2l0b3IgY2FuY2VscyBhbiBvcGVuICh1bmFzc2lnbmVkKSBqb2IgYW5kIHJlY2VpdmVzIGEgdGllcmVkIHJlZnVuZC4AAAAKY2FuY2VsX2pvYgAAAAAAAgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAKZ2V0X2VzY3JvdwAAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAEAAAPoAAAH0AAAAApFc2Nyb3dEYXRhAAA=",
        "AAAAAAAAABhHZXQgcmF0aW5nIGZvciBhbiBlc2Nyb3cAAAAKZ2V0X3JhdGluZwAAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAEAAAPoAAAH0AAAAAZSYXRpbmcAAA==",
        "AAAAAAAAABdJbml0aWFsaXplIHRoZSBjb250cmFjdAAAAAAKaW5pdGlhbGl6ZQAAAAAABAAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAA1mZWVfY29sbGVjdG9yAAAAAAAAEwAAAAAAAAAPcGxhdGZvcm1fZmVlX2JwAAAAAAQAAAAAAAAAGmRlZmF1bHRfd2hpdGVsaXN0ZWRfdG9rZW5zAAAAAAPqAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAABdTdGFydCB3b3JrIG9uIGFuIGVzY3JvdwAAAAAKc3RhcnRfd29yawAAAAAAAgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAALYmVuZWZpY2lhcnkAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAACpDaGVjayBpZiBhIGZyZWVsYW5jZXIgaGFzIGFwcGxpZWQgdG8gYSBqb2IAAAAAAAtoYXNfYXBwbGllZAAAAAACAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAApmcmVlbGFuY2VyAAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAA5BcHBseSB0byBhIGpvYgAAAAAADGFwcGx5X3RvX2pvYgAAAAQAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAADGNvdmVyX2xldHRlcgAAABAAAAAAAAAAEXByb3Bvc2VkX3RpbWVsaW5lAAAAAAAABAAAAAAAAAAKZnJlZWxhbmNlcgAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAFpPd25lci1vbmx5OiByZW1vdmUgYSB0b2tlbiBmcm9tIHRoZSB3aGl0ZWxpc3Qgc28gaXQgY2FuIG5vIGxvbmdlciBiZSB1c2VkIGZvciBuZXcgZXNjcm93cy4AAAAAAAxkZWxpc3RfdG9rZW4AAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAADlHZXQgYWxsIGV2aWRlbmNlIGVudHJpZXMgZm9yIGEgc3BlY2lmaWMgZXNjcm93IG1pbGVzdG9uZS4AAAAAAAAMZ2V0X2V2aWRlbmNlAAAAAgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAABAAAD6gAAB9AAAAANRXZpZGVuY2VFbnRyeQAAAA==",
        "AAAAAAAAAE5BZGQgZnVuZHMgdG8gYSBzcGVjaWZpYyBtaWxlc3RvbmUgb24gYW4gb3BlbiBqb2IgKGJlZm9yZSBmcmVlbGFuY2VyIGFzc2lnbmVkKS4AAAAAAA1hZGRfam9iX2Z1bmRzAAAAAAAABAAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAAAAAARYWRkaXRpb25hbF9hbW91bnQAAAAAAAALAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAEJBZGQgYSBuZXcgbWlsZXN0b25lIHRvIGEgUGVuZGluZyBlc2Nyb3cgKG9ubHkgYmVmb3JlIHdvcmsgc3RhcnRzKS4AAAAAAA1hZGRfbWlsZXN0b25lAAAAAAAABAAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAHdDcmVhdGUgYW4gZXNjcm93IHdpdGggdG9rZW4KTm90ZTogTWlsZXN0b25lIGFtb3VudHMgYW5kIGRlc2NyaXB0aW9ucyBhcmUgY29tYmluZWQgaW50byB0dXBsZXMgdG8gcmVkdWNlIHBhcmFtZXRlciBjb3VudAAAAAANY3JlYXRlX2VzY3JvdwAAAAAAAAoAAAAAAAAACWRlcG9zaXRvcgAAAAAAABMAAAAAAAAAC2JlbmVmaWNpYXJ5AAAAA+gAAAATAAAAAAAAAAhhcmJpdGVycwAAA+oAAAATAAAAAAAAABZyZXF1aXJlZF9jb25maXJtYXRpb25zAAAAAAAEAAAAAAAAAAptaWxlc3RvbmVzAAAAAAPqAAAD7QAAAAIAAAALAAAAEAAAAAAAAAAFdG9rZW4AAAAAAAPoAAAAEwAAAAAAAAAMdG90YWxfYW1vdW50AAAACwAAAAAAAAAIZHVyYXRpb24AAAAEAAAAAAAAAA1wcm9qZWN0X3RpdGxlAAAAAAAAEAAAAAAAAAATcHJvamVjdF9kZXNjcmlwdGlvbgAAAAAQAAAAAQAAA+kAAAAEAAAAAw==",
        "AAAAAAAAAElPd25lci1vbmx5OiBwZXJtYW5lbnRseSBkZWxldGUgYSB0ZXJtaW5hbCBlc2Nyb3cgd2l0aCBubyByZW1haW5pbmcgZnVuZHMuAAAAAAAADWRlbGV0ZV9lc2Nyb3cAAAAAAAABAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAADBHZXQgYSBtaWxlc3RvbmUgYnkgZXNjcm93X2lkIGFuZCBtaWxlc3RvbmVfaW5kZXgAAAANZ2V0X21pbGVzdG9uZQAAAAAAAAIAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAQAAA+gAAAfQAAAACU1pbGVzdG9uZQAAAA==",
        "AAAAAAAAABBSZWZ1bmQgYW4gZXNjcm93AAAADXJlZnVuZF9lc2Nyb3cAAAAAAAACAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAACZTdWJtaXQgYSByYXRpbmcgZm9yIGEgY29tcGxldGVkIGVzY3JvdwAAAAAADXN1Ym1pdF9yYXRpbmcAAAAAAAAEAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAAZyYXRpbmcAAAAAAAQAAAAAAAAABnJldmlldwAAAAAAEAAAAAAAAAAGY2xpZW50AAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAEhGZWUgY29sbGVjdG9yOiB3aXRoZHJhdyBhbGwgYWNjdW11bGF0ZWQgcGxhdGZvcm0gZmVlcyBmb3IgYSBnaXZlbiB0b2tlbi4AAAANd2l0aGRyYXdfZmVlcwAAAAAAAAIAAAAAAAAABXRva2VuAAAAAAAD6AAAABMAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAACBHZXQgYWxsIG1pbGVzdG9uZXMgZm9yIGFuIGVzY3JvdwAAAA5nZXRfbWlsZXN0b25lcwAAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAEAAAPqAAAH0AAAAAlNaWxlc3RvbmUAAAA=",
        "AAAAAAAAAAAAAAAOZ2V0X3JlcHV0YXRpb24AAAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAAAQ=",
        "AAAAAAAAADxPd25lci1vbmx5OiBwYXVzZSBBTEwgY29udHJhY3Qgd3JpdGUgb3BlcmF0aW9ucyAoZW1lcmdlbmN5KS4AAAAOcGF1c2VfY29udHJhY3QAAAAAAAAAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAFVPd25lci1vbmx5OiByZXZva2UgYW4gYXJiaXRlcidzIGF1dGhvcml6YXRpb24gKGUuZy4gY29tcHJvbWlzZWQgb3IgbWFsaWNpb3VzIHdhbGxldCkuAAAAAAAADnJlbW92ZV9hcmJpdGVyAAAAAAABAAAAAAAAAAdhcmJpdGVyAAAAABMAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAEpPd25lci1vbmx5OiBibGFja2xpc3QgYSB0b2tlbiBzbyBpdCBjYW4gbm8gbG9uZ2VyIGJlIHVzZWQgZm9yIG5ldyBlc2Nyb3dzLgAAAAAAD2JsYWNrbGlzdF90b2tlbgAAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAA9FeHRlbmQgZGVhZGxpbmUAAAAAD2V4dGVuZF9kZWFkbGluZQAAAAADAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAA1leHRyYV9zZWNvbmRzAAAAAAAABAAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAC5HZXQgYW4gYXBwbGljYXRpb24gYnkgZXNjcm93X2lkIGFuZCBmcmVlbGFuY2VyAAAAAAAPZ2V0X2FwcGxpY2F0aW9uAAAAAAIAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAABAAAD6AAAB9AAAAALQXBwbGljYXRpb24A",
        "AAAAAAAAAH1BdXRob3JpemVkIGFyYml0ZXIgY2FzdHMgYSB2b3RlIHRvIHJlc29sdmUgYSBkaXNwdXRlZCBtaWxlc3RvbmUuCkV4ZWN1dGVzIHdoZW4gYHJlcXVpcmVkX2NvbmZpcm1hdGlvbnNgIHZvdGVzIGhhdmUgYmVlbiBjYXN0LgAAAAAAAA9yZXNvbHZlX2Rpc3B1dGUAAAAABgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAAAAAAAB2FyYml0ZXIAAAAAEwAAAAAAAAARZnJlZWxhbmNlcl9hbW91bnQAAAAAAAALAAAAAAAAAA1jbGllbnRfYW1vdW50AAAAAAAACwAAAAAAAAAGcmVhc29uAAAAAAAQAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAANVTdWJtaXQgZXZpZGVuY2UgZm9yIGEgZGlzcHV0ZWQgbWlsZXN0b25lIChzdG9yZWQgb24tY2hhaW4gaW4gU29yb2JhbikuCmBzdWJtaXR0ZXJgIG11c3QgYmUgdGhlIGRlcG9zaXRvciwgYmVuZWZpY2lhcnksIG9yIGFuIGFyYml0ZXIgZm9yIHRoZSBlc2Nyb3cuCmBjaWRgIGlzIHRoZSBJUEZTIENJRCAob3B0aW9uYWxseSBzdWZmaXhlZCB3aXRoIGB8ZGVzY3JpcHRpb25gKS4AAAAAAAAPc3VibWl0X2V2aWRlbmNlAAAAAAQAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAAAAAAlzdWJtaXR0ZXIAAAAAAAATAAAAAAAAAANjaWQAAAAAEAAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAPd2hpdGVsaXN0X3Rva2VuAAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAACJHZXQgYWxsIGFwcGxpY2F0aW9ucyBmb3IgYW4gZXNjcm93AAAAAAAQZ2V0X2FwcGxpY2F0aW9ucwAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAABAAAD6gAAB9AAAAALQXBwbGljYXRpb24A",
        "AAAAAAAAAAAAAAAQZ2V0X3VzZXJfZXNjcm93cwAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAA+oAAAAE",
        "AAAAAAAAABJSZWplY3QgYSBtaWxlc3RvbmUAAAAAABByZWplY3RfbWlsZXN0b25lAAAABAAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAAAAAAABnJlYXNvbgAAAAAAEAAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAExSZW1vdmUgYSBtaWxlc3RvbmUgZnJvbSBhIFBlbmRpbmcgZXNjcm93IGJ5IGluZGV4IChvbmx5IGJlZm9yZSB3b3JrIHN0YXJ0cykuAAAAEHJlbW92ZV9taWxlc3RvbmUAAAADAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAABJTdWJtaXQgYSBtaWxlc3RvbmUAAAAAABBzdWJtaXRfbWlsZXN0b25lAAAABAAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAAAAAAAC2Rlc2NyaXB0aW9uAAAAABAAAAAAAAAAC2JlbmVmaWNpYXJ5AAAAABMAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAACVPd25lci1vbmx5OiBsaWZ0IHRoZSBlbWVyZ2VuY3kgcGF1c2UuAAAAAAAAEHVucGF1c2VfY29udHJhY3QAAAAAAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAACNBY2NlcHQgYSBmcmVlbGFuY2VyIGZvciBhbiBvcGVuIGpvYgAAAAARYWNjZXB0X2ZyZWVsYW5jZXIAAAAAAAADAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAApmcmVlbGFuY2VyAAAAAAATAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAABNBcHByb3ZlIGEgbWlsZXN0b25lAAAAABFhcHByb3ZlX21pbGVzdG9uZQAAAAAAAAMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAAAAAAARYXV0aG9yaXplX2FyYml0ZXIAAAAAAAABAAAAAAAAAAdhcmJpdGVyAAAAABMAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAABNEaXNwdXRlIGEgbWlsZXN0b25lAAAAABFkaXNwdXRlX21pbGVzdG9uZQAAAAAAAAQAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAAAAAAZyZWFzb24AAAAAABAAAAAAAAAACGRpc3B1dGVyAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAADNHZXQgY2xpZW50IHJhdGluZyBmb3IgYW4gZXNjcm93IChzZXQgYnkgZnJlZWxhbmNlcikAAAAAEWdldF9jbGllbnRfcmF0aW5nAAAAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAEAAAPoAAAH0AAAABBDbGllbnRSYXRpbmdEYXRh",
        "AAAAAAAAAAAAAAARZ2V0X2ZlZV9jb2xsZWN0b3IAAAAAAAAAAAAAAQAAA+kAAAATAAAAAw==",
        "AAAAAAAAAAAAAAARZ2V0X3RvdGFsX2VzY3Jvd3MAAAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAEpDaGVjayB3aGV0aGVyIGEgc3BlY2lmaWMgYXJiaXRlciBoYXMgYWxyZWFkeSB2b3RlZCBvbiBhbiBlc2Nyb3cncyBkaXNwdXRlLgAAAAAAEWhhc19kaXNwdXRlX3ZvdGVkAAAAAAAAAgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAHYXJiaXRlcgAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAARc2V0X2ZlZV9jb2xsZWN0b3IAAAAAAAABAAAAAAAAAA1mZWVfY29sbGVjdG9yAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAC5Pd25lci1vbmx5OiByZW1vdmUgYSB0b2tlbiBmcm9tIHRoZSBibGFja2xpc3QuAAAAAAARdW5ibGFja2xpc3RfdG9rZW4AAAAAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAENHZXQgYXZlcmFnZSByYXRpbmcgZm9yIGEgZnJlZWxhbmNlciAocmV0dXJucyAodG90YWxfcmF0aW5nLCBjb3VudCkpAAAAABJnZXRfYXZlcmFnZV9yYXRpbmcAAAAAAAEAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAABAAAD7QAAAAIAAAAEAAAABA==",
        "AAAAAAAAADxSZXR1cm5zIHRydWUgd2hlbiB0aGUgY29udHJhY3QgaXMgaW4gZW1lcmdlbmN5LXBhdXNlZCBzdGF0ZS4AAAASaXNfY29udHJhY3RfcGF1c2VkAAAAAAAAAAAAAQAAAAE=",
        "AAAAAAAAABJQYXVzZSBqb2IgY3JlYXRpb24AAAAAABJwYXVzZV9qb2JfY3JlYXRpb24AAAAAAAAAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAB1SZXN1Ym1pdCBhIHJlamVjdGVkIG1pbGVzdG9uZQAAAAAAABJyZXN1Ym1pdF9taWxlc3RvbmUAAAAAAAQAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAAAtiZW5lZmljaWFyeQAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAFVXaXRoZHJhdyBmdW5kcyBmcm9tIGEgc3BlY2lmaWMgbWlsZXN0b25lIG9uIGFuIG9wZW4gam9iIChiZWZvcmUgZnJlZWxhbmNlciBhc3NpZ25lZCkuAAAAAAAAEndpdGhkcmF3X2pvYl9mdW5kcwAAAAAABAAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAJZGVwb3NpdG9yAAAAAAAAEwAAAAAAAAAPd2l0aGRyYXdfYW1vdW50AAAAAAsAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAADxWaWV3OiBnZXQgdGhlIHBlbmRpbmcgb3ZlcmR1ZSByZXF1ZXN0IGZvciBhbiBlc2Nyb3csIGlmIGFueS4AAAATZ2V0X292ZXJkdWVfcmVxdWVzdAAAAAABAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAA+gAAAfQAAAADk92ZXJkdWVSZXF1ZXN0AAA=",
        "AAAAAAAAAAAAAAATZ2V0X3BsYXRmb3JtX2ZlZV9icAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAATc2V0X3BsYXRmb3JtX2ZlZV9icAAAAAABAAAAAAAAAAZmZWVfYnAAAAAAAAQAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAADFSZXR1cm5zIHRydWUgd2hlbiB0aGUgZ2l2ZW4gdG9rZW4gaXMgYmxhY2tsaXN0ZWQuAAAAAAAAFGlzX3Rva2VuX2JsYWNrbGlzdGVkAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAUaXNfdG9rZW5fd2hpdGVsaXN0ZWQAAAABAAAAAAAAAAV0b2tlbgAAAAAAA+gAAAATAAAAAQAAAAE=",
        "AAAAAAAAAEZTdWJtaXQgYSByYXRpbmcgZm9yIHRoZSBjbGllbnQgKGNhbGxlZCBieSBmcmVlbGFuY2VyIGFmdGVyIGNvbXBsZXRpb24pAAAAAAAUc3VibWl0X2NsaWVudF9yYXRpbmcAAAAEAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAAAAAAZyYXRpbmcAAAAAAAQAAAAAAAAABnJldmlldwAAAAAAEAAAAAAAAAAKZnJlZWxhbmNlcgAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAABRVbnBhdXNlIGpvYiBjcmVhdGlvbgAAABR1bnBhdXNlX2pvYl9jcmVhdGlvbgAAAAAAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAFxPd25lci1vbmx5OiB3aXRoZHJhdyBzdHVjayBmdW5kcyAoZXhjZXNzIGFib3ZlIGVzY3Jvd2VkIGFtb3VudHMpIGZvciBhIGdpdmVuIHRva2VuIGNvbnRyYWN0LgAAABR3aXRoZHJhd19zdHVja19mdW5kcwAAAAMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAADZSZXR1cm4gdGhlIHRvdGFsIG51bWJlciBvZiBhcHBsaWNhdGlvbnMgZm9yIGFuIGVzY3Jvdy4AAAAAABVnZXRfYXBwbGljYXRpb25fY291bnQAAAAAAAABAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAEAAAAAQAAAAQ=",
        "AAAAAAAAAD1HZXQgYSBwYWdlIG9mIGFwcGxpY2F0aW9ucyBmb3IgYW4gZXNjcm93ICh6ZXJvLWJhc2VkIG9mZnNldCkuAAAAAAAAFWdldF9hcHBsaWNhdGlvbnNfcGFnZQAAAAAAAAMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAABm9mZnNldAAAAAAABAAAAAAAAAAFbGltaXQAAAAAAAAEAAAAAQAAA+oAAAfQAAAAC0FwcGxpY2F0aW9uAA==",
        "AAAAAAAAACZHZXQgY29tcGxldGVkIGVzY3Jvd3MgY291bnQgZm9yIGEgdXNlcgAAAAAAFWdldF9jb21wbGV0ZWRfZXNjcm93cwAAAAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAAAQ=",
        "AAAAAAAAAGRSZXR1cm4gdGhlIGFjY3VtdWxhdGVkICh1bmNsYWltZWQpIHBsYXRmb3JtIGZlZXMgZm9yIGEgZ2l2ZW4gdG9rZW4uClBhc3MgYE5vbmVgIGZvciBuYXRpdmUgWExNIGZlZXMuAAAAFWdldF93aXRoZHJhd2FibGVfZmVlcwAAAAAAAAEAAAAAAAAABXRva2VuAAAAAAAD6AAAABMAAAABAAAACw==",
        "AAAAAAAAAAAAAAAVaXNfYXV0aG9yaXplZF9hcmJpdGVyAAAAAAAAAQAAAAAAAAAHYXJiaXRlcgAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAJ1SYWlzZSBhbiBvdmVyZHVlIGRpc3B1dGUgYWZ0ZXIgdGhlIHByb2plY3QgZGVhZGxpbmUgKGNhbGxhYmxlIGJ5IGNsaWVudCBPUiBmcmVlbGFuY2VyKS4KUHV0cyB0aGUgZXNjcm93IGludG8gRGlzcHV0ZWQgc3RhdGUgYW5kIHF1ZXVlcyBpdCBmb3IgYXJiaXRlciByZXZpZXcuAAAAAAAAFXJhaXNlX292ZXJkdWVfZGlzcHV0ZQAAAAAAAAMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAACXJlcXVlc3RlcgAAAAAAABMAAAAAAAAABnJlYXNvbgAAAAAAEAAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAEZBcmJpdGVyOiBhcHByb3ZlIHJlZnVuZCDigJQgcmV0dXJuIGFsbCB1bnJlbGVhc2VkIGZ1bmRzIHRvIHRoZSBjbGllbnQuAAAAAAAWYXJiaXRlcl9hcHByb3ZlX3JlZnVuZAAAAAAAAgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAHYXJiaXRlcgAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAACpSZXR1cm4gdGhlIGxpc3Qgb2YgYWxsIGJsYWNrbGlzdGVkIHRva2Vucy4AAAAAABZnZXRfYmxhY2tsaXN0ZWRfdG9rZW5zAAAAAAAAAAAAAQAAA+oAAAAT",
        "AAAAAAAAADNHZXQgdGhlIG51bWJlciBvZiBkaXNwdXRlIHZvdGVzIGNhc3QgZm9yIGFuIGVzY3Jvdy4AAAAAFmdldF9kaXNwdXRlX3ZvdGVfY291bnQAAAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAABAAAABA==",
        "AAAAAAAAACtHZXQgdGhlIHVzZXIncyBsaWZldGltZSBjYW5jZWxsYXRpb24gY291bnQuAAAAABZnZXRfdXNlcl9jYW5jZWxsYXRpb25zAAAAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAE",
        "AAAAAAAAAAAAAAAWZ2V0X3doaXRlbGlzdGVkX3Rva2VucwAAAAAAAAAAAAEAAAPqAAAAEw==",
        "AAAAAAAAAB9DaGVjayBpZiBqb2IgY3JlYXRpb24gaXMgcGF1c2VkAAAAABZpc19qb2JfY3JlYXRpb25fcGF1c2VkAAAAAAAAAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAXZ2V0X2F1dGhvcml6ZWRfYXJiaXRlcnMAAAAAAAAAAAEAAAPqAAAAEw==",
        "AAAAAAAAAEhBcmJpdGVyOiBhd2FyZCBwb3J0aW9uIHRvIHRoZSBmcmVlbGFuY2VyLCByZXR1cm4gdGhlIHJlc3QgdG8gdGhlIGNsaWVudC4AAAAYYXJiaXRlcl9hd2FyZF9mcmVlbGFuY2VyAAAAAwAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAHYXJiaXRlcgAAAAATAAAAAAAAABFmcmVlbGFuY2VyX2Ftb3VudAAAAAAAAAsAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAEhGcmVlbGFuY2VyIHByb3Bvc2VzIGEgY2hhbmdlIHRvIGEgbWlsZXN0b25lJ3MgYW1vdW50IGFuZC9vciBkZXNjcmlwdGlvbi4AAAAYcHJvcG9zZV9taWxlc3RvbmVfY2hhbmdlAAAABQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABAAAAAAAAAAPbWlsZXN0b25lX2luZGV4AAAAAAQAAAAAAAAAD3Byb3Bvc2VkX2Ftb3VudAAAAAALAAAAAAAAABRwcm9wb3NlZF9kZXNjcmlwdGlvbgAAABAAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAADpHZXQgYXZlcmFnZSByYXRpbmcgZm9yIGEgY2xpZW50IGFkZHJlc3Mg4oaSICh0b3RhbCwgY291bnQpAAAAAAAZZ2V0X2F2ZXJhZ2VfY2xpZW50X3JhdGluZwAAAAAAAAEAAAAAAAAABmNsaWVudAAAAAAAEwAAAAEAAAPtAAAAAgAAAAQAAAAE",
        "AAAAAAAAADpDbGllbnQgcmVqZWN0cyB0aGUgZnJlZWxhbmNlcidzIG1pbGVzdG9uZSBjaGFuZ2UgcHJvcG9zYWwuAAAAAAAZcmVqZWN0X21pbGVzdG9uZV9wcm9wb3NhbAAAAAAAAAMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAADtDbGllbnQgYXBwcm92ZXMgdGhlIGZyZWVsYW5jZXIncyBtaWxlc3RvbmUgY2hhbmdlIHByb3Bvc2FsLgAAAAAaYXBwcm92ZV9taWxlc3RvbmVfcHJvcG9zYWwAAAAAAAMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAAAAAAlkZXBvc2l0b3IAAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAB9FbWVyZ2VuY3kgcmVmdW5kIGFmdGVyIGRlYWRsaW5lAAAAAB9lbWVyZ2VuY3lfcmVmdW5kX2FmdGVyX2RlYWRsaW5lAAAAAAIAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAQAAAAAAAAACWRlcG9zaXRvcgAAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAAAw==" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_badge: this.txFromJSON<Badge>,
        get_owner: this.txFromJSON<Result<string>>,
        set_owner: this.txFromJSON<Result<void>>,
        cancel_job: this.txFromJSON<Result<void>>,
        get_escrow: this.txFromJSON<Option<EscrowData>>,
        get_rating: this.txFromJSON<Option<Rating>>,
        initialize: this.txFromJSON<Result<void>>,
        start_work: this.txFromJSON<Result<void>>,
        has_applied: this.txFromJSON<boolean>,
        apply_to_job: this.txFromJSON<Result<void>>,
        delist_token: this.txFromJSON<Result<void>>,
        get_evidence: this.txFromJSON<Array<EvidenceEntry>>,
        add_job_funds: this.txFromJSON<Result<void>>,
        add_milestone: this.txFromJSON<Result<void>>,
        create_escrow: this.txFromJSON<Result<u32>>,
        delete_escrow: this.txFromJSON<Result<void>>,
        get_milestone: this.txFromJSON<Option<Milestone>>,
        refund_escrow: this.txFromJSON<Result<void>>,
        submit_rating: this.txFromJSON<Result<void>>,
        withdraw_fees: this.txFromJSON<Result<void>>,
        get_milestones: this.txFromJSON<Array<Milestone>>,
        get_reputation: this.txFromJSON<u32>,
        pause_contract: this.txFromJSON<Result<void>>,
        remove_arbiter: this.txFromJSON<Result<void>>,
        blacklist_token: this.txFromJSON<Result<void>>,
        extend_deadline: this.txFromJSON<Result<void>>,
        get_application: this.txFromJSON<Option<Application>>,
        resolve_dispute: this.txFromJSON<Result<void>>,
        submit_evidence: this.txFromJSON<Result<void>>,
        whitelist_token: this.txFromJSON<Result<void>>,
        get_applications: this.txFromJSON<Array<Application>>,
        get_user_escrows: this.txFromJSON<Array<u32>>,
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
        get_average_rating: this.txFromJSON<readonly [u32, u32]>,
        is_contract_paused: this.txFromJSON<boolean>,
        pause_job_creation: this.txFromJSON<Result<void>>,
        resubmit_milestone: this.txFromJSON<Result<void>>,
        withdraw_job_funds: this.txFromJSON<Result<void>>,
        get_overdue_request: this.txFromJSON<Option<OverdueRequest>>,
        get_platform_fee_bp: this.txFromJSON<u32>,
        set_platform_fee_bp: this.txFromJSON<Result<void>>,
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
        arbiter_award_freelancer: this.txFromJSON<Result<void>>,
        propose_milestone_change: this.txFromJSON<Result<void>>,
        get_average_client_rating: this.txFromJSON<readonly [u32, u32]>,
        reject_milestone_proposal: this.txFromJSON<Result<void>>,
        approve_milestone_proposal: this.txFromJSON<Result<void>>,
        emergency_refund_after_deadline: this.txFromJSON<Result<void>>
  }
}