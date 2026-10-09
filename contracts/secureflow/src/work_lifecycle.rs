//! A job in progress: starting, delivering, reviewing, negotiating, disputing.

use crate::admin;
use crate::escrow_core::{self as core, add, sub};
use crate::events;
use crate::storage_types::{
    DataKey, EscrowData, EscrowStatus, MilestoneStatus, SecureFlowError, SfResult,
};
use soroban_sdk::{Address, Env, String, Vec};

fn load_active(env: &Env, escrow_id: u32) -> SfResult<EscrowData> {
    admin::require_not_paused(env)?;
    let escrow = core::load_escrow(env, escrow_id)?;
    if escrow.status != EscrowStatus::InProgress {
        return Err(SecureFlowError::EscrowNotActive);
    }
    Ok(escrow)
}

fn beneficiary_of(escrow: &EscrowData) -> SfResult<Address> {
    escrow
        .beneficiary
        .clone()
        .ok_or(SecureFlowError::NoBeneficiary)
}

// ─── Start & deliver ─────────────────────────────────────────────────────────

pub fn start_work(env: &Env, escrow_id: u32, beneficiary: Address) -> SfResult<()> {
    beneficiary.require_auth();
    admin::require_not_paused(env)?;
    let mut escrow = core::load_escrow(env, escrow_id)?;
    core::require_beneficiary(&escrow, &beneficiary)?;
    if escrow.status != EscrowStatus::Pending {
        return Err(SecureFlowError::InvalidEscrowStatus);
    }
    if escrow.work_started {
        return Err(SecureFlowError::WorkAlreadyStarted);
    }
    // The old version credited the platform fee to the fee pot HERE, while
    // still paying every milestone in full later. The fee was counted twice —
    // once as revenue, once inside the client's principal — so withdrawing
    // fees left the contract short of what the last milestones owed. The fee
    // is now earned only when the job settles (`finalize_if_complete`).
    escrow.work_started = true;
    escrow.status = EscrowStatus::InProgress;
    core::save_escrow(env, escrow_id, &escrow);
    events::WorkStarted {
        escrow_id,
        depositor: escrow.depositor,
        beneficiary,
    }
    .publish(env);
    Ok(())
}

/// Deliver a milestone, or redeliver one the client rejected.
pub fn submit_milestone(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    beneficiary: Address,
    description: String,
) -> SfResult<()> {
    beneficiary.require_auth();
    let escrow = load_active(env, escrow_id)?;
    core::require_beneficiary(&escrow, &beneficiary)?;
    let mut m = core::load_milestone(env, &escrow, escrow_id, milestone_index)?;
    match m.status {
        MilestoneStatus::NotStarted | MilestoneStatus::Rejected => {}
        MilestoneStatus::Submitted => return Err(SecureFlowError::MilestoneAlreadySubmitted),
        _ => return Err(SecureFlowError::MilestoneAlreadyProcessed),
    }
    m.status = MilestoneStatus::Submitted;
    m.submitted_at = env.ledger().sequence();
    m.description = description.clone();
    m.rejection_reason = None;
    core::save_milestone(env, escrow_id, milestone_index, &m);
    events::MilestoneSubmitted {
        escrow_id,
        milestone_index,
        depositor: escrow.depositor,
        beneficiary,
        description,
    }
    .publish(env);
    Ok(())
}

/// Redeliver a rejected milestone. Kept for existing callers;
/// `submit_milestone` accepts rejected milestones too.
pub fn resubmit_milestone(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    beneficiary: Address,
    description: String,
) -> SfResult<()> {
    let escrow = core::load_escrow(env, escrow_id)?;
    let m = core::load_milestone(env, &escrow, escrow_id, milestone_index)?;
    if m.status != MilestoneStatus::Rejected {
        return Err(SecureFlowError::MilestoneNotRejected);
    }
    submit_milestone(env, escrow_id, milestone_index, beneficiary, description)
}

// ─── Review ──────────────────────────────────────────────────────────────────

/// Approve a delivered milestone and pay the freelancer.
///
/// `caller` is the client or their job manager. Payment goes to the freelancer
/// either way — a manager approving is paying the freelancer by construction,
/// never itself.
pub fn approve_milestone(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    caller: Address,
) -> SfResult<()> {
    caller.require_auth();
    let mut escrow = load_active(env, escrow_id)?;
    core::require_depositor_or_manager(env, &escrow, escrow_id, &caller)?;
    let beneficiary = beneficiary_of(&escrow)?;
    let mut m = core::load_milestone(env, &escrow, escrow_id, milestone_index)?;
    if m.status != MilestoneStatus::Submitted {
        return Err(SecureFlowError::MilestoneNotSubmitted);
    }

    let amount = m.amount;
    m.status = MilestoneStatus::Approved;
    m.approved_at = env.ledger().sequence();
    escrow.paid_amount = add(escrow.paid_amount, amount)?;

    core::save_milestone(env, escrow_id, milestone_index, &m);
    core::liabilities_sub(env, escrow.token.as_ref(), amount)?;
    core::pay_out(env, escrow.token.as_ref(), &beneficiary, amount)?;
    core::reward_milestone(env, &escrow, &beneficiary);
    events::MilestoneApproved {
        escrow_id,
        milestone_index,
        beneficiary,
        amount,
        approved_by: caller,
    }
    .publish(env);

    core::finalize_if_complete(env, escrow_id, &mut escrow)?;
    core::save_escrow(env, escrow_id, &escrow);
    Ok(())
}

/// Send a delivered milestone back for revision. Moves no money.
pub fn reject_milestone(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    reason: String,
    caller: Address,
) -> SfResult<()> {
    caller.require_auth();
    let escrow = load_active(env, escrow_id)?;
    core::require_depositor_or_manager(env, &escrow, escrow_id, &caller)?;
    let beneficiary = beneficiary_of(&escrow)?;
    let mut m = core::load_milestone(env, &escrow, escrow_id, milestone_index)?;
    if m.status != MilestoneStatus::Submitted {
        return Err(SecureFlowError::MilestoneNotSubmitted);
    }
    m.status = MilestoneStatus::Rejected;
    m.rejection_reason = Some(reason.clone());
    core::save_milestone(env, escrow_id, milestone_index, &m);
    events::MilestoneRejected {
        escrow_id,
        milestone_index,
        beneficiary,
        reason,
        rejected_by: caller,
    }
    .publish(env);
    Ok(())
}

/// Escalate a delivered or rejected milestone to arbitration.
///
/// The client, the freelancer, or the job manager may escalate. The manager's
/// right to is not a widening of its powers: when its revision rounds run out
/// its only other moves are to approve work it judged inadequate or reject it
/// for ever. An arbiter can award only the freelancer or the client, so
/// escalating hands the decision away rather than taking it.
pub fn dispute_milestone(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    reason: String,
    disputer: Address,
) -> SfResult<()> {
    disputer.require_auth();
    let mut escrow = load_active(env, escrow_id)?;
    if !core::is_party(env, &escrow, escrow_id, &disputer) {
        return Err(SecureFlowError::OnlyParticipant);
    }
    let beneficiary = beneficiary_of(&escrow)?;
    let mut m = core::load_milestone(env, &escrow, escrow_id, milestone_index)?;
    if m.status != MilestoneStatus::Submitted && m.status != MilestoneStatus::Rejected {
        return Err(SecureFlowError::MilestoneNotSubmitted);
    }

    m.status = MilestoneStatus::Disputed;
    m.disputed_at = env.ledger().sequence();
    m.disputed_by = Some(disputer.clone());
    m.dispute_reason = Some(reason.clone());
    escrow.status = EscrowStatus::Disputed;
    core::save_milestone(env, escrow_id, milestone_index, &m);
    core::save_escrow(env, escrow_id, &escrow);
    core::p_remove(env, &DataKey::DisputeVoters(escrow_id));

    let counterparty = if disputer == beneficiary {
        escrow.depositor.clone()
    } else {
        beneficiary
    };
    events::MilestoneDisputed {
        escrow_id,
        milestone_index,
        counterparty,
        disputer,
        reason,
    }
    .publish(env);
    Ok(())
}

// ─── Negotiation ─────────────────────────────────────────────────────────────

/// The freelancer proposes a different scope and/or price for a milestone
/// nobody has delivered yet.
pub fn propose_milestone_change(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    proposed_amount: i128,
    proposed_description: String,
    freelancer: Address,
) -> SfResult<()> {
    freelancer.require_auth();
    admin::require_not_paused(env)?;
    let escrow = core::load_escrow(env, escrow_id)?;
    core::require_beneficiary(&escrow, &freelancer)?;
    if escrow.status != EscrowStatus::InProgress && escrow.status != EscrowStatus::Pending {
        return Err(SecureFlowError::EscrowNotActive);
    }
    if proposed_amount <= 0 {
        return Err(SecureFlowError::InvalidAmount);
    }
    let mut m = core::load_milestone(env, &escrow, escrow_id, milestone_index)?;
    if m.status != MilestoneStatus::NotStarted {
        return Err(SecureFlowError::MilestoneAlreadyProcessed);
    }
    m.proposed_amount = proposed_amount;
    m.proposed_description = Some(proposed_description.clone());
    m.status = MilestoneStatus::ProposalPending;
    core::save_milestone(env, escrow_id, milestone_index, &m);
    events::MilestoneProposalSubmitted {
        escrow_id,
        milestone_index,
        depositor: escrow.depositor,
        proposed_amount,
        proposed_description,
    }
    .publish(env);
    Ok(())
}

/// The client accepts a proposed change. A price change MOVES MONEY in the
/// same call: a raise is collected from the client (plus fee share), a cut is
/// refunded to them (plus fee share).
///
/// The old version wrote the new amount onto the milestone without touching
/// any token or the escrow total. The milestones then no longer matched the
/// money, `paid == total` could never be reached, and the escrow could never
/// complete — on a job where both sides only did what the UI offered.
pub fn approve_milestone_proposal(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    depositor: Address,
) -> SfResult<()> {
    depositor.require_auth();
    admin::require_not_paused(env)?;
    let mut escrow = core::load_escrow(env, escrow_id)?;
    core::require_depositor(&escrow, &depositor)?;
    if escrow.status != EscrowStatus::InProgress && escrow.status != EscrowStatus::Pending {
        return Err(SecureFlowError::InvalidEscrowStatus);
    }
    let beneficiary = beneficiary_of(&escrow)?;
    let mut m = core::load_milestone(env, &escrow, escrow_id, milestone_index)?;
    if m.status != MilestoneStatus::ProposalPending {
        return Err(SecureFlowError::NoPendingProposal);
    }

    let old_amount = m.amount;
    let new_amount = m.proposed_amount;
    if new_amount > old_amount {
        let delta = sub(new_amount, old_amount)?;
        let fee = core::fee_share(&escrow, delta)?;
        let deposit = add(delta, fee)?;
        core::pull_in(env, escrow.token.as_ref(), &depositor, deposit)?;
        core::liabilities_add(env, escrow.token.as_ref(), deposit)?;
        escrow.total_amount = add(escrow.total_amount, delta)?;
        escrow.platform_fee = add(escrow.platform_fee, fee)?;
    } else if new_amount < old_amount {
        let delta = sub(old_amount, new_amount)?;
        let fee = core::fee_share(&escrow, delta)?;
        let refund = add(delta, fee)?;
        escrow.total_amount = sub(escrow.total_amount, delta)?;
        escrow.platform_fee = sub(escrow.platform_fee, fee)?;
        core::liabilities_sub(env, escrow.token.as_ref(), refund)?;
        core::pay_out(env, escrow.token.as_ref(), &depositor, refund)?;
    }

    m.amount = new_amount;
    if let Some(desc) = m.proposed_description.clone() {
        m.description = desc;
    }
    m.status = MilestoneStatus::NotStarted;
    m.proposed_amount = 0;
    m.proposed_description = None;
    core::save_milestone(env, escrow_id, milestone_index, &m);
    core::save_escrow(env, escrow_id, &escrow);
    events::MilestoneProposalApproved {
        escrow_id,
        milestone_index,
        beneficiary,
        new_amount,
    }
    .publish(env);
    Ok(())
}

pub fn reject_milestone_proposal(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    depositor: Address,
) -> SfResult<()> {
    depositor.require_auth();
    admin::require_not_paused(env)?;
    let escrow = core::load_escrow(env, escrow_id)?;
    core::require_depositor(&escrow, &depositor)?;
    let beneficiary = beneficiary_of(&escrow)?;
    let mut m = core::load_milestone(env, &escrow, escrow_id, milestone_index)?;
    if m.status != MilestoneStatus::ProposalPending {
        return Err(SecureFlowError::NoPendingProposal);
    }
    m.status = MilestoneStatus::NotStarted;
    m.proposed_amount = 0;
    m.proposed_description = None;
    core::save_milestone(env, escrow_id, milestone_index, &m);
    events::MilestoneProposalRejected {
        escrow_id,
        milestone_index,
        beneficiary,
    }
    .publish(env);
    Ok(())
}

// ─── Arbitration ─────────────────────────────────────────────────────────────

/// Record `arbiter`'s vote for one outcome and return how many CURRENTLY
/// authorised arbiters have voted for that same outcome.
///
/// Votes are keyed by the split they endorse, so quorum is agreement on an
/// outcome, not attendance: two arbiters proposing opposite splits no longer
/// reach quorum between them with the money moving on whoever called last.
/// An arbiter who changes their mind simply votes on a different split.
pub fn cast_vote(
    env: &Env,
    escrow_id: u32,
    index: u32,
    freelancer_amount: i128,
    client_amount: i128,
    arbiter: &Address,
) -> u32 {
    let key = DataKey::ResolutionVotes(escrow_id, index, freelancer_amount, client_amount);
    let mut voters: Vec<Address> = core::p_get(env, &key).unwrap_or(Vec::new(env));
    if !voters.contains(arbiter) {
        voters.push_back(arbiter.clone());
        core::p_set(env, &key, &voters);
    }

    let round_key = DataKey::DisputeVoters(escrow_id);
    let mut round: Vec<Address> = core::p_get(env, &round_key).unwrap_or(Vec::new(env));
    if !round.contains(arbiter) {
        round.push_back(arbiter.clone());
        core::p_set(env, &round_key, &round);
    }

    // Revoking an arbiter mid-dispute withdraws their vote too.
    voters.iter().fold(0u32, |n, v| {
        n + u32::from(core::is_authorized_arbiter(env, &v))
    })
}

/// Tidy up after a ruling executes.
pub fn close_vote(
    env: &Env,
    escrow_id: u32,
    index: u32,
    freelancer_amount: i128,
    client_amount: i128,
) {
    core::p_remove(
        env,
        &DataKey::ResolutionVotes(escrow_id, index, freelancer_amount, client_amount),
    );
    core::p_remove(env, &DataKey::DisputeVoters(escrow_id));
    core::p_set(env, &DataKey::Arbitrated(escrow_id), &true);
}

/// An arbiter votes to settle one milestone of a disputed escrow, splitting
/// its amount between freelancer and client. The ruling executes once
/// `quorum` arbiters have voted for the same split.
///
/// The milestone need not itself be Disputed — an overdue dispute marks only
/// the escrow — but it must not already be paid: otherwise an arbiter ruling
/// on milestone 2 could pass index 0, already approved, and pay it twice out
/// of money belonging to the rest of the job.
pub fn resolve_dispute(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    arbiter: Address,
    freelancer_amount: i128,
    client_amount: i128,
    reason: String,
) -> SfResult<()> {
    arbiter.require_auth();
    let mut escrow = core::load_escrow(env, escrow_id)?;
    if escrow.status != EscrowStatus::Disputed {
        return Err(SecureFlowError::InvalidEscrowStatus);
    }
    if reason.is_empty() {
        return Err(SecureFlowError::ReasonRequired);
    }
    core::require_arbiter_for(env, &escrow, escrow_id, &arbiter)?;
    let beneficiary = beneficiary_of(&escrow)?;
    let mut m = core::load_milestone(env, &escrow, escrow_id, milestone_index)?;
    if m.status == MilestoneStatus::Approved || m.status == MilestoneStatus::Resolved {
        return Err(SecureFlowError::MilestoneAlreadySettled);
    }
    if freelancer_amount < 0
        || client_amount < 0
        || add(freelancer_amount, client_amount)? != m.amount
    {
        return Err(SecureFlowError::ResolutionSplitMismatch);
    }

    let votes = cast_vote(
        env,
        escrow_id,
        milestone_index,
        freelancer_amount,
        client_amount,
        &arbiter,
    );
    let required = core::quorum(env, &escrow);
    events::DisputeVoteCast {
        escrow_id,
        milestone_index,
        arbiter: arbiter.clone(),
        freelancer_amount,
        client_amount,
        votes,
        required,
    }
    .publish(env);
    if votes < required {
        return Ok(());
    }

    // ── Execute ──
    // The client's share comes back with its share of the held fee: the
    // platform keeps a fee only on money that actually went to the freelancer.
    let fee_back = core::fee_share(&escrow, client_amount)?;
    m.status = MilestoneStatus::Resolved;
    m.resolved_at = env.ledger().sequence();
    m.resolved_by = Some(arbiter.clone());
    m.resolution_freelancer_amount = freelancer_amount;
    m.resolution_client_amount = client_amount;
    m.resolution_reason = Some(reason.clone());

    escrow.paid_amount = add(escrow.paid_amount, freelancer_amount)?;
    escrow.total_amount = sub(escrow.total_amount, client_amount)?;
    escrow.platform_fee = sub(escrow.platform_fee, fee_back)?;
    escrow.status = EscrowStatus::InProgress;

    core::save_milestone(env, escrow_id, milestone_index, &m);
    core::liabilities_sub(env, escrow.token.as_ref(), add(m.amount, fee_back)?)?;
    core::pay_out(env, escrow.token.as_ref(), &beneficiary, freelancer_amount)?;
    core::pay_out(
        env,
        escrow.token.as_ref(),
        &escrow.depositor,
        add(client_amount, fee_back)?,
    )?;
    if freelancer_amount > 0 {
        core::reward_milestone(env, &escrow, &beneficiary);
    }
    close_vote(
        env,
        escrow_id,
        milestone_index,
        freelancer_amount,
        client_amount,
    );
    core::p_remove(env, &DataKey::OverdueRequest(escrow_id));

    events::DisputeResolved {
        escrow_id,
        milestone_index,
        beneficiary,
        depositor: escrow.depositor.clone(),
        freelancer_amount,
        client_amount,
        resolved_by: arbiter,
        reason,
    }
    .publish(env);

    core::finalize_if_complete(env, escrow_id, &mut escrow)?;
    core::save_escrow(env, escrow_id, &escrow);
    Ok(())
}

pub fn get_milestone(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
) -> Option<crate::storage_types::Milestone> {
    core::get_milestone(env, escrow_id, milestone_index)
}

pub fn get_milestones(env: &Env, escrow_id: u32) -> Vec<crate::storage_types::Milestone> {
    core::get_milestones(env, escrow_id)
}
