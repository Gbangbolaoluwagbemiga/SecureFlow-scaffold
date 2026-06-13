#![no_std]

mod admin;
mod escrow_core;
mod escrow_management;
mod evidence;
mod marketplace;
mod ratings;
mod refund_system;
mod storage_types;
mod work_lifecycle;

pub use storage_types::*;

use soroban_sdk::{contract, contractimpl, Address, Env, String, Vec, Error};

#[contract]
pub struct SecureFlow;

#[contractimpl]
impl SecureFlow {
    /// Initialize the contract
    pub fn initialize(
        env: Env,
        owner: Address,
        fee_collector: Address,
        platform_fee_bp: u32,
        default_whitelisted_tokens: Vec<Address>,
    ) -> Result<(), Error> {
        admin::initialize(
            &env,
            owner,
            fee_collector,
            platform_fee_bp,
            default_whitelisted_tokens,
        )
    }

    /// Create an escrow with token
    /// Note: Milestone amounts and descriptions are combined into tuples to reduce parameter count
    pub fn create_escrow(
        env: Env,
        depositor: Address,
        beneficiary: Option<Address>,
        arbiters: Vec<Address>,
        required_confirmations: u32,
        milestones: Vec<(i128, String)>, // Combined milestone amounts and descriptions
        token: Option<Address>,
        total_amount: i128,
        duration: u32,
        project_title: String,
        project_description: String,
    ) -> Result<u32, Error> {
        // Split milestones into amounts and descriptions
        let mut milestone_amounts: Vec<i128> = Vec::new(&env);
        let mut milestone_descriptions: Vec<String> = Vec::new(&env);
        
        for (amount, desc) in milestones.iter() {
            milestone_amounts.push_back(amount.clone());
            milestone_descriptions.push_back(desc.clone());
        }
        
        escrow_management::create_escrow(
            &env,
            depositor,
            beneficiary,
            arbiters,
            required_confirmations,
            milestone_amounts,
            milestone_descriptions,
            token,
            total_amount,
            duration,
            project_title,
            project_description,
        )
    }

    /// Start work on an escrow
    pub fn start_work(env: Env, escrow_id: u32, beneficiary: Address) -> Result<(), Error> {
        work_lifecycle::start_work(&env, escrow_id, beneficiary)
    }

    /// Submit a milestone
    pub fn submit_milestone(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        description: String,
        beneficiary: Address,
    ) -> Result<(), Error> {
        work_lifecycle::submit_milestone(&env, escrow_id, milestone_index, beneficiary, description)
    }

    /// Resubmit a rejected milestone
    pub fn resubmit_milestone(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        description: String,
        beneficiary: Address,
    ) -> Result<(), Error> {
        work_lifecycle::resubmit_milestone(&env, escrow_id, milestone_index, beneficiary, description)
    }

    /// Approve a milestone
    pub fn approve_milestone(env: Env, escrow_id: u32, milestone_index: u32, depositor: Address) -> Result<(), Error> {
        work_lifecycle::approve_milestone(&env, escrow_id, milestone_index, depositor)
    }

    /// Reject a milestone
    pub fn reject_milestone(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        reason: String,
        depositor: Address,
    ) -> Result<(), Error> {
        work_lifecycle::reject_milestone(&env, escrow_id, milestone_index, reason, depositor)
    }

    /// Dispute a milestone
    pub fn dispute_milestone(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        reason: String,
        disputer: Address,
    ) -> Result<(), Error> {
        work_lifecycle::dispute_milestone(&env, escrow_id, milestone_index, reason, disputer)
    }

    /// Apply to a job
    pub fn apply_to_job(
        env: Env,
        escrow_id: u32,
        cover_letter: String,
        proposed_timeline: u32,
        freelancer: Address,
    ) -> Result<(), Error> {
        marketplace::apply_to_job(&env, escrow_id, freelancer, cover_letter, proposed_timeline)
    }

    /// Accept a freelancer for an open job
    pub fn accept_freelancer(env: Env, escrow_id: u32, freelancer: Address, depositor: Address) -> Result<(), Error> {
        marketplace::accept_freelancer(&env, escrow_id, depositor, freelancer)
    }

    /// Refund an escrow
    pub fn refund_escrow(env: Env, escrow_id: u32, depositor: Address) -> Result<(), Error> {
        refund_system::refund_escrow(&env, escrow_id, depositor)
    }

    /// Emergency refund after deadline
    pub fn emergency_refund_after_deadline(env: Env, escrow_id: u32, depositor: Address) -> Result<(), Error> {
        refund_system::emergency_refund_after_deadline(&env, escrow_id, depositor)
    }

    /// Extend deadline
    pub fn extend_deadline(env: Env, escrow_id: u32, extra_seconds: u32, depositor: Address) -> Result<(), Error> {
        refund_system::extend_deadline(&env, escrow_id, depositor, extra_seconds)
    }

    /// Raise an overdue dispute after the project deadline (callable by client OR freelancer).
    /// Puts the escrow into Disputed state and queues it for arbiter review.
    pub fn raise_overdue_dispute(env: Env, escrow_id: u32, requester: Address, reason: String) -> Result<(), Error> {
        refund_system::raise_overdue_dispute(&env, escrow_id, requester, reason)
    }

    /// Arbiter: approve refund — return all unreleased funds to the client.
    pub fn arbiter_approve_refund(env: Env, escrow_id: u32, arbiter: Address) -> Result<(), Error> {
        refund_system::arbiter_approve_refund(&env, escrow_id, arbiter)
    }

    /// Arbiter: award portion to the freelancer, return the rest to the client.
    pub fn arbiter_award_freelancer(env: Env, escrow_id: u32, arbiter: Address, freelancer_amount: i128) -> Result<(), Error> {
        refund_system::arbiter_award_freelancer(&env, escrow_id, arbiter, freelancer_amount)
    }

    /// View: get the pending overdue request for an escrow, if any.
    pub fn get_overdue_request(env: Env, escrow_id: u32) -> Option<crate::storage_types::OverdueRequest> {
        refund_system::get_overdue_request(&env, escrow_id)
    }

    // View functions
    pub fn get_escrow(env: Env, escrow_id: u32) -> Option<EscrowData> {
        escrow_core::get_escrow(&env, escrow_id)
    }

    pub fn get_user_escrows(env: Env, user: Address) -> Vec<u32> {
        escrow_core::get_user_escrows(&env, user)
    }

    pub fn get_reputation(env: Env, user: Address) -> u32 {
        escrow_core::get_reputation(&env, user)
    }

    // Admin functions
    pub fn set_platform_fee_bp(env: Env, fee_bp: u32) -> Result<(), Error> {
        admin::set_platform_fee_bp(&env, fee_bp)
    }

    pub fn set_fee_collector(env: Env, fee_collector: Address) -> Result<(), Error> {
        admin::set_fee_collector(&env, fee_collector)
    }

    pub fn set_owner(env: Env, new_owner: Address) -> Result<(), Error> {
        admin::set_owner(&env, new_owner)
    }

    pub fn whitelist_token(env: Env, token: Address) -> Result<(), Error> {
        admin::require_owner(&env)?;
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
        env.storage()
            .instance()
            .set(&DataKey::WhitelistedToken(token.clone()), &true);
        admin::add_to_list_unique(&env, DataKey::WhitelistedTokens, token);
        Ok(())
    }

    /// Owner-only: remove a token from the whitelist so it can no longer be used for new escrows.
    pub fn delist_token(env: Env, token: Address) -> Result<(), Error> {
        admin::require_owner(&env)?;
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
        env.storage()
            .instance()
            .remove(&DataKey::WhitelistedToken(token.clone()));
        admin::remove_from_list(&env, DataKey::WhitelistedTokens, &token);
        Ok(())
    }

    pub fn authorize_arbiter(env: Env, arbiter: Address) -> Result<(), Error> {
        admin::require_owner(&env)?;
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedArbiter(arbiter.clone()), &true);
        admin::add_to_list_unique(&env, DataKey::AuthorizedArbiters, arbiter);
        Ok(())
    }

    /// Owner-only: revoke an arbiter's authorization (e.g. compromised or malicious wallet).
    pub fn remove_arbiter(env: Env, arbiter: Address) -> Result<(), Error> {
        admin::remove_arbiter(&env, arbiter)
    }

    /// Owner-only: withdraw stuck funds (excess above escrowed amounts) for a given token contract.
    pub fn withdraw_stuck_funds(
        env: Env,
        token: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), Error> {
        admin::withdraw_stuck_funds(&env, token, to, amount)
    }

    /// Pause job creation
    pub fn pause_job_creation(env: Env) -> Result<(), Error> {
        admin::set_job_creation_paused(&env, true)
    }

    /// Unpause job creation
    pub fn unpause_job_creation(env: Env) -> Result<(), Error> {
        admin::set_job_creation_paused(&env, false)
    }

    /// Check if job creation is paused
    pub fn is_job_creation_paused(env: Env) -> bool {
        admin::is_job_creation_paused(&env)
    }

    /// Get the contract owner
    pub fn get_owner(env: Env) -> Result<Address, Error> {
        admin::get_owner(&env)
    }

    pub fn get_platform_fee_bp(env: Env) -> u32 {
        admin::get_platform_fee_bp(&env)
    }

    pub fn get_fee_collector(env: Env) -> Result<Address, Error> {
        admin::get_fee_collector(&env)
    }

    pub fn get_total_escrows(env: Env) -> u32 {
        let next: u32 = env.storage().instance().get(&DataKey::NextEscrowId).unwrap_or(1u32);
        if next == 0 { 0 } else { next.saturating_sub(1) }
    }

    pub fn get_whitelisted_tokens(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::WhitelistedTokens).unwrap_or(Vec::new(&env))
    }

    pub fn is_token_whitelisted(env: Env, token: Option<Address>) -> bool {
        escrow_core::is_whitelisted_token(&env, token)
    }

    pub fn get_authorized_arbiters(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::AuthorizedArbiters).unwrap_or(Vec::new(&env))
    }

    pub fn is_authorized_arbiter(env: Env, arbiter: Address) -> bool {
        escrow_core::is_authorized_arbiter(&env, arbiter)
    }

    /// Check if a freelancer has applied to a job
    pub fn has_applied(env: Env, escrow_id: u32, freelancer: Address) -> bool {
        marketplace::has_applied(&env, escrow_id, freelancer)
    }

    /// Get an application by escrow_id and freelancer
    pub fn get_application(env: Env, escrow_id: u32, freelancer: Address) -> Option<Application> {
        marketplace::get_application(&env, escrow_id, freelancer)
    }

    /// Get all applications for an escrow
    pub fn get_applications(env: Env, escrow_id: u32) -> Vec<Application> {
        marketplace::get_applications(&env, escrow_id)
    }

    /// Get a milestone by escrow_id and milestone_index
    pub fn get_milestone(env: Env, escrow_id: u32, milestone_index: u32) -> Option<Milestone> {
        work_lifecycle::get_milestone(&env, escrow_id, milestone_index)
    }

    /// Get all milestones for an escrow
    pub fn get_milestones(env: Env, escrow_id: u32) -> Vec<Milestone> {
        work_lifecycle::get_milestones(&env, escrow_id)
    }

    /// Submit a rating for a completed escrow
    pub fn submit_rating(
        env: Env,
        escrow_id: u32,
        rating: u32,
        review: String,
        client: Address,
    ) -> Result<(), Error> {
        ratings::submit_rating(&env, escrow_id, rating, review, client)
    }

    /// Get rating for an escrow
    pub fn get_rating(env: Env, escrow_id: u32) -> Option<Rating> {
        ratings::get_rating(&env, escrow_id)
    }

    /// Get average rating for a freelancer (returns (total_rating, count))
    pub fn get_average_rating(env: Env, freelancer: Address) -> (u32, u32) {
        ratings::get_average_rating(&env, freelancer)
    }

    /// Get badge for a freelancer
    pub fn get_badge(env: Env, freelancer: Address) -> Badge {
        ratings::get_badge(&env, freelancer)
    }

    /// Get completed escrows count for a user
    pub fn get_completed_escrows(env: Env, user: Address) -> u32 {
        ratings::get_completed_escrows(&env, user)
    }

    /// Submit a rating for the client (called by freelancer after completion)
    pub fn submit_client_rating(
        env: Env,
        escrow_id: u32,
        rating: u32,
        review: String,
        freelancer: Address,
    ) -> Result<(), Error> {
        ratings::submit_client_rating(&env, escrow_id, rating, review, freelancer)
    }

    /// Get client rating for an escrow (set by freelancer)
    pub fn get_client_rating(env: Env, escrow_id: u32) -> Option<ClientRatingData> {
        ratings::get_client_rating(&env, escrow_id)
    }

    /// Get average rating for a client address → (total, count)
    pub fn get_average_client_rating(env: Env, client: Address) -> (u32, u32) {
        ratings::get_average_client_rating(&env, client)
    }

    // (moved earlier) is_authorized_arbiter is defined above with other admin views

    /// Submit evidence for a disputed milestone (stored on-chain in Soroban).
    /// `submitter` must be the depositor, beneficiary, or an arbiter for the escrow.
    /// `cid` is the IPFS CID (optionally suffixed with `|description`).
    pub fn submit_evidence(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        submitter: Address,
        cid: String,
    ) -> Result<(), Error> {
        evidence::submit_evidence(&env, escrow_id, milestone_index, submitter, cid)
    }

    /// Get all evidence entries for a specific escrow milestone.
    pub fn get_evidence(env: Env, escrow_id: u32, milestone_index: u32) -> Vec<EvidenceEntry> {
        evidence::get_evidence(&env, escrow_id, milestone_index)
    }

    // ─── Emergency pause ─────────────────────────────────────────────────────

    /// Owner-only: pause ALL contract write operations (emergency).
    pub fn pause_contract(env: Env) -> Result<(), Error> {
        admin::pause_contract(&env)
    }

    /// Owner-only: lift the emergency pause.
    pub fn unpause_contract(env: Env) -> Result<(), Error> {
        admin::unpause_contract(&env)
    }

    /// Returns true when the contract is in emergency-paused state.
    pub fn is_contract_paused(env: Env) -> bool {
        admin::is_contract_paused(&env)
    }

    // ─── Token blacklist ──────────────────────────────────────────────────────

    /// Owner-only: blacklist a token so it can no longer be used for new escrows.
    pub fn blacklist_token(env: Env, token: Address) -> Result<(), Error> {
        admin::blacklist_token(&env, token)
    }

    /// Owner-only: remove a token from the blacklist.
    pub fn unblacklist_token(env: Env, token: Address) -> Result<(), Error> {
        admin::unblacklist_token(&env, token)
    }

    /// Returns true when the given token is blacklisted.
    pub fn is_token_blacklisted(env: Env, token: Address) -> bool {
        admin::is_blacklisted_token(&env, &token)
    }

    /// Return the list of all blacklisted tokens.
    pub fn get_blacklisted_tokens(env: Env) -> Vec<Address> {
        admin::get_blacklisted_tokens(&env)
    }

    // ─── Fee withdrawal ───────────────────────────────────────────────────────

    /// Return the accumulated (unclaimed) platform fees for a given token.
    /// Pass `None` for native XLM fees.
    pub fn get_withdrawable_fees(env: Env, token: Option<Address>) -> i128 {
        admin::get_withdrawable_fees(&env, token)
    }

    /// Fee collector: withdraw all accumulated platform fees for a given token.
    pub fn withdraw_fees(env: Env, token: Option<Address>, caller: Address) -> Result<(), Error> {
        admin::withdraw_fees(&env, token, caller)
    }

    // ─── Paginated applications ───────────────────────────────────────────────

    /// Get a page of applications for an escrow (zero-based offset).
    pub fn get_applications_page(env: Env, escrow_id: u32, offset: u32, limit: u32) -> Vec<Application> {
        marketplace::get_applications_page(&env, escrow_id, offset, limit)
    }

    /// Return the total number of applications for an escrow.
    pub fn get_application_count(env: Env, escrow_id: u32) -> u32 {
        marketplace::get_application_count(&env, escrow_id)
    }

    // ─── Milestone management ─────────────────────────────────────────────────

    /// Add a new milestone to a Pending escrow (only before work starts).
    pub fn add_milestone(
        env: Env,
        escrow_id: u32,
        amount: i128,
        description: String,
        depositor: Address,
    ) -> Result<(), Error> {
        escrow_management::add_milestone(&env, escrow_id, amount, description, depositor)
    }

    /// Remove a milestone from a Pending escrow by index (only before work starts).
    pub fn remove_milestone(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        depositor: Address,
    ) -> Result<(), Error> {
        escrow_management::remove_milestone(&env, escrow_id, milestone_index, depositor)
    }

    // ─── Job cancellation ─────────────────────────────────────────────────────

    /// Depositor cancels an open (unassigned) job and receives a tiered refund.
    pub fn cancel_job(env: Env, escrow_id: u32, depositor: Address) -> Result<(), Error> {
        escrow_management::cancel_job(&env, escrow_id, depositor)
    }

    // ─── Dynamic fund management ──────────────────────────────────────────────

    /// Add funds to a specific milestone on an open job (before freelancer assigned).
    pub fn add_job_funds(
        env: Env,
        escrow_id: u32,
        depositor: Address,
        additional_amount: i128,
        milestone_index: u32,
    ) -> Result<(), Error> {
        escrow_management::add_job_funds(&env, escrow_id, depositor, additional_amount, milestone_index)
    }

    /// Withdraw funds from a specific milestone on an open job (before freelancer assigned).
    pub fn withdraw_job_funds(
        env: Env,
        escrow_id: u32,
        depositor: Address,
        withdraw_amount: i128,
        milestone_index: u32,
    ) -> Result<(), Error> {
        escrow_management::withdraw_job_funds(&env, escrow_id, depositor, withdraw_amount, milestone_index)
    }

    // ─── Milestone negotiation ────────────────────────────────────────────────

    /// Freelancer proposes a change to a milestone's amount and/or description.
    pub fn propose_milestone_change(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        proposed_amount: i128,
        proposed_description: String,
        freelancer: Address,
    ) -> Result<(), Error> {
        work_lifecycle::propose_milestone_change(
            &env, escrow_id, milestone_index, proposed_amount, proposed_description, freelancer,
        )
    }

    /// Client approves the freelancer's milestone change proposal.
    pub fn approve_milestone_proposal(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        depositor: Address,
    ) -> Result<(), Error> {
        work_lifecycle::approve_milestone_proposal(&env, escrow_id, milestone_index, depositor)
    }

    /// Client rejects the freelancer's milestone change proposal.
    pub fn reject_milestone_proposal(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        depositor: Address,
    ) -> Result<(), Error> {
        work_lifecycle::reject_milestone_proposal(&env, escrow_id, milestone_index, depositor)
    }

    // ─── Per-milestone multi-sig dispute resolution ───────────────────────────

    /// Authorized arbiter casts a vote to resolve a disputed milestone.
    /// Executes when `required_confirmations` votes have been cast.
    pub fn resolve_dispute(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        arbiter: Address,
        freelancer_amount: i128,
        client_amount: i128,
        reason: String,
    ) -> Result<(), Error> {
        work_lifecycle::resolve_dispute(
            &env, escrow_id, milestone_index, arbiter, freelancer_amount, client_amount, reason,
        )
    }

    // ─── Escrow admin ─────────────────────────────────────────────────────────

    /// Owner-only: permanently delete a terminal escrow with no remaining funds.
    pub fn delete_escrow(env: Env, escrow_id: u32) -> Result<(), Error> {
        admin::delete_escrow(&env, escrow_id)
    }

    /// Get the number of dispute votes cast for an escrow.
    pub fn get_dispute_vote_count(env: Env, escrow_id: u32) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::DisputeVoteCount(escrow_id))
            .unwrap_or(0)
    }

    /// Check whether a specific arbiter has already voted on an escrow's dispute.
    pub fn has_dispute_voted(env: Env, escrow_id: u32, arbiter: Address) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::DisputeVote(escrow_id, arbiter))
            .unwrap_or(false)
    }

    /// Get the user's lifetime cancellation count.
    pub fn get_user_cancellations(env: Env, user: Address) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::UserCancellations(user))
            .unwrap_or(0)
    }
}

