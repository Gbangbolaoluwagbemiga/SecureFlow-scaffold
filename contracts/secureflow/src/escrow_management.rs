//! Creating escrows, and everything a client can change before work starts.

use crate::admin;
use crate::escrow_core::{self as core, add, add_u32, sub};
use crate::events;
use crate::storage_types::{
    DataKey, EscrowData, EscrowStatus, MilestoneStatus, SecureFlowError, SfResult, MAX_ARBITERS,
    MAX_DURATION_SECONDS, MAX_MILESTONES, MIN_DURATION_SECONDS,
};
use soroban_sdk::{Address, Env, String, Vec};

// ─── Creation ────────────────────────────────────────────────────────────────

/// Validate a milestone list and return its total.
fn milestone_total(milestones: &Vec<(i128, String)>) -> SfResult<i128> {
    if milestones.is_empty() {
        return Err(SecureFlowError::NoMilestones);
    }
    if milestones.len() > MAX_MILESTONES {
        return Err(SecureFlowError::TooManyMilestones);
    }
    let mut total: i128 = 0;
    for (amount, _) in milestones.iter() {
        if amount <= 0 {
            return Err(SecureFlowError::ZeroMilestoneAmount);
        }
        total = add(total, amount)?;
    }
    Ok(total)
}

/// Write a fresh milestone list at indexes `0..len`.
fn save_new_milestones(env: &Env, escrow_id: u32, milestones: &Vec<(i128, String)>) {
    for (index, (amount, text)) in (0_u32..).zip(milestones.iter()) {
        core::save_milestone(env, escrow_id, index, &core::new_milestone(amount, text));
    }
}

#[allow(clippy::too_many_arguments)]
pub fn create_escrow(
    env: &Env,
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
) -> SfResult<u32> {
    depositor.require_auth();
    admin::require_not_paused(env)?;
    if admin::is_job_creation_paused(env) {
        return Err(SecureFlowError::JobCreationPaused);
    }

    // ── All input checks happen before any money moves ──
    if !(MIN_DURATION_SECONDS..=MAX_DURATION_SECONDS).contains(&duration) {
        return Err(SecureFlowError::InvalidDuration);
    }
    if total_amount <= 0 {
        return Err(SecureFlowError::InvalidAmount);
    }
    if milestone_total(&milestones)? != total_amount {
        // Milestones summing to the total is what lets "every milestone paid"
        // mean "escrow complete". The old contract never checked, so a job
        // could be funded for less than its milestones promised.
        return Err(SecureFlowError::MilestoneSumMismatch);
    }
    if let Some(b) = &beneficiary {
        if b == &depositor {
            return Err(SecureFlowError::SelfDealing);
        }
        if b == &env.current_contract_address() {
            return Err(SecureFlowError::InvalidAddress);
        }
    }
    if arbiters.len() > MAX_ARBITERS {
        return Err(SecureFlowError::TooManyArbiters);
    }
    for a in arbiters.iter() {
        if a == depositor || beneficiary.as_ref() == Some(&a) {
            return Err(SecureFlowError::ArbiterIsParty);
        }
        if arbiters.first_index_of(&a) != arbiters.last_index_of(&a) {
            return Err(SecureFlowError::DuplicateArbiter);
        }
    }
    let confirmations = required_confirmations.max(1);
    if !arbiters.is_empty() && confirmations > arbiters.len() {
        return Err(SecureFlowError::InvalidConfirmations);
    }
    if !core::is_whitelisted_token(env, token.clone()) {
        return Err(SecureFlowError::TokenNotWhitelisted);
    }

    // ── Fund ──
    let platform_fee = core::calculate_fee(env, total_amount)?;
    let deposit = add(total_amount, platform_fee)?;
    let escrow_id = core::increment_next_escrow_id(env)?;
    core::pull_in(env, token.as_ref(), &depositor, deposit)?;
    core::liabilities_add(env, token.as_ref(), deposit)?;

    let now = env.ledger().sequence();
    let deadline = add_u32(now, core::seconds_to_ledgers(duration))?;
    let is_open_job = beneficiary.is_none();
    let escrow = EscrowData {
        depositor: depositor.clone(),
        beneficiary: beneficiary.clone(),
        arbiters,
        required_confirmations: confirmations,
        token: token.clone(),
        total_amount,
        paid_amount: 0,
        platform_fee,
        deadline,
        status: EscrowStatus::Pending,
        work_started: false,
        created_at: now,
        milestone_count: milestones.len(),
        is_open_job,
        project_title,
        project_description,
    };
    core::save_escrow(env, escrow_id, &escrow);
    save_new_milestones(env, escrow_id, &milestones);

    core::add_user_escrow(env, depositor.clone(), escrow_id);
    if is_open_job {
        core::open_jobs_add(env, escrow_id);
    }
    if let Some(b) = &beneficiary {
        core::add_user_escrow(env, b.clone(), escrow_id);
    }
    admin::bump_instance(env);

    events::EscrowCreated {
        escrow_id,
        depositor,
        beneficiary,
        total_amount,
        platform_fee,
        token: core::token_address(env, token.as_ref()),
        deadline,
        milestone_count: escrow.milestone_count,
        is_open_job,
    }
    .publish(env);
    Ok(escrow_id)
}

/// What a client must deposit to fund a job of `total_amount`.
pub fn quote_deposit(env: &Env, total_amount: i128) -> SfResult<(i128, i128)> {
    if total_amount <= 0 {
        return Err(SecureFlowError::InvalidAmount);
    }
    let fee = core::calculate_fee(env, total_amount)?;
    Ok((add(total_amount, fee)?, fee))
}

// ─── Before work starts ──────────────────────────────────────────────────────

/// Load an escrow the depositor may still reshape: theirs, Pending, and not
/// yet started by a freelancer. `work_started` is the line because it is the
/// freelancer's own act — the first moment anyone is relying on the job.
fn load_editable(env: &Env, escrow_id: u32, depositor: &Address) -> SfResult<EscrowData> {
    depositor.require_auth();
    admin::require_not_paused(env)?;
    let escrow = core::load_escrow(env, escrow_id)?;
    core::require_depositor(&escrow, depositor)?;
    if escrow.work_started {
        return Err(SecureFlowError::CannotModifyStartedEscrow);
    }
    if escrow.status != EscrowStatus::Pending {
        return Err(SecureFlowError::InvalidEscrowStatus);
    }
    Ok(escrow)
}

fn emit_funds_updated(env: &Env, escrow_id: u32, escrow: &EscrowData, old_total: i128) {
    events::JobFundsUpdated {
        escrow_id,
        beneficiary: escrow.beneficiary.clone(),
        old_total,
        new_total: escrow.total_amount,
        milestone_count: escrow.milestone_count,
    }
    .publish(env);
}

/// Grow the job by `amount`, collecting the matching fee share. Mutates
/// `escrow` totals; the caller saves.
fn grow(env: &Env, escrow: &mut EscrowData, depositor: &Address, amount: i128) -> SfResult<()> {
    let fee = core::fee_share(escrow, amount)?;
    let deposit = add(amount, fee)?;
    core::pull_in(env, escrow.token.as_ref(), depositor, deposit)?;
    core::liabilities_add(env, escrow.token.as_ref(), deposit)?;
    escrow.total_amount = add(escrow.total_amount, amount)?;
    escrow.platform_fee = add(escrow.platform_fee, fee)?;
    Ok(())
}

/// Shrink the job by `amount`, returning it plus its fee share. Mutates
/// `escrow` totals; the caller saves (before or after — the transfer here is
/// to the depositor, who already authorised the call).
fn shrink(env: &Env, escrow: &mut EscrowData, amount: i128) -> SfResult<()> {
    let fee = core::fee_share(escrow, amount)?;
    let refund = add(amount, fee)?;
    escrow.total_amount = sub(escrow.total_amount, amount)?;
    escrow.platform_fee = sub(escrow.platform_fee, fee)?;
    core::liabilities_sub(env, escrow.token.as_ref(), refund)?;
    core::pay_out(env, escrow.token.as_ref(), &escrow.depositor, refund)
}

/// A full rewrite is only safe while every milestone is untouched. A job
/// reopened after arbitration can be Pending with paid or resolved milestones;
/// rewriting the list there would erase that history and re-promise money
/// already paid out.
fn require_all_untouched(env: &Env, escrow: &EscrowData, escrow_id: u32) -> SfResult<()> {
    for i in 0..escrow.milestone_count {
        if let Some(m) = core::get_milestone(env, escrow_id, i) {
            match m.status {
                MilestoneStatus::NotStarted => {}
                MilestoneStatus::ProposalPending => {
                    return Err(SecureFlowError::PendingProposalExists)
                }
                _ => return Err(SecureFlowError::MilestoneAlreadyStarted),
            }
        }
    }
    Ok(())
}

/// Add a milestone, depositing its amount plus fee share.
///
/// The old version wrote the milestone without moving any money, so the
/// milestones then promised more than the escrow held and the job could never
/// complete.
pub fn add_milestone(
    env: &Env,
    escrow_id: u32,
    amount: i128,
    description: String,
    depositor: Address,
) -> SfResult<()> {
    let mut escrow = load_editable(env, escrow_id, &depositor)?;
    if escrow.milestone_count >= MAX_MILESTONES {
        return Err(SecureFlowError::TooManyMilestones);
    }
    if amount <= 0 {
        return Err(SecureFlowError::ZeroMilestoneAmount);
    }
    let old_total = escrow.total_amount;
    grow(env, &mut escrow, &depositor, amount)?;
    core::save_milestone(
        env,
        escrow_id,
        escrow.milestone_count,
        &core::new_milestone(amount, description),
    );
    escrow.milestone_count += 1;
    core::save_escrow(env, escrow_id, &escrow);
    emit_funds_updated(env, escrow_id, &escrow, old_total);
    Ok(())
}

/// Remove a milestone and refund its amount plus fee share. Later milestones
/// shift down one index.
pub fn remove_milestone(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    depositor: Address,
) -> SfResult<()> {
    let mut escrow = load_editable(env, escrow_id, &depositor)?;
    if milestone_index >= escrow.milestone_count {
        return Err(SecureFlowError::MilestoneIndexOutOfBounds);
    }
    if escrow.milestone_count <= 1 {
        return Err(SecureFlowError::CannotRemoveLastMilestone);
    }
    let removed = core::load_milestone(env, &escrow, escrow_id, milestone_index)?;
    if removed.status != MilestoneStatus::NotStarted {
        return Err(SecureFlowError::MilestoneAlreadyStarted);
    }

    let last = escrow.milestone_count - 1;
    for i in milestone_index..last {
        if let Some(next) = core::get_milestone(env, escrow_id, i + 1) {
            core::save_milestone(env, escrow_id, i, &next);
        }
    }
    core::p_remove(env, &DataKey::Milestone(escrow_id, last));
    escrow.milestone_count = last;

    let old_total = escrow.total_amount;
    shrink(env, &mut escrow, removed.amount)?;
    core::save_escrow(env, escrow_id, &escrow);
    emit_funds_updated(env, escrow_id, &escrow, old_total);
    Ok(())
}

/// Rewrite the whole milestone list in one call — add, remove, reorder,
/// re-word — settling the change in total either way.
///
/// Wholesale replacement is safe only because nothing has started: no index
/// is in flight for submit, approve or dispute to be silently re-pointed by.
/// For a single top-up, prefer `add_job_funds`: it takes a delta, so a caller
/// working from a stale read cannot accidentally delete a stage.
pub fn set_milestones(
    env: &Env,
    escrow_id: u32,
    milestones: Vec<(i128, String)>,
    depositor: Address,
) -> SfResult<()> {
    let mut escrow = load_editable(env, escrow_id, &depositor)?;
    require_all_untouched(env, &escrow, escrow_id)?;
    let new_total = milestone_total(&milestones)?;
    let old_total = escrow.total_amount;

    if new_total > old_total {
        grow(env, &mut escrow, &depositor, sub(new_total, old_total)?)?;
    } else if new_total < old_total {
        shrink(env, &mut escrow, sub(old_total, new_total)?)?;
    }

    for i in 0..escrow.milestone_count {
        core::p_remove(env, &DataKey::Milestone(escrow_id, i));
    }
    save_new_milestones(env, escrow_id, &milestones);
    escrow.milestone_count = milestones.len();
    core::save_escrow(env, escrow_id, &escrow);
    emit_funds_updated(env, escrow_id, &escrow, old_total);
    Ok(())
}

/// Put more money on one milestone of a job nobody has started.
pub fn add_job_funds(
    env: &Env,
    escrow_id: u32,
    depositor: Address,
    additional_amount: i128,
    milestone_index: u32,
) -> SfResult<()> {
    if additional_amount <= 0 {
        return Err(SecureFlowError::InvalidAmount);
    }
    let mut escrow = load_editable(env, escrow_id, &depositor)?;
    let mut m = core::load_milestone(env, &escrow, escrow_id, milestone_index)?;
    if m.status != MilestoneStatus::NotStarted {
        return Err(SecureFlowError::MilestoneAlreadyProcessed);
    }
    let old_total = escrow.total_amount;
    grow(env, &mut escrow, &depositor, additional_amount)?;
    m.amount = add(m.amount, additional_amount)?;
    core::save_milestone(env, escrow_id, milestone_index, &m);
    core::save_escrow(env, escrow_id, &escrow);
    emit_funds_updated(env, escrow_id, &escrow, old_total);
    Ok(())
}

/// Take money back off one unstarted milestone.
///
/// Allowed in two situations:
///   * before the freelancer starts — ordinary budgeting;
///   * after arbitration — the exit from a job that visibly broke. A ruling
///     settles one milestone, not the job, and the remaining milestones were
///     otherwise unreachable until the deadline plus the emergency delay.
///
/// Only work nobody has submitted can be taken back, so this never costs the
/// freelancer anything they earned.
pub fn withdraw_job_funds(
    env: &Env,
    escrow_id: u32,
    depositor: Address,
    withdraw_amount: i128,
    milestone_index: u32,
) -> SfResult<()> {
    depositor.require_auth();
    admin::require_not_paused(env)?;
    if withdraw_amount <= 0 {
        return Err(SecureFlowError::InvalidAmount);
    }
    let mut escrow = core::load_escrow(env, escrow_id)?;
    core::require_depositor(&escrow, &depositor)?;

    let before_work = !escrow.work_started && escrow.status == EscrowStatus::Pending;
    let after_arbitration = escrow.status == EscrowStatus::InProgress
        && core::p_get::<bool>(env, &DataKey::Arbitrated(escrow_id)).unwrap_or(false);
    if !before_work && !after_arbitration {
        return Err(SecureFlowError::CannotModifyStartedEscrow);
    }

    let mut m = core::load_milestone(env, &escrow, escrow_id, milestone_index)?;
    if m.status != MilestoneStatus::NotStarted {
        return Err(SecureFlowError::MilestoneAlreadyProcessed);
    }
    if withdraw_amount > m.amount {
        return Err(SecureFlowError::InsufficientWithdrawable);
    }

    let old_total = escrow.total_amount;
    shrink(env, &mut escrow, withdraw_amount)?;
    m.amount = sub(m.amount, withdraw_amount)?;
    core::save_milestone(env, escrow_id, milestone_index, &m);
    if after_arbitration {
        // Taking the last unpaid money back off an arbitrated job finishes it.
        core::finalize_if_complete(env, escrow_id, &mut escrow)?;
    }
    core::save_escrow(env, escrow_id, &escrow);
    emit_funds_updated(env, escrow_id, &escrow, old_total);
    Ok(())
}

// ─── Cancellation ────────────────────────────────────────────────────────────

/// Penalty for pulling a job people have applied to: 5 % with 1-5
/// applications, 10 % with 6-10, 15 % with 11 or more.
///
/// Only the applicant charge exists, because it is the one with a victim — a
/// person whose application just became worthless. A job nobody applied to
/// costs nobody anything, and that includes a client stranded by a named
/// freelancer who never started: charging them for someone else's silence is
/// a fee for being let down.
fn cancellation_penalty(env: &Env, escrow_id: u32, total: i128) -> SfResult<i128> {
    let applicants: Vec<Address> =
        core::p_get(env, &DataKey::Applicants(escrow_id)).unwrap_or(Vec::new(env));
    let pct: i128 = match applicants.len() {
        0 => return Ok(0),
        1..=5 => 5,
        6..=10 => 10,
        _ => 15,
    };
    core::mul_div(total, pct, 100)
}

/// Cancel a job nobody has started and take the money back: the budget minus
/// any applicant penalty, plus the whole held platform fee.
///
/// `work_started` is the line, not "is this an open job". The old check
/// (`is_open_job`) meant a job created with its freelancer already named could
/// never be cancelled at all, locking the client's budget until the deadline
/// plus the emergency delay on a job nobody had touched.
///
/// Only the UNPAID part comes back. A job reopened after arbitration is
/// Pending again with some milestones already paid, and those stay paid; the
/// fee share for them is earned.
pub fn cancel_job(env: &Env, escrow_id: u32, depositor: Address) -> SfResult<()> {
    let mut escrow = load_editable(env, escrow_id, &depositor)?;

    let unpaid = sub(escrow.total_amount, escrow.paid_amount)?;
    let penalty = cancellation_penalty(env, escrow_id, unpaid)?;
    let fee_back = core::fee_share(&escrow, unpaid)?;
    let fee_earned = sub(escrow.platform_fee, fee_back)?;
    let refund = add(sub(unpaid, penalty)?, fee_back)?;
    let held = add(unpaid, escrow.platform_fee)?;

    let count: u32 = core::p_get(env, &DataKey::UserCancellations(depositor.clone())).unwrap_or(0);
    core::p_set(
        env,
        &DataKey::UserCancellations(depositor.clone()),
        &count.saturating_add(1),
    );
    core::p_set(
        env,
        &DataKey::LastCancellationLedger(depositor.clone()),
        &env.ledger().sequence(),
    );

    escrow.status = EscrowStatus::Cancelled;
    core::open_jobs_remove(env, escrow_id);
    escrow.platform_fee = 0;
    core::save_escrow(env, escrow_id, &escrow);
    core::liabilities_sub(env, escrow.token.as_ref(), held)?;
    core::fees_credit(env, escrow.token.as_ref(), add(penalty, fee_earned)?)?;
    core::pay_out(env, escrow.token.as_ref(), &depositor, refund)?;

    events::EscrowCancelled {
        escrow_id,
        beneficiary: escrow.beneficiary.clone(),
        depositor,
        refund,
        penalty,
    }
    .publish(env);
    Ok(())
}

// ─── Declining & reopening ───────────────────────────────────────────────────

/// The named freelancer hands back a job before starting it.
///
/// A directly assigned escrow puts someone's name on a job they never agreed
/// to; ignoring it left the client's money locked and the client waiting.
/// Declining leaves the escrow funded, Pending, with no freelancer and not yet
/// open — the one state that means "declined, waiting on the client", who then
/// chooses: name someone (`accept_freelancer`, which may re-name the decliner),
/// open it to everyone (`reopen_job`), or take the money back (`cancel_job`).
pub fn decline_assignment(env: &Env, escrow_id: u32, beneficiary: Address) -> SfResult<()> {
    beneficiary.require_auth();
    admin::require_not_paused(env)?;
    let mut escrow = core::load_escrow(env, escrow_id)?;
    core::require_beneficiary(&escrow, &beneficiary)?;
    if escrow.work_started {
        return Err(SecureFlowError::WorkAlreadyStarted);
    }
    if escrow.status != EscrowStatus::Pending {
        return Err(SecureFlowError::InvalidEscrowStatus);
    }

    core::p_set(
        env,
        &DataKey::Declined(escrow_id, beneficiary.clone()),
        &true,
    );
    escrow.beneficiary = None;
    core::save_escrow(env, escrow_id, &escrow);
    core::remove_user_escrow(env, beneficiary.clone(), escrow_id);

    events::AssignmentDeclined {
        escrow_id,
        depositor: escrow.depositor,
        freelancer: beneficiary,
    }
    .publish(env);
    Ok(())
}

/// Put the unfinished part of a job back on the board, with its history.
///
/// Two ways in, ending in the same state:
///   * after a decline   — Pending, nobody assigned;
///   * after arbitration — the client and freelancer are done, but the work
///     is still worth doing and the client may prefer it finished to refunded.
///
/// Nothing is erased: earlier submissions, dispute reasons and rulings stay on
/// their milestones, so whoever picks it up can see what happened first. Paid
/// work stays paid; only milestones nobody submitted are back in play.
pub fn reopen_job(env: &Env, escrow_id: u32, depositor: Address) -> SfResult<()> {
    depositor.require_auth();
    admin::require_not_paused(env)?;
    let mut escrow = core::load_escrow(env, escrow_id)?;
    core::require_depositor(&escrow, &depositor)?;

    let declined = escrow.status == EscrowStatus::Pending && escrow.beneficiary.is_none();
    let arbitrated = escrow.status == EscrowStatus::InProgress
        && core::p_get::<bool>(env, &DataKey::Arbitrated(escrow_id)).unwrap_or(false);
    if !declined && !arbitrated {
        return Err(SecureFlowError::CannotReopenJob);
    }

    let mut unfinished = false;
    for i in 0..escrow.milestone_count {
        if let Some(m) = core::get_milestone(env, escrow_id, i) {
            if m.status == MilestoneStatus::NotStarted && m.amount > 0 {
                unfinished = true;
                break;
            }
        }
    }
    if !unfinished {
        return Err(SecureFlowError::NothingLeftToFinish);
    }

    let previous = escrow.beneficiary.clone();
    if let Some(p) = &previous {
        core::remove_user_escrow(env, p.clone(), escrow_id);
    }
    escrow.beneficiary = None;
    escrow.is_open_job = true;
    escrow.work_started = false;
    escrow.status = EscrowStatus::Pending;
    core::open_jobs_add(env, escrow_id);
    core::save_escrow(env, escrow_id, &escrow);

    events::JobReopened {
        escrow_id,
        previous_freelancer: previous,
    }
    .publish(env);
    Ok(())
}

// ─── Job manager (Autopilot) ─────────────────────────────────────────────────

/// Appoint an agent to run this job: hire, approve, reject, escalate. It can
/// never cancel, extend, move funds, re-appoint, or become the freelancer.
/// Appointing replaces any previous manager — one job, one manager, so "who
/// did this" always has exactly one answer.
pub fn set_job_manager(
    env: &Env,
    escrow_id: u32,
    manager: Address,
    depositor: Address,
) -> SfResult<()> {
    depositor.require_auth();
    admin::require_not_paused(env)?;
    let escrow = core::load_escrow(env, escrow_id)?;
    core::require_depositor(&escrow, &depositor)?;
    if core::is_terminal(&escrow.status) {
        return Err(SecureFlowError::InvalidEscrowStatus);
    }
    if manager == depositor {
        return Err(SecureFlowError::ManagerCannotBeDepositor);
    }
    if escrow.beneficiary.as_ref() == Some(&manager) {
        // THE ONE-WAY KEY: a manager that is also the freelancer could
        // approve its own milestones and drain the escrow to itself.
        return Err(SecureFlowError::ManagerCannotBeBeneficiary);
    }
    if manager == env.current_contract_address() || escrow.arbiters.contains(&manager) {
        return Err(SecureFlowError::InvalidAddress);
    }
    core::p_set(env, &DataKey::JobManager(escrow_id), &manager);
    events::JobManagerSet { escrow_id, manager }.publish(env);
    Ok(())
}

/// Take management back immediately. The client's escape hatch: it never
/// depends on the manager's cooperation and works even while paused.
pub fn revoke_job_manager(env: &Env, escrow_id: u32, depositor: Address) -> SfResult<()> {
    depositor.require_auth();
    let escrow = core::load_escrow(env, escrow_id)?;
    core::require_depositor(&escrow, &depositor)?;
    let manager = core::get_job_manager(env, escrow_id).ok_or(SecureFlowError::NoManagerSet)?;
    core::p_remove(env, &DataKey::JobManager(escrow_id));
    events::JobManagerRevoked { escrow_id, manager }.publish(env);
    Ok(())
}
