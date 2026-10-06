#![no_std]
// Contract entry points mirror the frontend ABI (create_escrow takes 10
// arguments); the generated client wrappers inherit the same count.
#![allow(clippy::too_many_arguments)]

//! `SecureFlow` — milestone escrow for freelance work on Soroban.
//!
//! Function names and argument order are the frontend's ABI
//! (`src/lib/web3/contract-service.ts` builds calls positionally by name).
//! Change a signature only together with its caller.
//!
//! Every function returns `SfResult<_, SecureFlowError>`; none panics on bad
//! input. See `storage_types::SecureFlowError` for what each code means.

mod admin;
mod escrow_core;
mod escrow_management;
mod events;
mod evidence;
mod marketplace;
mod ratings;
mod refund_system;
mod storage_types;
mod work_lifecycle;

#[cfg(test)]
mod test;

pub use storage_types::*;

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Error, String, Vec};

#[contract]
pub struct SecureFlow;

#[contractimpl]
impl SecureFlow {
    // ─── Setup ───────────────────────────────────────────────────────────────

    /// One-time setup. `owner` must sign.
    pub fn initialize(
        env: Env,
        owner: Address,
        fee_collector: Address,
        platform_fee_bp: u32,
        default_whitelisted_tokens: Vec<Address>,
    ) -> Result<(), Error> {
        Ok(admin::initialize(
            &env,
            owner,
            fee_collector,
            platform_fee_bp,
            default_whitelisted_tokens,
        )?)
    }

    /// Deployed implementation, readable from chain state alone.
    pub fn version(env: Env) -> String {
        String::from_str(&env, CONTRACT_VERSION)
    }

    /// Owner replaces the contract code in place, keeping every escrow.
    ///
    /// What that costs, stated plainly: the CONTRACT cannot take anyone's
    /// money, but the OWNER can change the contract. Do not describe this
    /// deployment as trustless without that second clause.
    ///
    /// Storage is only safe across an upgrade if stored types stay readable:
    /// never reorder, retype or remove a field of a stored struct (adding one
    /// breaks old entries too — that is what forced the July redeploy). Bump
    /// `CONTRACT_VERSION` with every upgrade.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        admin::require_owner(&env)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    // ─── Escrow creation ─────────────────────────────────────────────────────

    /// Fund a milestone escrow. The depositor pays `total_amount` plus the
    /// platform fee (see `quote_deposit`); milestone amounts must sum to
    /// exactly `total_amount`. `beneficiary: None` posts an open job.
    /// `duration` is in seconds (1 hour to 365 days).
    pub fn create_escrow(
        env: Env,
        depositor: Address,
        beneficiary: Option<Address>,
        arbiters: Vec<Address>,
        required_confirmations: u32,
        milestones: Vec<(i128, String)>,
        token: Option<Address>,
        total_amount: i128,
        duration: u32,
        project_title: String,
        project_description: String,
    ) -> Result<u32, Error> {
        Ok(escrow_management::create_escrow(
            &env,
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
        )?)
    }

    /// `(deposit, fee)` a client must pay to fund `total_amount` today.
    pub fn quote_deposit(env: Env, total_amount: i128) -> Result<(i128, i128), Error> {
        Ok(escrow_management::quote_deposit(&env, total_amount)?)
    }

    // ─── Work lifecycle ──────────────────────────────────────────────────────

    pub fn start_work(env: Env, escrow_id: u32, beneficiary: Address) -> Result<(), Error> {
        Ok(work_lifecycle::start_work(&env, escrow_id, beneficiary)?)
    }

    /// Deliver a milestone (also redelivers a rejected one).
    pub fn submit_milestone(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        description: String,
        beneficiary: Address,
    ) -> Result<(), Error> {
        Ok(work_lifecycle::submit_milestone(
            &env,
            escrow_id,
            milestone_index,
            beneficiary,
            description,
        )?)
    }

    pub fn resubmit_milestone(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        description: String,
        beneficiary: Address,
    ) -> Result<(), Error> {
        Ok(work_lifecycle::resubmit_milestone(
            &env,
            escrow_id,
            milestone_index,
            beneficiary,
            description,
        )?)
    }

    /// `depositor` may be the client or their appointed job manager.
    pub fn approve_milestone(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        depositor: Address,
    ) -> Result<(), Error> {
        Ok(work_lifecycle::approve_milestone(
            &env,
            escrow_id,
            milestone_index,
            depositor,
        )?)
    }

    /// `depositor` may be the client or their appointed job manager.
    pub fn reject_milestone(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        reason: String,
        depositor: Address,
    ) -> Result<(), Error> {
        Ok(work_lifecycle::reject_milestone(
            &env,
            escrow_id,
            milestone_index,
            reason,
            depositor,
        )?)
    }

    /// Client, freelancer or job manager escalates a milestone to arbitration.
    pub fn dispute_milestone(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        reason: String,
        disputer: Address,
    ) -> Result<(), Error> {
        Ok(work_lifecycle::dispute_milestone(
            &env,
            escrow_id,
            milestone_index,
            reason,
            disputer,
        )?)
    }

    // ─── Marketplace ─────────────────────────────────────────────────────────

    pub fn apply_to_job(
        env: Env,
        escrow_id: u32,
        cover_letter: String,
        proposed_timeline: u32,
        freelancer: Address,
    ) -> Result<(), Error> {
        Ok(marketplace::apply_to_job(
            &env,
            escrow_id,
            freelancer,
            cover_letter,
            proposed_timeline,
        )?)
    }

    /// `depositor` may be the client or their appointed job manager.
    pub fn accept_freelancer(
        env: Env,
        escrow_id: u32,
        freelancer: Address,
        depositor: Address,
    ) -> Result<(), Error> {
        Ok(marketplace::accept_freelancer(
            &env, escrow_id, depositor, freelancer,
        )?)
    }

    /// The named freelancer hands the job back before starting it.
    pub fn decline_assignment(env: Env, escrow_id: u32, beneficiary: Address) -> Result<(), Error> {
        Ok(escrow_management::decline_assignment(
            &env,
            escrow_id,
            beneficiary,
        )?)
    }

    /// Put a declined or arbitrated job back on the board with its history.
    pub fn reopen_job(env: Env, escrow_id: u32, depositor: Address) -> Result<(), Error> {
        Ok(escrow_management::reopen_job(&env, escrow_id, depositor)?)
    }

    // ─── Job manager (Autopilot) ─────────────────────────────────────────────

    pub fn set_job_manager(
        env: Env,
        escrow_id: u32,
        manager: Address,
        depositor: Address,
    ) -> Result<(), Error> {
        Ok(escrow_management::set_job_manager(
            &env, escrow_id, manager, depositor,
        )?)
    }

    pub fn revoke_job_manager(env: Env, escrow_id: u32, depositor: Address) -> Result<(), Error> {
        Ok(escrow_management::revoke_job_manager(
            &env, escrow_id, depositor,
        )?)
    }

    pub fn get_job_manager(env: Env, escrow_id: u32) -> Option<Address> {
        escrow_core::get_job_manager(&env, escrow_id)
    }

    pub fn is_job_manager(env: Env, escrow_id: u32, who: Address) -> bool {
        escrow_core::get_job_manager(&env, escrow_id) == Some(who)
    }

    // ─── Refunds, cancellation & deadlines ───────────────────────────────────

    /// Same as `cancel_job`: before work starts, take the money back.
    pub fn refund_escrow(env: Env, escrow_id: u32, depositor: Address) -> Result<(), Error> {
        Ok(escrow_management::cancel_job(&env, escrow_id, depositor)?)
    }

    /// Before work starts, cancel and take back the unpaid budget plus the
    /// held fee, minus a penalty only if people applied.
    pub fn cancel_job(env: Env, escrow_id: u32, depositor: Address) -> Result<(), Error> {
        Ok(escrow_management::cancel_job(&env, escrow_id, depositor)?)
    }

    pub fn emergency_refund_after_deadline(
        env: Env,
        escrow_id: u32,
        depositor: Address,
    ) -> Result<(), Error> {
        Ok(refund_system::emergency_refund_after_deadline(
            &env, escrow_id, depositor,
        )?)
    }

    /// `extra_seconds`: 1 second to 365 days.
    pub fn extend_deadline(
        env: Env,
        escrow_id: u32,
        extra_seconds: u32,
        depositor: Address,
    ) -> Result<(), Error> {
        Ok(refund_system::extend_deadline(
            &env,
            escrow_id,
            depositor,
            extra_seconds,
        )?)
    }

    pub fn raise_overdue_dispute(
        env: Env,
        escrow_id: u32,
        requester: Address,
        reason: String,
    ) -> Result<(), Error> {
        Ok(refund_system::raise_overdue_dispute(
            &env, escrow_id, requester, reason,
        )?)
    }

    /// Arbiter vote: return all unpaid funds to the client.
    pub fn arbiter_approve_refund(env: Env, escrow_id: u32, arbiter: Address) -> Result<(), Error> {
        Ok(refund_system::arbiter_approve_refund(
            &env, escrow_id, arbiter,
        )?)
    }

    /// Arbiter vote: `freelancer_amount` of the unpaid balance to the
    /// freelancer, the rest to the client.
    pub fn arbiter_award_freelancer(
        env: Env,
        escrow_id: u32,
        arbiter: Address,
        freelancer_amount: i128,
    ) -> Result<(), Error> {
        Ok(refund_system::arbiter_award_freelancer(
            &env,
            escrow_id,
            arbiter,
            freelancer_amount,
        )?)
    }

    pub fn get_overdue_request(env: Env, escrow_id: u32) -> Option<OverdueRequest> {
        refund_system::get_overdue_request(&env, escrow_id)
    }

    // ─── Milestone & fund editing (before work starts) ───────────────────────

    /// Add a milestone, depositing its amount plus fee share.
    pub fn add_milestone(
        env: Env,
        escrow_id: u32,
        amount: i128,
        description: String,
        depositor: Address,
    ) -> Result<(), Error> {
        Ok(escrow_management::add_milestone(
            &env,
            escrow_id,
            amount,
            description,
            depositor,
        )?)
    }

    /// Remove a milestone, refunding its amount plus fee share.
    pub fn remove_milestone(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        depositor: Address,
    ) -> Result<(), Error> {
        Ok(escrow_management::remove_milestone(
            &env,
            escrow_id,
            milestone_index,
            depositor,
        )?)
    }

    /// Replace the whole milestone list, settling any change in total.
    pub fn set_milestones(
        env: Env,
        escrow_id: u32,
        milestones: Vec<(i128, String)>,
        depositor: Address,
    ) -> Result<(), Error> {
        Ok(escrow_management::set_milestones(
            &env, escrow_id, milestones, depositor,
        )?)
    }

    pub fn add_job_funds(
        env: Env,
        escrow_id: u32,
        depositor: Address,
        additional_amount: i128,
        milestone_index: u32,
    ) -> Result<(), Error> {
        Ok(escrow_management::add_job_funds(
            &env,
            escrow_id,
            depositor,
            additional_amount,
            milestone_index,
        )?)
    }

    pub fn withdraw_job_funds(
        env: Env,
        escrow_id: u32,
        depositor: Address,
        withdraw_amount: i128,
        milestone_index: u32,
    ) -> Result<(), Error> {
        Ok(escrow_management::withdraw_job_funds(
            &env,
            escrow_id,
            depositor,
            withdraw_amount,
            milestone_index,
        )?)
    }

    // ─── Milestone negotiation ───────────────────────────────────────────────

    pub fn propose_milestone_change(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        proposed_amount: i128,
        proposed_description: String,
        freelancer: Address,
    ) -> Result<(), Error> {
        Ok(work_lifecycle::propose_milestone_change(
            &env,
            escrow_id,
            milestone_index,
            proposed_amount,
            proposed_description,
            freelancer,
        )?)
    }

    /// Accepting a price change moves the difference (plus fee share) in the
    /// same call.
    pub fn approve_milestone_proposal(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        depositor: Address,
    ) -> Result<(), Error> {
        Ok(work_lifecycle::approve_milestone_proposal(
            &env,
            escrow_id,
            milestone_index,
            depositor,
        )?)
    }

    pub fn reject_milestone_proposal(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        depositor: Address,
    ) -> Result<(), Error> {
        Ok(work_lifecycle::reject_milestone_proposal(
            &env,
            escrow_id,
            milestone_index,
            depositor,
        )?)
    }

    // ─── Arbitration ─────────────────────────────────────────────────────────

    /// Arbiter vote to split one milestone. Executes when enough arbiters
    /// agree on the same split. `reason` is required.
    pub fn resolve_dispute(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        arbiter: Address,
        freelancer_amount: i128,
        client_amount: i128,
        reason: String,
    ) -> Result<(), Error> {
        Ok(work_lifecycle::resolve_dispute(
            &env,
            escrow_id,
            milestone_index,
            arbiter,
            freelancer_amount,
            client_amount,
            reason,
        )?)
    }

    /// Arbiters who have voted in this escrow's current dispute round.
    pub fn get_dispute_vote_count(env: Env, escrow_id: u32) -> u32 {
        escrow_core::p_get::<Vec<Address>>(&env, &DataKey::DisputeVoters(escrow_id))
            .map_or(0, |v| v.len())
    }

    pub fn has_dispute_voted(env: Env, escrow_id: u32, arbiter: Address) -> bool {
        escrow_core::p_get::<Vec<Address>>(&env, &DataKey::DisputeVoters(escrow_id))
            .is_some_and(|v| v.contains(&arbiter))
    }

    /// Votes recorded for one specific split. Use `milestone_index =
    /// 4294967295` for an overdue (whole-escrow) ruling.
    pub fn get_resolution_votes(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        freelancer_amount: i128,
        client_amount: i128,
    ) -> Vec<Address> {
        escrow_core::p_get(
            &env,
            &DataKey::ResolutionVotes(escrow_id, milestone_index, freelancer_amount, client_amount),
        )
        .unwrap_or(Vec::new(&env))
    }

    /// Agreeing votes needed to execute a ruling on this escrow.
    pub fn get_required_votes(env: Env, escrow_id: u32) -> Result<u32, Error> {
        let escrow = escrow_core::load_escrow(&env, escrow_id)?;
        Ok(escrow_core::quorum(&env, &escrow))
    }

    pub fn is_arbitrated(env: Env, escrow_id: u32) -> bool {
        escrow_core::p_get(&env, &DataKey::Arbitrated(escrow_id)).unwrap_or(false)
    }

    pub fn submit_evidence(
        env: Env,
        escrow_id: u32,
        milestone_index: u32,
        submitter: Address,
        cid: String,
    ) -> Result<(), Error> {
        Ok(evidence::submit_evidence(
            &env,
            escrow_id,
            milestone_index,
            submitter,
            cid,
        )?)
    }

    pub fn get_evidence(env: Env, escrow_id: u32, milestone_index: u32) -> Vec<EvidenceEntry> {
        evidence::get_evidence(&env, escrow_id, milestone_index)
    }

    // ─── Ratings ─────────────────────────────────────────────────────────────

    /// Client rates the freelancer (escrow must be Released).
    pub fn submit_rating(
        env: Env,
        escrow_id: u32,
        rating: u32,
        review: String,
        client: Address,
    ) -> Result<(), Error> {
        Ok(ratings::submit_rating(
            &env, escrow_id, rating, review, client,
        )?)
    }

    /// Freelancer rates the client (escrow must be Released).
    pub fn submit_client_rating(
        env: Env,
        escrow_id: u32,
        rating: u32,
        review: String,
        freelancer: Address,
    ) -> Result<(), Error> {
        Ok(ratings::submit_client_rating(
            &env, escrow_id, rating, review, freelancer,
        )?)
    }

    pub fn get_rating(env: Env, escrow_id: u32) -> Option<Rating> {
        ratings::get_rating(&env, escrow_id)
    }

    /// `(sum_of_ratings, count)`.
    pub fn get_average_rating(env: Env, freelancer: Address) -> (u32, u32) {
        ratings::get_average_rating(&env, freelancer)
    }

    pub fn get_client_rating(env: Env, escrow_id: u32) -> Option<ClientRatingData> {
        ratings::get_client_rating(&env, escrow_id)
    }

    /// `(sum_of_ratings, count)`.
    pub fn get_average_client_rating(env: Env, client: Address) -> (u32, u32) {
        ratings::get_average_client_rating(&env, client)
    }

    pub fn get_badge(env: Env, freelancer: Address) -> Badge {
        ratings::get_badge(&env, freelancer)
    }

    pub fn get_completed_escrows(env: Env, user: Address) -> u32 {
        ratings::get_completed_escrows(&env, user)
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    pub fn get_escrow(env: Env, escrow_id: u32) -> Option<EscrowData> {
        escrow_core::get_escrow(&env, escrow_id)
    }

    pub fn get_milestone(env: Env, escrow_id: u32, milestone_index: u32) -> Option<Milestone> {
        work_lifecycle::get_milestone(&env, escrow_id, milestone_index)
    }

    pub fn get_milestones(env: Env, escrow_id: u32) -> Vec<Milestone> {
        work_lifecycle::get_milestones(&env, escrow_id)
    }

    pub fn get_user_escrows(env: Env, user: Address) -> Vec<u32> {
        escrow_core::get_user_escrows(&env, user)
    }

    pub fn get_reputation(env: Env, user: Address) -> u32 {
        escrow_core::get_reputation(&env, user)
    }

    pub fn get_total_escrows(env: Env) -> u32 {
        let next: u32 = env
            .storage()
            .instance()
            .get(&DataKey::NextEscrowId)
            .unwrap_or(1);
        next.saturating_sub(1)
    }

    pub fn has_applied(env: Env, escrow_id: u32, freelancer: Address) -> bool {
        marketplace::has_applied(&env, escrow_id, freelancer)
    }

    pub fn get_application(env: Env, escrow_id: u32, freelancer: Address) -> Option<Application> {
        marketplace::get_application(&env, escrow_id, freelancer)
    }

    pub fn get_applications(env: Env, escrow_id: u32) -> Vec<Application> {
        marketplace::get_applications(&env, escrow_id)
    }

    pub fn get_applications_page(
        env: Env,
        escrow_id: u32,
        offset: u32,
        limit: u32,
    ) -> Vec<Application> {
        marketplace::get_applications_page(&env, escrow_id, offset, limit)
    }

    pub fn get_application_count(env: Env, escrow_id: u32) -> u32 {
        marketplace::get_application_count(&env, escrow_id)
    }

    pub fn get_user_cancellations(env: Env, user: Address) -> u32 {
        escrow_core::p_get(&env, &DataKey::UserCancellations(user)).unwrap_or(0)
    }

    /// Everything still owed to escrows in this token (unpaid principal plus
    /// held fees). `None` = native XLM.
    pub fn get_escrowed_amount(env: Env, token: Option<Address>) -> i128 {
        let key = DataKey::EscrowedAmount(escrow_core::token_address(&env, token.as_ref()));
        env.storage().instance().get(&key).unwrap_or(0)
    }

    pub fn get_native_token(env: Env) -> Address {
        escrow_core::native_token(&env)
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    pub fn get_owner(env: Env) -> Result<Address, Error> {
        Ok(admin::get_owner(&env)?)
    }

    /// Both the current and the new owner must sign.
    pub fn set_owner(env: Env, new_owner: Address) -> Result<(), Error> {
        Ok(admin::set_owner(&env, new_owner)?)
    }

    pub fn get_platform_fee_bp(env: Env) -> u32 {
        admin::get_platform_fee_bp(&env)
    }

    pub fn set_platform_fee_bp(env: Env, fee_bp: u32) -> Result<(), Error> {
        Ok(admin::set_platform_fee_bp(&env, fee_bp)?)
    }

    pub fn get_fee_collector(env: Env) -> Result<Address, Error> {
        Ok(admin::get_fee_collector(&env)?)
    }

    pub fn set_fee_collector(env: Env, fee_collector: Address) -> Result<(), Error> {
        Ok(admin::set_fee_collector(&env, fee_collector)?)
    }

    /// Earned, unwithdrawn fees. `None` = native XLM.
    pub fn get_withdrawable_fees(env: Env, token: Option<Address>) -> i128 {
        admin::get_withdrawable_fees(&env, token)
    }

    pub fn withdraw_fees(env: Env, token: Option<Address>, caller: Address) -> Result<(), Error> {
        Ok(admin::withdraw_fees(&env, token, caller)?)
    }

    /// Owner recovers only the surplus above everything owed and every fee.
    pub fn withdraw_stuck_funds(
        env: Env,
        token: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), Error> {
        Ok(admin::withdraw_stuck_funds(&env, token, to, amount)?)
    }

    pub fn whitelist_token(env: Env, token: Address) -> Result<(), Error> {
        Ok(admin::whitelist_token(&env, token)?)
    }

    pub fn delist_token(env: Env, token: Address) -> Result<(), Error> {
        Ok(admin::delist_token(&env, token)?)
    }

    pub fn get_whitelisted_tokens(env: Env) -> Vec<Address> {
        admin::get_whitelisted_tokens(&env)
    }

    pub fn is_token_whitelisted(env: Env, token: Option<Address>) -> bool {
        escrow_core::is_whitelisted_token(&env, token)
    }

    pub fn blacklist_token(env: Env, token: Address) -> Result<(), Error> {
        Ok(admin::blacklist_token(&env, token)?)
    }

    pub fn unblacklist_token(env: Env, token: Address) -> Result<(), Error> {
        Ok(admin::unblacklist_token(&env, token)?)
    }

    pub fn is_token_blacklisted(env: Env, token: Address) -> bool {
        admin::is_blacklisted_token(&env, &token)
    }

    pub fn get_blacklisted_tokens(env: Env) -> Vec<Address> {
        admin::get_blacklisted_tokens(&env)
    }

    pub fn authorize_arbiter(env: Env, arbiter: Address) -> Result<(), Error> {
        Ok(admin::authorize_arbiter(&env, arbiter)?)
    }

    pub fn remove_arbiter(env: Env, arbiter: Address) -> Result<(), Error> {
        Ok(admin::remove_arbiter(&env, arbiter)?)
    }

    pub fn get_authorized_arbiters(env: Env) -> Vec<Address> {
        admin::get_authorized_arbiters(&env)
    }

    pub fn is_authorized_arbiter(env: Env, arbiter: Address) -> bool {
        escrow_core::is_authorized_arbiter(&env, &arbiter)
    }

    pub fn pause_job_creation(env: Env) -> Result<(), Error> {
        Ok(admin::set_job_creation_paused(&env, true)?)
    }

    pub fn unpause_job_creation(env: Env) -> Result<(), Error> {
        Ok(admin::set_job_creation_paused(&env, false)?)
    }

    /// Same as `pause_job_creation` / `unpause_job_creation` in one call (the
    /// admin page uses this form).
    pub fn set_job_creation_paused(env: Env, paused: bool) -> Result<(), Error> {
        Ok(admin::set_job_creation_paused(&env, paused)?)
    }

    pub fn is_job_creation_paused(env: Env) -> bool {
        admin::is_job_creation_paused(&env)
    }

    pub fn pause_contract(env: Env) -> Result<(), Error> {
        Ok(admin::set_contract_paused(&env, true)?)
    }

    pub fn unpause_contract(env: Env) -> Result<(), Error> {
        Ok(admin::set_contract_paused(&env, false)?)
    }

    pub fn is_contract_paused(env: Env) -> bool {
        admin::is_contract_paused(&env)
    }

    /// Owner deletes a settled escrow and everything stored under it.
    pub fn delete_escrow(env: Env, escrow_id: u32) -> Result<(), Error> {
        Ok(admin::delete_escrow(&env, escrow_id)?)
    }
}
