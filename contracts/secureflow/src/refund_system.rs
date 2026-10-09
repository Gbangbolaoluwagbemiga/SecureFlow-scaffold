//! Deadlines, stalled jobs, and getting money back out of them.

use crate::admin;
use crate::escrow_core::{self as core, add, add_u32, sub};
use crate::events;
use crate::storage_types::{
    DataKey, EscrowStatus, MilestoneStatus, OverdueRequest, SecureFlowError, SfResult,
    EMERGENCY_REFUND_DELAY_LEDGERS, MAX_EXTENSION_SECONDS, OVERDUE_RESOLUTION_INDEX,
};
use crate::work_lifecycle;
use soroban_sdk::{symbol_short, Address, Env, String};

/// The client takes back everything still unpaid, once the deadline is 30
/// days behind them and nobody has a claim waiting.
///
/// The escape hatch for a job that STALLED, not a way to win an argument by
/// waiting: an open dispute, or delivered work nobody has reviewed, blocks it.
/// Otherwise a client could refuse to approve delivered work, sit out the
/// arbiter's deliberation, and reclaim the milestone the freelancer had
/// already delivered.
///
/// Deliberately not blocked by the emergency pause — it is the path that
/// returns money to its owner.
pub fn emergency_refund_after_deadline(
    env: &Env,
    escrow_id: u32,
    depositor: Address,
) -> SfResult<()> {
    depositor.require_auth();
    let mut escrow = core::load_escrow(env, escrow_id)?;
    core::require_depositor(&escrow, &depositor)?;

    // The old check compared a ledger number against deadline + 2,592,000
    // SECONDS treated as ledgers — about 150 days, not 30.
    let unlock = add_u32(escrow.deadline, EMERGENCY_REFUND_DELAY_LEDGERS)?;
    if env.ledger().sequence() <= unlock {
        return Err(SecureFlowError::EmergencyPeriodNotReached);
    }
    if core::is_terminal(&escrow.status) {
        return Err(SecureFlowError::CannotRefund);
    }
    if escrow.status == EscrowStatus::Disputed {
        return Err(SecureFlowError::RefundBlockedByDispute);
    }
    for i in 0..escrow.milestone_count {
        if let Some(m) = core::get_milestone(env, escrow_id, i) {
            if m.status == MilestoneStatus::Submitted {
                return Err(SecureFlowError::RefundBlockedBySubmittedWork);
            }
        }
    }

    let unpaid = sub(escrow.total_amount, escrow.paid_amount)?;
    if unpaid <= 0 {
        return Err(SecureFlowError::NothingToRefund);
    }
    // The platform keeps the fee share for work actually paid out, and gives
    // the rest back with the principal.
    let fee_back = core::fee_share(&escrow, unpaid)?;
    let fee_earned = sub(escrow.platform_fee, fee_back)?;
    let refund = add(unpaid, fee_back)?;

    escrow.status = EscrowStatus::Expired;
    escrow.platform_fee = 0;
    core::save_escrow(env, escrow_id, &escrow);
    core::liabilities_sub(env, escrow.token.as_ref(), add(refund, fee_earned)?)?;
    core::fees_credit(env, escrow.token.as_ref(), fee_earned)?;
    // The old version moved NOTHING for native-XLM escrows here (an empty
    // `else` branch) while still marking them refunded: the client's XLM
    // stayed in the contract for good.
    core::pay_out(env, escrow.token.as_ref(), &depositor, refund)?;

    events::EscrowRefunded {
        escrow_id,
        depositor,
        beneficiary: escrow.beneficiary,
        amount: refund,
        kind: symbol_short!("emergency"),
    }
    .publish(env);
    Ok(())
}

/// Push the deadline back by `extra_seconds` (1 second to 365 days).
pub fn extend_deadline(
    env: &Env,
    escrow_id: u32,
    depositor: Address,
    extra_seconds: u32,
) -> SfResult<()> {
    depositor.require_auth();
    admin::require_not_paused(env)?;
    if extra_seconds == 0 || extra_seconds > MAX_EXTENSION_SECONDS {
        return Err(SecureFlowError::InvalidExtension);
    }
    let mut escrow = core::load_escrow(env, escrow_id)?;
    core::require_depositor(&escrow, &depositor)?;
    if escrow.status != EscrowStatus::InProgress && escrow.status != EscrowStatus::Pending {
        return Err(SecureFlowError::CannotExtend);
    }
    let old_deadline = escrow.deadline;
    // Seconds converted to ledgers; the old code added raw seconds to a
    // ledger number, extending five times further than asked.
    escrow.deadline = add_u32(old_deadline, core::seconds_to_ledgers(extra_seconds))?;
    core::save_escrow(env, escrow_id, &escrow);
    events::DeadlineExtended {
        escrow_id,
        beneficiary: escrow.beneficiary,
        old_deadline,
        new_deadline: escrow.deadline,
    }
    .publish(env);
    Ok(())
}

/// Either side flags a job that ran past its deadline for an arbiter.
pub fn raise_overdue_dispute(
    env: &Env,
    escrow_id: u32,
    requester: Address,
    reason: String,
) -> SfResult<()> {
    requester.require_auth();
    admin::require_not_paused(env)?;
    let mut escrow = core::load_escrow(env, escrow_id)?;
    let beneficiary = escrow
        .beneficiary
        .clone()
        .ok_or(SecureFlowError::NoBeneficiary)?;
    let is_depositor = requester == escrow.depositor;
    if !is_depositor && requester != beneficiary {
        return Err(SecureFlowError::OnlyParticipant);
    }
    if env.ledger().sequence() <= escrow.deadline {
        return Err(SecureFlowError::DeadlineNotPassed);
    }
    match escrow.status {
        EscrowStatus::InProgress => {}
        EscrowStatus::Disputed => return Err(SecureFlowError::EscrowAlreadyDisputed),
        // Before work starts the client can simply cancel.
        EscrowStatus::Pending => return Err(SecureFlowError::WorkNotStarted),
        _ => return Err(SecureFlowError::CannotRefund),
    }

    escrow.status = EscrowStatus::Disputed;
    core::save_escrow(env, escrow_id, &escrow);
    core::p_remove(
        env,
        &crate::storage_types::DataKey::DisputeVoters(escrow_id),
    );
    core::p_set(
        env,
        &DataKey::OverdueRequest(escrow_id),
        &OverdueRequest {
            requester: requester.clone(),
            reason: reason.clone(),
            requested_at: env.ledger().sequence(),
        },
    );

    let counterparty = if is_depositor {
        beneficiary
    } else {
        escrow.depositor
    };
    events::OverdueDisputeRaised {
        escrow_id,
        counterparty,
        requester,
        reason,
    }
    .publish(env);
    Ok(())
}

/// An arbiter votes to settle a whole overdue escrow at once: `freelancer_amount`
/// of the unpaid balance to the freelancer, the rest back to the client.
/// Executes once `quorum` arbiters agree on the same split.
fn overdue_resolution(
    env: &Env,
    escrow_id: u32,
    arbiter: Address,
    freelancer_amount: i128,
) -> SfResult<()> {
    arbiter.require_auth();
    if !core::p_has(env, &DataKey::OverdueRequest(escrow_id)) {
        return Err(SecureFlowError::NoOverdueRequest);
    }
    let mut escrow = core::load_escrow(env, escrow_id)?;
    if escrow.status != EscrowStatus::Disputed {
        return Err(SecureFlowError::InvalidEscrowStatus);
    }
    core::require_arbiter_for(env, &escrow, escrow_id, &arbiter)?;
    let beneficiary = escrow
        .beneficiary
        .clone()
        .ok_or(SecureFlowError::NoBeneficiary)?;

    let available = sub(escrow.total_amount, escrow.paid_amount)?;
    if freelancer_amount < 0 || freelancer_amount > available {
        return Err(SecureFlowError::InvalidAmount);
    }
    let client_amount = sub(available, freelancer_amount)?;

    let votes = work_lifecycle::cast_vote(
        env,
        escrow_id,
        OVERDUE_RESOLUTION_INDEX,
        freelancer_amount,
        client_amount,
        &arbiter,
    );
    let required = core::quorum(env, &escrow);
    events::DisputeVoteCast {
        escrow_id,
        milestone_index: OVERDUE_RESOLUTION_INDEX,
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
    // Mark every unsettled milestone so the UI does not show work as still
    // pending on a closed job.
    let now = env.ledger().sequence();
    for i in 0..escrow.milestone_count {
        if let Some(mut m) = core::get_milestone(env, escrow_id, i) {
            if m.status != MilestoneStatus::Approved && m.status != MilestoneStatus::Resolved {
                m.status = MilestoneStatus::Resolved;
                m.resolved_at = now;
                m.resolved_by = Some(arbiter.clone());
                core::save_milestone(env, escrow_id, i, &m);
            }
        }
    }

    let fee_back = core::fee_share(&escrow, client_amount)?;
    escrow.paid_amount = add(escrow.paid_amount, freelancer_amount)?;
    escrow.total_amount = sub(escrow.total_amount, client_amount)?;
    escrow.platform_fee = sub(escrow.platform_fee, fee_back)?;
    core::liabilities_sub(env, escrow.token.as_ref(), add(available, fee_back)?)?;
    core::pay_out(env, escrow.token.as_ref(), &beneficiary, freelancer_amount)?;
    core::pay_out(
        env,
        escrow.token.as_ref(),
        &escrow.depositor,
        add(client_amount, fee_back)?,
    )?;
    work_lifecycle::close_vote(
        env,
        escrow_id,
        OVERDUE_RESOLUTION_INDEX,
        freelancer_amount,
        client_amount,
    );
    core::p_remove(env, &DataKey::OverdueRequest(escrow_id));

    events::OverdueResolved {
        escrow_id,
        beneficiary,
        depositor: escrow.depositor.clone(),
        freelancer_amount,
        client_amount,
        resolved_by: arbiter,
    }
    .publish(env);

    if freelancer_amount == 0 {
        // A full refund ruling. Whatever fee is left belongs to milestones
        // that were genuinely paid earlier, so the platform keeps it.
        let fee = escrow.platform_fee;
        escrow.platform_fee = 0;
        escrow.status = EscrowStatus::Refunded;
        core::liabilities_sub(env, escrow.token.as_ref(), fee)?;
        core::fees_credit(env, escrow.token.as_ref(), fee)?;
        events::EscrowRefunded {
            escrow_id,
            depositor: escrow.depositor.clone(),
            beneficiary: escrow.beneficiary.clone(),
            amount: add(client_amount, fee_back)?,
            kind: symbol_short!("arbiter"),
        }
        .publish(env);
    } else {
        core::finalize_if_complete(env, escrow_id, &mut escrow)?;
    }
    core::save_escrow(env, escrow_id, &escrow);
    Ok(())
}

/// Arbiter: return all unpaid funds to the client.
pub fn arbiter_approve_refund(env: &Env, escrow_id: u32, arbiter: Address) -> SfResult<()> {
    overdue_resolution(env, escrow_id, arbiter, 0)
}

/// Arbiter: award `freelancer_amount` of the unpaid balance to the
/// freelancer and return the rest to the client.
pub fn arbiter_award_freelancer(
    env: &Env,
    escrow_id: u32,
    arbiter: Address,
    freelancer_amount: i128,
) -> SfResult<()> {
    overdue_resolution(env, escrow_id, arbiter, freelancer_amount)
}

pub fn get_overdue_request(env: &Env, escrow_id: u32) -> Option<OverdueRequest> {
    core::p_get(env, &DataKey::OverdueRequest(escrow_id))
}
