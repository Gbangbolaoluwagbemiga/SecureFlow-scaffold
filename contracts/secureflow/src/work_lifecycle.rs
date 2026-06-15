use crate::admin;
use crate::escrow_core;
use crate::storage_types::{
    DataKey, EscrowStatus, MilestoneStatus, Milestone, SecureFlowError,
    INSTANCE_BUMP_AMOUNT, INSTANCE_LIFETIME_THRESHOLD,
};
use soroban_sdk::{token, Address, Env, String, Vec, Error};

#[allow(dead_code)]
const DISPUTE_PERIOD: u32 = 604800; // 7 days in seconds
const REPUTATION_PER_MILESTONE: u32 = 10;
const REPUTATION_PER_ESCROW: u32 = 25;
const MIN_REP_ELIGIBLE_ESCROW_VALUE: i128 = 1_000_000; // 0.1 tokens (7 decimal places)

pub fn start_work(env: &Env, escrow_id: u32, beneficiary: Address) -> Result<(), Error> {
    beneficiary.require_auth();
    admin::require_not_paused(env)?;

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let mut escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.beneficiary != Some(beneficiary.clone()) {
        return Err(Error::from_contract_error(SecureFlowError::OnlyBeneficiary as u32));
    }

    if escrow.status != EscrowStatus::Pending {
        return Err(Error::from_contract_error(SecureFlowError::InvalidEscrowStatus as u32));
    }

    if escrow.work_started {
        return Err(Error::from_contract_error(SecureFlowError::WorkAlreadyStarted as u32));
    }

    escrow.work_started = true;
    escrow.status = EscrowStatus::InProgress;

    // Update platform fees
    if escrow.platform_fee > 0 {
        let token_key = escrow.token.clone().unwrap_or(env.current_contract_address());
        let current_fees: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalFeesByToken(token_key.clone()))
            .unwrap_or(0);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
        env.storage()
            .instance()
            .set(
                &DataKey::TotalFeesByToken(token_key),
                &(current_fees + escrow.platform_fee),
            );
    }

    escrow_core::save_escrow(env, escrow_id, &escrow);
    Ok(())
}

pub fn submit_milestone(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    beneficiary: Address,
    description: String,
) -> Result<(), Error> {
    beneficiary.require_auth();
    admin::require_not_paused(env)?;

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.beneficiary != Some(beneficiary.clone()) {
        return Err(Error::from_contract_error(SecureFlowError::OnlyBeneficiary as u32));
    }

    if escrow.status != EscrowStatus::InProgress {
        return Err(Error::from_contract_error(SecureFlowError::InvalidEscrowStatus as u32));
    }

    if milestone_index >= escrow.milestone_count {
        return Err(Error::from_contract_error(SecureFlowError::InvalidMilestone as u32));
    }

    // Get milestone
    let mut milestone: crate::storage_types::Milestone = env
        .storage()
        .instance()
        .get::<DataKey, crate::storage_types::Milestone>(&DataKey::Milestone(escrow_id, milestone_index))
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::InvalidMilestone as u32))?;

    if milestone.status != MilestoneStatus::NotStarted {
        return Err(Error::from_contract_error(SecureFlowError::MilestoneAlreadyProcessed as u32));
    }

    milestone.status = MilestoneStatus::Submitted;
    milestone.submitted_at = env.ledger().sequence();
    milestone.description = description;

    // Save milestone
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::Milestone(escrow_id, milestone_index), &milestone);
    
    Ok(())
}

pub fn approve_milestone(env: &Env, escrow_id: u32, milestone_index: u32, depositor: Address) -> Result<(), Error> {
    depositor.require_auth();
    admin::require_not_paused(env)?;

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let mut escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.depositor != depositor {
        return Err(Error::from_contract_error(SecureFlowError::OnlyDepositor as u32));
    }

    if escrow.status != EscrowStatus::InProgress {
        return Err(Error::from_contract_error(SecureFlowError::EscrowNotActive as u32));
    }

    if milestone_index >= escrow.milestone_count {
        return Err(Error::from_contract_error(SecureFlowError::InvalidMilestone as u32));
    }

    // Get milestone
    let mut milestone: crate::storage_types::Milestone = env
        .storage()
        .instance()
        .get::<DataKey, crate::storage_types::Milestone>(&DataKey::Milestone(escrow_id, milestone_index))
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::InvalidMilestone as u32))?;

    if milestone.status != MilestoneStatus::Submitted {
        return Err(Error::from_contract_error(SecureFlowError::MilestoneNotSubmitted as u32));
    }

    let amount = milestone.amount;
    milestone.status = MilestoneStatus::Approved;
    milestone.approved_at = env.ledger().sequence();

    // Get beneficiary address before moving
    let beneficiary_addr = escrow.beneficiary.clone().unwrap();
    
    // Update escrow
    escrow.paid_amount += amount;
    
    // Update escrowed amount
    let token_key = escrow.token.as_ref().map(|t| t.clone()).unwrap_or_else(|| env.current_contract_address());
    let current_escrowed: i128 = env
        .storage()
        .instance()
        .get(&DataKey::EscrowedAmount(token_key.clone()))
        .unwrap_or(0);
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(
            &DataKey::EscrowedAmount(token_key),
            &(current_escrowed - amount),
        );

    // Transfer funds to beneficiary
    if let Some(token_addr) = &escrow.token {
        let token_client = token::Client::new(env, &token_addr);
        token_client.transfer(
            &env.current_contract_address(),
            &beneficiary_addr,
            &amount,
        );
    } else {
        // Transfer native XLM using Stellar Asset Contract (SAC)
        let native_token_str = String::from_str(env, "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
        let native_token_address = Address::from_string(&native_token_str);
        let native_token_client = token::Client::new(env, &native_token_address);
        native_token_client.transfer(
            &env.current_contract_address(),
            &beneficiary_addr,
            &amount,
        );
    }

    // Update reputation
    if escrow.total_amount >= MIN_REP_ELIGIBLE_ESCROW_VALUE {
        update_reputation(env, beneficiary_addr.clone(), REPUTATION_PER_MILESTONE);
    }

    // Check if escrow is complete
    if escrow.paid_amount == escrow.total_amount {
        escrow.status = EscrowStatus::Released;
        if escrow.total_amount >= MIN_REP_ELIGIBLE_ESCROW_VALUE {
            update_reputation(env, beneficiary_addr.clone(), REPUTATION_PER_ESCROW);
            update_reputation(env, escrow.depositor.clone(), REPUTATION_PER_ESCROW);
            
            // Update completed escrows count
            let beneficiary_completed: u32 = env
                .storage()
                .instance()
                .get(&DataKey::CompletedEscrows(beneficiary_addr.clone()))
                .unwrap_or(0);
            env.storage()
                .instance()
                .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
            env.storage()
                .instance()
                .set(
                    &DataKey::CompletedEscrows(beneficiary_addr.clone()),
                    &(beneficiary_completed + 1),
                );
            
            let depositor_completed: u32 = env
                .storage()
                .instance()
                .get(&DataKey::CompletedEscrows(escrow.depositor.clone()))
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(
                    &DataKey::CompletedEscrows(escrow.depositor.clone()),
                    &(depositor_completed + 1),
                );
        }
    }

    // Save milestone and escrow
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::Milestone(escrow_id, milestone_index), &milestone);
    escrow_core::save_escrow(env, escrow_id, &escrow);
    
    Ok(())
}

pub fn reject_milestone(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    reason: String,
    depositor: Address,
) -> Result<(), Error> {
    depositor.require_auth();
    admin::require_not_paused(env)?;

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.depositor != depositor {
        return Err(Error::from_contract_error(SecureFlowError::OnlyDepositor as u32));
    }

    if escrow.status != EscrowStatus::InProgress {
        return Err(Error::from_contract_error(SecureFlowError::EscrowNotActive as u32));
    }

    if milestone_index >= escrow.milestone_count {
        return Err(Error::from_contract_error(SecureFlowError::InvalidMilestone as u32));
    }

    // Get milestone
    let mut milestone: crate::storage_types::Milestone = env
        .storage()
        .instance()
        .get::<DataKey, crate::storage_types::Milestone>(&DataKey::Milestone(escrow_id, milestone_index))
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::InvalidMilestone as u32))?;

    if milestone.status != MilestoneStatus::Submitted {
        return Err(Error::from_contract_error(SecureFlowError::MilestoneNotSubmitted as u32));
    }

    // Update milestone status to Rejected
    milestone.status = MilestoneStatus::Rejected;
    milestone.rejection_reason = Some(reason);

    // Save milestone
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::Milestone(escrow_id, milestone_index), &milestone);
    
    Ok(())
}

pub fn resubmit_milestone(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    beneficiary: Address,
    description: String,
) -> Result<(), Error> {
    beneficiary.require_auth();
    admin::require_not_paused(env)?;

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.beneficiary != Some(beneficiary.clone()) {
        return Err(Error::from_contract_error(SecureFlowError::OnlyBeneficiary as u32));
    }

    if escrow.status != EscrowStatus::InProgress {
        return Err(Error::from_contract_error(SecureFlowError::InvalidEscrowStatus as u32));
    }

    if milestone_index >= escrow.milestone_count {
        return Err(Error::from_contract_error(SecureFlowError::InvalidMilestone as u32));
    }

    // Get milestone
    let mut milestone: crate::storage_types::Milestone = env
        .storage()
        .instance()
        .get::<DataKey, crate::storage_types::Milestone>(&DataKey::Milestone(escrow_id, milestone_index))
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::InvalidMilestone as u32))?;

    // Only allow resubmission if milestone is Rejected
    if milestone.status != MilestoneStatus::Rejected {
        return Err(Error::from_contract_error(SecureFlowError::MilestoneAlreadyProcessed as u32));
    }

    // Update milestone status to Submitted and update description
    milestone.status = MilestoneStatus::Submitted;
    milestone.submitted_at = env.ledger().sequence();
    milestone.description = description;
    // Clear rejection reason when resubmitting
    milestone.rejection_reason = None;

    // Save milestone
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::Milestone(escrow_id, milestone_index), &milestone);
    
    Ok(())
}

pub fn dispute_milestone(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    reason: String,
    disputer: Address,
) -> Result<(), Error> {
    disputer.require_auth();
    admin::require_not_paused(env)?;

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let mut escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    // Check if disputer is either depositor or beneficiary
    let is_depositor = escrow.depositor == disputer;
    let is_beneficiary = escrow.beneficiary == Some(disputer.clone());
    
    if !is_depositor && !is_beneficiary {
        return Err(Error::from_contract_error(SecureFlowError::OnlyDepositor as u32)); // Use OnlyDepositor as generic error for unauthorized
    }

    if escrow.status != EscrowStatus::InProgress {
        return Err(Error::from_contract_error(SecureFlowError::EscrowNotActive as u32));
    }

    if milestone_index >= escrow.milestone_count {
        return Err(Error::from_contract_error(SecureFlowError::InvalidMilestone as u32));
    }

    // Get milestone
    let mut milestone: crate::storage_types::Milestone = env
        .storage()
        .instance()
        .get::<DataKey, crate::storage_types::Milestone>(&DataKey::Milestone(escrow_id, milestone_index))
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::InvalidMilestone as u32))?;

    // Can dispute submitted or rejected milestones (matches Arc behaviour)
    if milestone.status != MilestoneStatus::Submitted && milestone.status != MilestoneStatus::Rejected {
        return Err(Error::from_contract_error(SecureFlowError::MilestoneNotSubmitted as u32));
    }

    // Update milestone status to Disputed
    milestone.status = MilestoneStatus::Disputed;
    milestone.disputed_at = env.ledger().sequence();
    milestone.disputed_by = Some(disputer.clone());
    milestone.dispute_reason = Some(reason);

    // Update escrow status to Disputed
    escrow.status = EscrowStatus::Disputed;

    // Save milestone and escrow
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::Milestone(escrow_id, milestone_index), &milestone);
    escrow_core::save_escrow(env, escrow_id, &escrow);
    
    Ok(())
}

fn update_reputation(env: &Env, user: Address, points: u32) {
    let current_rep: u32 = env
        .storage()
        .instance()
        .get(&DataKey::Reputation(user.clone()))
        .unwrap_or(0);
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::Reputation(user), &(current_rep + points));
}

/// Get a milestone by escrow_id and milestone_index
pub fn get_milestone(env: &Env, escrow_id: u32, milestone_index: u32) -> Option<Milestone> {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .get::<DataKey, Milestone>(&DataKey::Milestone(escrow_id, milestone_index))
}

// ─── Milestone negotiation ────────────────────────────────────────────────────

/// Freelancer proposes a change to a milestone's amount and/or description.
/// The milestone must be NotStarted. Client must then approve or reject.
pub fn propose_milestone_change(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    proposed_amount: i128,
    proposed_description: String,
    freelancer: Address,
) -> Result<(), Error> {
    freelancer.require_auth();
    admin::require_not_paused(env)?;

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.beneficiary != Some(freelancer.clone()) {
        return Err(Error::from_contract_error(SecureFlowError::OnlyBeneficiary as u32));
    }
    if escrow.status != EscrowStatus::InProgress && escrow.status != EscrowStatus::Pending {
        return Err(Error::from_contract_error(SecureFlowError::EscrowNotActive as u32));
    }
    if milestone_index >= escrow.milestone_count {
        return Err(Error::from_contract_error(SecureFlowError::InvalidMilestone as u32));
    }
    if proposed_amount <= 0 {
        return Err(Error::from_contract_error(SecureFlowError::InvalidAmount as u32));
    }

    let mut milestone: Milestone = env
        .storage()
        .instance()
        .get::<DataKey, Milestone>(&DataKey::Milestone(escrow_id, milestone_index))
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::InvalidMilestone as u32))?;

    if milestone.status != MilestoneStatus::NotStarted {
        return Err(Error::from_contract_error(SecureFlowError::MilestoneAlreadyProcessed as u32));
    }

    milestone.proposed_amount = proposed_amount;
    milestone.proposed_description = Some(proposed_description);
    milestone.status = MilestoneStatus::ProposalPending;

    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::Milestone(escrow_id, milestone_index), &milestone);
    Ok(())
}

/// Client approves a freelancer's milestone change proposal.
pub fn approve_milestone_proposal(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    depositor: Address,
) -> Result<(), Error> {
    depositor.require_auth();
    admin::require_not_paused(env)?;

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.depositor != depositor {
        return Err(Error::from_contract_error(SecureFlowError::OnlyDepositor as u32));
    }
    if milestone_index >= escrow.milestone_count {
        return Err(Error::from_contract_error(SecureFlowError::InvalidMilestone as u32));
    }

    let mut milestone: Milestone = env
        .storage()
        .instance()
        .get::<DataKey, Milestone>(&DataKey::Milestone(escrow_id, milestone_index))
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::InvalidMilestone as u32))?;

    if milestone.status != MilestoneStatus::ProposalPending {
        return Err(Error::from_contract_error(SecureFlowError::NoPendingProposal as u32));
    }

    milestone.amount = milestone.proposed_amount;
    if let Some(desc) = milestone.proposed_description.clone() {
        milestone.description = desc;
    }
    milestone.status = MilestoneStatus::NotStarted;
    milestone.proposed_amount = 0;
    milestone.proposed_description = None;

    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::Milestone(escrow_id, milestone_index), &milestone);
    Ok(())
}

/// Client rejects a freelancer's milestone change proposal. Milestone reverts to NotStarted.
pub fn reject_milestone_proposal(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    depositor: Address,
) -> Result<(), Error> {
    depositor.require_auth();
    admin::require_not_paused(env)?;

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.depositor != depositor {
        return Err(Error::from_contract_error(SecureFlowError::OnlyDepositor as u32));
    }
    if milestone_index >= escrow.milestone_count {
        return Err(Error::from_contract_error(SecureFlowError::InvalidMilestone as u32));
    }

    let mut milestone: Milestone = env
        .storage()
        .instance()
        .get::<DataKey, Milestone>(&DataKey::Milestone(escrow_id, milestone_index))
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::InvalidMilestone as u32))?;

    if milestone.status != MilestoneStatus::ProposalPending {
        return Err(Error::from_contract_error(SecureFlowError::NoPendingProposal as u32));
    }

    milestone.status = MilestoneStatus::NotStarted;
    milestone.proposed_amount = 0;
    milestone.proposed_description = None;

    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::Milestone(escrow_id, milestone_index), &milestone);
    Ok(())
}

// ─── Per-milestone multi-sig dispute resolution ───────────────────────────────

/// Authorized arbiter casts a resolution vote for a disputed milestone.
///
/// Once `escrow.required_confirmations` distinct arbiters have voted with the
/// same `freelancer_amount + client_amount == milestone.amount` split, the
/// resolution is executed: funds are paid out, the escrow resumes InProgress
/// (or Released if fully settled), and the vote counter is reset for any future
/// dispute on this escrow.
pub fn resolve_dispute(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    arbiter: Address,
    freelancer_amount: i128,
    client_amount: i128,
    reason: String,
) -> Result<(), Error> {
    arbiter.require_auth();

    if !escrow_core::is_authorized_arbiter(env, arbiter.clone()) {
        return Err(Error::from_contract_error(SecureFlowError::Unauthorized as u32));
    }

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let mut escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.status != EscrowStatus::Disputed {
        return Err(Error::from_contract_error(SecureFlowError::InvalidEscrowStatus as u32));
    }
    if milestone_index >= escrow.milestone_count {
        return Err(Error::from_contract_error(SecureFlowError::InvalidMilestone as u32));
    }

    let mut milestone: Milestone = env
        .storage()
        .instance()
        .get::<DataKey, Milestone>(&DataKey::Milestone(escrow_id, milestone_index))
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::InvalidMilestone as u32))?;

    if freelancer_amount < 0 || client_amount < 0 || freelancer_amount + client_amount != milestone.amount {
        return Err(Error::from_contract_error(SecureFlowError::InvalidAmount as u32));
    }

    // Record this arbiter's vote (idempotent — duplicate calls don't add extra votes)
    let vote_key = DataKey::DisputeVote(escrow_id, arbiter.clone());
    let already_voted: bool = env.storage().instance().get(&vote_key).unwrap_or(false);
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);

    if !already_voted {
        env.storage().instance().set(&vote_key, &true);
        let prev_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::DisputeVoteCount(escrow_id))
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::DisputeVoteCount(escrow_id), &(prev_count + 1));
    }

    let vote_count: u32 = env
        .storage()
        .instance()
        .get(&DataKey::DisputeVoteCount(escrow_id))
        .unwrap_or(0);

    // Not enough confirmations yet — nothing else to do
    if vote_count < escrow.required_confirmations {
        return Ok(());
    }

    // ── Execute resolution ────────────────────────────────────────────────────

    milestone.status = MilestoneStatus::Resolved;
    milestone.resolved_at = env.ledger().sequence();
    milestone.resolved_by = Some(arbiter.clone());
    milestone.resolution_freelancer_amount = freelancer_amount;
    milestone.resolution_client_amount = client_amount;
    milestone.resolution_reason = Some(reason);

    // Deduct the full milestone amount from escrowed tracking
    let token_key = escrow.token.clone().unwrap_or_else(|| env.current_contract_address());
    let current_escrowed: i128 = env
        .storage()
        .instance()
        .get(&DataKey::EscrowedAmount(token_key.clone()))
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::EscrowedAmount(token_key), &(current_escrowed - milestone.amount));

    // Adjust escrow accounting: freelancer share counts as paid, client refund reduces total
    escrow.paid_amount += freelancer_amount;
    if client_amount > 0 {
        escrow.total_amount = escrow.total_amount.saturating_sub(client_amount);
    }

    // Pay out
    let beneficiary = escrow
        .beneficiary
        .clone()
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::InvalidAddress as u32))?;
    escrow_core::do_transfer(env, &escrow.token, &beneficiary, freelancer_amount);
    escrow_core::do_transfer(env, &escrow.token, &escrow.depositor.clone(), client_amount);

    // Determine new escrow status
    let net_total = escrow.total_amount.saturating_sub(escrow.platform_fee);
    if escrow.paid_amount >= net_total {
        escrow.status = EscrowStatus::Released;
        if escrow.total_amount >= MIN_REP_ELIGIBLE_ESCROW_VALUE {
            update_reputation(env, beneficiary.clone(), REPUTATION_PER_ESCROW);
            update_reputation(env, escrow.depositor.clone(), REPUTATION_PER_ESCROW);
            let bc: u32 = env.storage().instance().get(&DataKey::CompletedEscrows(beneficiary.clone())).unwrap_or(0);
            env.storage().instance().set(&DataKey::CompletedEscrows(beneficiary), &(bc + 1));
            let dc: u32 = env.storage().instance().get(&DataKey::CompletedEscrows(escrow.depositor.clone())).unwrap_or(0);
            env.storage().instance().set(&DataKey::CompletedEscrows(escrow.depositor.clone()), &(dc + 1));
        }
    } else {
        escrow.status = EscrowStatus::InProgress;
    }

    // Reset vote count so future disputes on this escrow start fresh
    env.storage()
        .instance()
        .set(&DataKey::DisputeVoteCount(escrow_id), &0u32);

    env.storage()
        .instance()
        .set(&DataKey::Milestone(escrow_id, milestone_index), &milestone);
    escrow_core::save_escrow(env, escrow_id, &escrow);
    Ok(())
}

/// Get all milestones for an escrow
pub fn get_milestones(env: &Env, escrow_id: u32) -> Vec<Milestone> {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    
    // Get escrow to know milestone count
    if let Some(escrow) = escrow_core::get_escrow(env, escrow_id) {
        let milestone_count = escrow.milestone_count;
        let mut milestones = Vec::new(env);
        
        // Get all milestones
        for i in 0..milestone_count {
            if let Some(milestone) = env.storage().instance().get::<DataKey, Milestone>(&DataKey::Milestone(escrow_id, i)) {
                milestones.push_back(milestone);
            }
        }
        
        milestones
    } else {
        Vec::new(env)
    }
}

