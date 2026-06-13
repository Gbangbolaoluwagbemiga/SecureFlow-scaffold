use crate::admin;
use crate::escrow_core;
use crate::storage_types::{
    DataKey, EscrowData, EscrowStatus, MilestoneStatus, SecureFlowError,
    INSTANCE_BUMP_AMOUNT, INSTANCE_LIFETIME_THRESHOLD,
};
use soroban_sdk::{token, Address, Env, String, Vec, Error};

pub fn create_escrow(
    env: &Env,
    depositor: Address,
    beneficiary: Option<Address>,
    arbiters: Vec<Address>,
    required_confirmations: u32,
    milestone_amounts: Vec<i128>,
    milestone_descriptions: Vec<String>,
    token: Option<Address>,
    total_amount: i128,
    duration: u32,
    project_title: String,
    project_description: String,
) -> Result<u32, Error> {
    // Require auth
    depositor.require_auth();

    // Check if job creation is paused
    if admin::is_job_creation_paused(env) {
        return Err(Error::from_contract_error(SecureFlowError::JobCreationPaused as u32));
    }

    // Validate parameters
    if duration < 3600 || duration > 31536000 {
        // 1 hour to 365 days
        return Err(Error::from_contract_error(SecureFlowError::InvalidDuration as u32));
    }

    if milestone_amounts.len() != milestone_descriptions.len() {
        return Err(Error::from_contract_error(SecureFlowError::MilestoneCountMismatch as u32));
    }

    if milestone_amounts.len() > 20 {
        return Err(Error::from_contract_error(SecureFlowError::TooManyMilestones as u32));
    }

    if arbiters.len() > 5 {
        return Err(Error::from_contract_error(SecureFlowError::TooManyArbiters as u32));
    }

    if required_confirmations > arbiters.len() as u32 {
        return Err(Error::from_contract_error(SecureFlowError::InvalidConfirmations as u32));
    }

    // Check token whitelist
    if !escrow_core::is_whitelisted_token(env, token.clone()) {
        return Err(Error::from_contract_error(SecureFlowError::TokenNotWhitelisted as u32));
    }

    // Calculate platform fee
    let platform_fee = escrow_core::calculate_fee(env, total_amount);

    // Calculate deadline
    let current_ledger = env.ledger().sequence();
    let deadline = current_ledger + (duration as u32) / 5; // Approximate conversion

    // Get next escrow ID
    let escrow_id = escrow_core::increment_next_escrow_id(env);

    // Calculate token key first (before moving token)
    let token_key = token.as_ref().map(|t| t.clone()).unwrap_or_else(|| env.current_contract_address());
    
    // Transfer funds
    if let Some(token_addr) = &token {
        // Transfer ERC20-like token
        let token_client = token::Client::new(env, token_addr);
        token_client.transfer(&depositor, &env.current_contract_address(), &total_amount);
    } else {
        // Transfer native XLM using Stellar Asset Contract (SAC)
        // Native XLM SAC address for testnet
        let native_token_str = String::from_str(env, "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
        let native_token_address = Address::from_string(&native_token_str);
        let native_token_client = token::Client::new(env, &native_token_address);
        native_token_client.transfer(
            &depositor,
            &env.current_contract_address(),
            &total_amount,
        );
    }
    
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
        .set(&DataKey::EscrowedAmount(token_key), &(current_escrowed + total_amount));

    // Create escrow data
    let is_open_job = beneficiary.is_none();
    let escrow_data = EscrowData {
        depositor: depositor.clone(),
        beneficiary: beneficiary.clone(),
        arbiters,
        required_confirmations,
        token: token.clone(),
        total_amount,
        paid_amount: 0,
        platform_fee,
        deadline,
        status: EscrowStatus::Pending,
        work_started: false,
        created_at: current_ledger,
        milestone_count: milestone_amounts.len() as u32,
        is_open_job,
        project_title,
        project_description,
    };

    // Save escrow
    escrow_core::save_escrow(env, escrow_id, &escrow_data);

    // Save milestones
    for (i, (amount, description)) in milestone_amounts.iter().zip(milestone_descriptions.iter()).enumerate() {
        let milestone = crate::storage_types::Milestone {
            description: description.clone(),
            amount,
            status: crate::storage_types::MilestoneStatus::NotStarted,
            submitted_at: 0,
            approved_at: 0,
            disputed_at: 0,
            disputed_by: None,
            dispute_reason: None,
            rejection_reason: None,
            resolved_at: 0,
            resolved_by: None,
            resolution_freelancer_amount: 0,
            resolution_client_amount: 0,
            resolution_reason: None,
            proposed_amount: 0,
            proposed_description: None,
        };
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
        env.storage()
            .instance()
            .set(&DataKey::Milestone(escrow_id, i as u32), &milestone);
    }

    // Add to user escrows
    escrow_core::add_user_escrow(env, depositor.clone(), escrow_id);
    if let Some(ben) = &beneficiary {
        escrow_core::add_user_escrow(env, ben.clone(), escrow_id);
    }

    Ok(escrow_id)
}

/// Add a new milestone to a Pending escrow (only before work starts).
pub fn add_milestone(
    env: &Env,
    escrow_id: u32,
    amount: i128,
    description: String,
    depositor: Address,
) -> Result<(), Error> {
    depositor.require_auth();
    admin::require_not_paused(env)?;

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let mut escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.depositor != depositor {
        return Err(Error::from_contract_error(SecureFlowError::OnlyDepositor as u32));
    }

    if escrow.work_started {
        return Err(Error::from_contract_error(SecureFlowError::CannotModifyStartedEscrow as u32));
    }

    if escrow.status != EscrowStatus::Pending {
        return Err(Error::from_contract_error(SecureFlowError::InvalidEscrowStatus as u32));
    }

    if escrow.milestone_count >= 20 {
        return Err(Error::from_contract_error(SecureFlowError::TooManyMilestones as u32));
    }

    if amount <= 0 {
        return Err(Error::from_contract_error(SecureFlowError::InvalidAmount as u32));
    }

    let new_index = escrow.milestone_count;
    let milestone = crate::storage_types::Milestone {
        description,
        amount,
        status: crate::storage_types::MilestoneStatus::NotStarted,
        submitted_at: 0,
        approved_at: 0,
        disputed_at: 0,
        disputed_by: None,
        dispute_reason: None,
        rejection_reason: None,
        resolved_at: 0,
        resolved_by: None,
        resolution_freelancer_amount: 0,
        resolution_client_amount: 0,
        resolution_reason: None,
        proposed_amount: 0,
        proposed_description: None,
    };

    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::Milestone(escrow_id, new_index), &milestone);

    escrow.milestone_count += 1;
    escrow_core::save_escrow(env, escrow_id, &escrow);
    Ok(())
}

/// Remove a milestone from a Pending escrow (only before work starts).
/// Shifts subsequent milestones down to fill the gap. Cannot remove the last milestone.
pub fn remove_milestone(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    depositor: Address,
) -> Result<(), Error> {
    depositor.require_auth();
    admin::require_not_paused(env)?;

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let mut escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.depositor != depositor {
        return Err(Error::from_contract_error(SecureFlowError::OnlyDepositor as u32));
    }

    if escrow.work_started {
        return Err(Error::from_contract_error(SecureFlowError::CannotModifyStartedEscrow as u32));
    }

    if escrow.status != EscrowStatus::Pending {
        return Err(Error::from_contract_error(SecureFlowError::InvalidEscrowStatus as u32));
    }

    if milestone_index >= escrow.milestone_count {
        return Err(Error::from_contract_error(SecureFlowError::MilestoneIndexOutOfBounds as u32));
    }

    if escrow.milestone_count <= 1 {
        return Err(Error::from_contract_error(SecureFlowError::InvalidMilestone as u32));
    }

    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);

    // Shift all milestones after the removed index down by one
    let last = escrow.milestone_count - 1;
    for i in milestone_index..last {
        let next_key = DataKey::Milestone(escrow_id, i + 1);
        if let Some(next_m) = env
            .storage()
            .instance()
            .get::<DataKey, crate::storage_types::Milestone>(&next_key)
        {
            env.storage()
                .instance()
                .set(&DataKey::Milestone(escrow_id, i), &next_m);
        }
    }

    // Remove the now-duplicate last slot
    env.storage()
        .instance()
        .remove(&DataKey::Milestone(escrow_id, last));

    escrow.milestone_count -= 1;
    escrow_core::save_escrow(env, escrow_id, &escrow);
    Ok(())
}

// ─── Job cancellation ─────────────────────────────────────────────────────────

/// Depositor cancels an open (unassigned) job and receives a refund minus a
/// tiered cancellation penalty.
///
/// Penalty tiers (based on lifetime effective cancellations):
///   0–2 → 0 %   |   3–5 → 5 %   |   6–10 → 10 %   |   11+ → 15 %
/// Plus an additional 0–15 % if the job had applications, capped at 30 %.
/// Effective cancellations decay 1 per ~30 days without a new cancellation.
pub fn cancel_job(env: &Env, escrow_id: u32, depositor: Address) -> Result<(), Error> {
    depositor.require_auth();
    admin::require_not_paused(env)?;

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let mut escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.depositor != depositor {
        return Err(Error::from_contract_error(SecureFlowError::OnlyDepositor as u32));
    }
    if !escrow.is_open_job {
        return Err(Error::from_contract_error(SecureFlowError::CannotCancelAssignedJob as u32));
    }
    if escrow.status != EscrowStatus::Pending {
        return Err(Error::from_contract_error(SecureFlowError::InvalidEscrowStatus as u32));
    }

    // Record cancellation before computing penalty (count includes this one)
    let prev_cancellations: u32 = env
        .storage()
        .instance()
        .get(&DataKey::UserCancellations(depositor.clone()))
        .unwrap_or(0);
    let new_count = prev_cancellations + 1;
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::UserCancellations(depositor.clone()), &new_count);
    env.storage()
        .instance()
        .set(&DataKey::LastCancellationLedger(depositor.clone()), &env.ledger().sequence());

    let penalty = _calc_cancel_penalty(env, &depositor, escrow_id, escrow.total_amount);
    let net_refund = if escrow.total_amount > penalty { escrow.total_amount - penalty } else { 0 };

    // Update escrowed amount tracking
    let token_key = escrow.token.clone().unwrap_or_else(|| env.current_contract_address());
    let current_escrowed: i128 = env
        .storage()
        .instance()
        .get(&DataKey::EscrowedAmount(token_key.clone()))
        .unwrap_or(0);
    env.storage().instance().set(
        &DataKey::EscrowedAmount(token_key.clone()),
        &(current_escrowed - escrow.total_amount),
    );

    // Penalty accrues to platform fees
    if penalty > 0 {
        let current_fees: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalFeesByToken(token_key))
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalFeesByToken(escrow.token.clone().unwrap_or_else(|| env.current_contract_address())), &(current_fees + penalty));
    }

    escrow.status = EscrowStatus::Cancelled;
    escrow_core::save_escrow(env, escrow_id, &escrow);

    if net_refund > 0 {
        escrow_core::do_transfer(env, &escrow.token, &depositor, net_refund);
    }

    Ok(())
}

fn _calc_cancel_penalty(env: &Env, user: &Address, escrow_id: u32, amount: i128) -> i128 {
    let cancellations: u32 = env
        .storage()
        .instance()
        .get(&DataKey::UserCancellations(user.clone()))
        .unwrap_or(0);
    let last_ledger: u32 = env
        .storage()
        .instance()
        .get(&DataKey::LastCancellationLedger(user.clone()))
        .unwrap_or(0);

    // Decay: 1 cancellation per ~30 days without a new one (17280 ledgers/day * 30)
    let effective = if last_ledger == 0 || cancellations == 0 {
        cancellations
    } else {
        let elapsed = env.ledger().sequence().saturating_sub(last_ledger);
        let reduction = elapsed / (17280 * 30);
        cancellations.saturating_sub(reduction)
    };

    let base_pct: u32 = if effective <= 2 { 0 }
        else if effective <= 5 { 5 }
        else if effective <= 10 { 10 }
        else { 15 };

    // Count applications for this escrow
    let mut app_count: u32 = 0;
    for i in 0..50u32 {
        if env.storage().instance().has(&DataKey::Application(escrow_id, i)) {
            app_count += 1;
        }
    }
    let app_pct: u32 = if app_count >= 11 { 15 } else if app_count >= 6 { 10 } else if app_count >= 1 { 5 } else { 0 };

    let total_pct = (base_pct + app_pct).min(30);
    (amount * total_pct as i128) / 100
}

// ─── Dynamic fund management (open jobs only) ─────────────────────────────────

/// Add additional funds to a specific milestone on an open job before freelancer
/// assignment. `additional_amount` is the NET amount added to the milestone;
/// the proportional platform fee is collected on top.
pub fn add_job_funds(
    env: &Env,
    escrow_id: u32,
    depositor: Address,
    additional_amount: i128,
    milestone_index: u32,
) -> Result<(), Error> {
    depositor.require_auth();
    admin::require_not_paused(env)?;

    if additional_amount <= 0 {
        return Err(Error::from_contract_error(SecureFlowError::InvalidAmount as u32));
    }

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let mut escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.depositor != depositor {
        return Err(Error::from_contract_error(SecureFlowError::OnlyDepositor as u32));
    }
    if !escrow.is_open_job {
        return Err(Error::from_contract_error(SecureFlowError::CannotCancelAssignedJob as u32));
    }
    if escrow.status != EscrowStatus::Pending {
        return Err(Error::from_contract_error(SecureFlowError::InvalidEscrowStatus as u32));
    }
    if milestone_index >= escrow.milestone_count {
        return Err(Error::from_contract_error(SecureFlowError::MilestoneIndexOutOfBounds as u32));
    }

    let mut milestone: crate::storage_types::Milestone = env
        .storage()
        .instance()
        .get::<DataKey, crate::storage_types::Milestone>(&DataKey::Milestone(escrow_id, milestone_index))
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::InvalidMilestone as u32))?;

    if milestone.status != MilestoneStatus::NotStarted {
        return Err(Error::from_contract_error(SecureFlowError::MilestoneAlreadyProcessed as u32));
    }

    let additional_fee = escrow_core::calculate_fee(env, additional_amount);
    let total_deposit = additional_amount + additional_fee;

    // Collect from depositor
    escrow_core::transfer_in(env, &escrow.token, &depositor, total_deposit);

    // Update state
    milestone.amount += additional_amount;
    escrow.total_amount += additional_amount;
    escrow.platform_fee += additional_fee;

    let token_key = escrow.token.clone().unwrap_or_else(|| env.current_contract_address());
    let current_escrowed: i128 = env
        .storage()
        .instance()
        .get(&DataKey::EscrowedAmount(token_key.clone()))
        .unwrap_or(0);
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage().instance().set(&DataKey::EscrowedAmount(token_key), &(current_escrowed + total_deposit));
    env.storage().instance().set(&DataKey::Milestone(escrow_id, milestone_index), &milestone);
    escrow_core::save_escrow(env, escrow_id, &escrow);
    Ok(())
}

/// Withdraw funds from a specific milestone on an open job before freelancer
/// assignment. `withdraw_amount` is the NET milestone reduction; the
/// proportional platform fee is refunded alongside it.
pub fn withdraw_job_funds(
    env: &Env,
    escrow_id: u32,
    depositor: Address,
    withdraw_amount: i128,
    milestone_index: u32,
) -> Result<(), Error> {
    depositor.require_auth();
    admin::require_not_paused(env)?;

    if withdraw_amount <= 0 {
        return Err(Error::from_contract_error(SecureFlowError::InvalidAmount as u32));
    }

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let mut escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.depositor != depositor {
        return Err(Error::from_contract_error(SecureFlowError::OnlyDepositor as u32));
    }
    if !escrow.is_open_job {
        return Err(Error::from_contract_error(SecureFlowError::CannotCancelAssignedJob as u32));
    }
    if escrow.status != EscrowStatus::Pending {
        return Err(Error::from_contract_error(SecureFlowError::InvalidEscrowStatus as u32));
    }
    if milestone_index >= escrow.milestone_count {
        return Err(Error::from_contract_error(SecureFlowError::MilestoneIndexOutOfBounds as u32));
    }

    let mut milestone: crate::storage_types::Milestone = env
        .storage()
        .instance()
        .get::<DataKey, crate::storage_types::Milestone>(&DataKey::Milestone(escrow_id, milestone_index))
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::InvalidMilestone as u32))?;

    if milestone.status != MilestoneStatus::NotStarted {
        return Err(Error::from_contract_error(SecureFlowError::MilestoneAlreadyProcessed as u32));
    }
    if withdraw_amount > milestone.amount {
        return Err(Error::from_contract_error(SecureFlowError::InvalidAmount as u32));
    }

    let fee_refund = escrow_core::calculate_fee(env, withdraw_amount);
    let total_refund = withdraw_amount + fee_refund;

    milestone.amount -= withdraw_amount;
    escrow.total_amount -= withdraw_amount;
    escrow.platform_fee = escrow.platform_fee.saturating_sub(fee_refund);

    let token_key = escrow.token.clone().unwrap_or_else(|| env.current_contract_address());
    let current_escrowed: i128 = env
        .storage()
        .instance()
        .get(&DataKey::EscrowedAmount(token_key.clone()))
        .unwrap_or(0);
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage().instance().set(&DataKey::EscrowedAmount(token_key), &(current_escrowed - total_refund));
    env.storage().instance().set(&DataKey::Milestone(escrow_id, milestone_index), &milestone);
    escrow_core::save_escrow(env, escrow_id, &escrow);

    escrow_core::do_transfer(env, &escrow.token, &depositor, total_refund);
    Ok(())
}

