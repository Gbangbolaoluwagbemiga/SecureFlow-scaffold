//! Contract events.
//!
//! The frontend's event poller (`src/components/event-poller.tsx`) turns these
//! into notifications, and it reads them by a fixed topic convention:
//!
//!   topics[0]  event name, `snake_case` (`milestone_submitted`)
//!   topics[1]  escrow id
//!   topics[2]  milestone index, for milestone events
//!   last       the address that should be NOTIFIED — the counterparty of
//!              whoever acted, never the actor themselves
//!
//! Before these existed the contract emitted nothing at all, so the poller
//! never had anything to notify about and every on-chain notification was
//! silently missing.
//!
//! Events that concern both parties carry the second one in the data map; the
//! poller checks there too.

use soroban_sdk::{contractevent, Address, String, Symbol};

// ─── Escrow lifecycle ────────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct EscrowCreated {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub depositor: Address,
    #[topic]
    pub beneficiary: Option<Address>,
    pub total_amount: i128,
    pub platform_fee: i128,
    pub token: Address,
    pub deadline: u32,
    pub milestone_count: u32,
    pub is_open_job: bool,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct WorkStarted {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub depositor: Address,
    pub beneficiary: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct EscrowCompleted {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub beneficiary: Address,
    pub depositor: Address,
    pub total_paid: i128,
    pub fee_earned: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct EscrowRefunded {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub depositor: Address,
    pub beneficiary: Option<Address>,
    pub amount: i128,
    /// `emergency` or `arbiter`.
    pub kind: Symbol,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct EscrowCancelled {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub beneficiary: Option<Address>,
    pub depositor: Address,
    pub refund: i128,
    pub penalty: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct DeadlineExtended {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub beneficiary: Option<Address>,
    pub old_deadline: u32,
    pub new_deadline: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct JobFundsUpdated {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub beneficiary: Option<Address>,
    pub old_total: i128,
    pub new_total: i128,
    pub milestone_count: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct EscrowDeleted {
    #[topic]
    pub escrow_id: u32,
}

// ─── Milestones ──────────────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct MilestoneSubmitted {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub milestone_index: u32,
    #[topic]
    pub depositor: Address,
    pub beneficiary: Address,
    pub description: String,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MilestoneApproved {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub milestone_index: u32,
    #[topic]
    pub beneficiary: Address,
    pub amount: i128,
    pub approved_by: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MilestoneRejected {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub milestone_index: u32,
    #[topic]
    pub beneficiary: Address,
    pub reason: String,
    pub rejected_by: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MilestoneDisputed {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub milestone_index: u32,
    #[topic]
    pub counterparty: Address,
    pub disputer: Address,
    pub reason: String,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MilestoneProposalSubmitted {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub milestone_index: u32,
    #[topic]
    pub depositor: Address,
    pub proposed_amount: i128,
    pub proposed_description: String,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MilestoneProposalApproved {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub milestone_index: u32,
    #[topic]
    pub beneficiary: Address,
    pub new_amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MilestoneProposalRejected {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub milestone_index: u32,
    #[topic]
    pub beneficiary: Address,
}

// ─── Disputes ────────────────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct DisputeVoteCast {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub milestone_index: u32,
    pub arbiter: Address,
    pub freelancer_amount: i128,
    pub client_amount: i128,
    pub votes: u32,
    pub required: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct DisputeResolved {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub milestone_index: u32,
    #[topic]
    pub beneficiary: Address,
    pub depositor: Address,
    pub freelancer_amount: i128,
    pub client_amount: i128,
    pub resolved_by: Address,
    pub reason: String,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct OverdueDisputeRaised {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub counterparty: Address,
    pub requester: Address,
    pub reason: String,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct OverdueResolved {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub beneficiary: Address,
    pub depositor: Address,
    pub freelancer_amount: i128,
    pub client_amount: i128,
    pub resolved_by: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct EvidenceSubmitted {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub milestone_index: u32,
    pub submitter: Address,
    pub cid: String,
}

// ─── Marketplace ─────────────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct ApplicationSubmitted {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub depositor: Address,
    pub freelancer: Address,
    pub proposed_timeline: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct FreelancerAccepted {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub freelancer: Address,
    pub accepted_by: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct AssignmentDeclined {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub depositor: Address,
    pub freelancer: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct JobReopened {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub previous_freelancer: Option<Address>,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct JobManagerSet {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub manager: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct JobManagerRevoked {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub manager: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct RatingSubmitted {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub rated: Address,
    pub rater: Address,
    pub score: u32,
}

// ─── Admin ───────────────────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct ArbiterAuthorized {
    #[topic]
    pub arbiter: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct ArbiterRevoked {
    #[topic]
    pub arbiter: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct TokenListChanged {
    #[topic]
    pub token: Address,
    /// `whitelisted`, `delisted`, `blacklisted` or `unblacklisted`.
    pub change: Symbol,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct PlatformFeeUpdated {
    pub fee_bp: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct FeeCollectorUpdated {
    #[topic]
    pub fee_collector: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct OwnerChanged {
    #[topic]
    pub previous_owner: Address,
    #[topic]
    pub new_owner: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct PauseChanged {
    /// `contract` or `job_creation`.
    pub scope: Symbol,
    pub paused: bool,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct FeesWithdrawn {
    #[topic]
    pub token: Address,
    pub amount: i128,
    pub to: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct StuckFundsWithdrawn {
    #[topic]
    pub token: Address,
    pub amount: i128,
    pub to: Address,
}

// ─── Identity verification ───────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct VerifierSet {
    #[topic]
    pub verifier: Address,
}

/// Topics: [name, wallet] — the poller notifies the freelancer.
#[contractevent]
#[derive(Clone, Debug)]
pub struct FreelancerVerified {
    #[topic]
    pub wallet: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct VerificationRevoked {
    #[topic]
    pub wallet: Address,
    pub revoked_by: Address,
}
