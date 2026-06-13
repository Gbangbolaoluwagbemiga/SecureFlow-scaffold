use crate::admin;
use crate::escrow_core;
use crate::storage_types::{DataKey, EscrowStatus, OverdueRequest, SecureFlowError, INSTANCE_BUMP_AMOUNT, INSTANCE_LIFETIME_THRESHOLD};
use soroban_sdk::{token, Address, Env, Error, String};

const EMERGENCY_REFUND_DELAY: u32 = 2592000; // 30 days in seconds (legacy)

pub fn refund_escrow(env: &Env, escrow_id: u32, depositor: Address) -> Result<(), Error> {
    depositor.require_auth();
    admin::require_not_paused(env)?;

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let mut escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.depositor != depositor {
        return Err(Error::from_contract_error(SecureFlowError::OnlyDepositor as u32));
    }

    if escrow.status != EscrowStatus::Pending {
        return Err(Error::from_contract_error(SecureFlowError::InvalidEscrowStatus as u32));
    }

    if escrow.work_started {
        return Err(Error::from_contract_error(SecureFlowError::WorkAlreadyStarted as u32));
    }

    let current_ledger = env.ledger().sequence();
    if current_ledger >= escrow.deadline {
        return Err(Error::from_contract_error(SecureFlowError::DeadlineNotPassed as u32));
    }

    let refund_amount = escrow.total_amount - escrow.paid_amount;
    if refund_amount <= 0 {
        return Err(Error::from_contract_error(SecureFlowError::NothingToRefund as u32));
    }

    escrow.status = EscrowStatus::Refunded;

    // Update escrowed amount
    let token_key = escrow.token.clone().unwrap_or_else(|| env.current_contract_address());
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
            &(current_escrowed - refund_amount),
        );

    // Transfer refund
    if let Some(token_addr) = escrow.token.clone() {
        let token_client = token::Client::new(env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &depositor, &refund_amount);
    } else {
        // Transfer native XLM refund using Stellar Asset Contract (SAC)
        let native_token_str = String::from_str(env, "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
        let native_token_address = Address::from_string(&native_token_str);
        let native_token_client = token::Client::new(env, &native_token_address);
        native_token_client.transfer(
            &env.current_contract_address(),
            &depositor,
            &refund_amount,
        );
    }

    escrow_core::save_escrow(env, escrow_id, &escrow);
    Ok(())
}

pub fn emergency_refund_after_deadline(env: &Env, escrow_id: u32, depositor: Address) -> Result<(), Error> {
    depositor.require_auth();
    admin::require_not_paused(env)?;

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let mut escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.depositor != depositor {
        return Err(Error::from_contract_error(SecureFlowError::OnlyDepositor as u32));
    }

    let current_ledger = env.ledger().sequence();
    if current_ledger <= escrow.deadline + EMERGENCY_REFUND_DELAY {
        return Err(Error::from_contract_error(SecureFlowError::EmergencyPeriodNotReached as u32));
    }

    if escrow.status == EscrowStatus::Released || escrow.status == EscrowStatus::Refunded {
        return Err(Error::from_contract_error(SecureFlowError::CannotRefund as u32));
    }

    let refund_amount = escrow.total_amount - escrow.paid_amount;
    if refund_amount <= 0 {
        return Err(Error::from_contract_error(SecureFlowError::NothingToRefund as u32));
    }

    escrow.status = EscrowStatus::Expired;

    // Update escrowed amount
    let token_key = escrow.token.clone().unwrap_or_else(|| env.current_contract_address());
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
            &(current_escrowed - refund_amount),
        );

    // Transfer refund
    if let Some(token_addr) = escrow.token.clone() {
        let token_client = token::Client::new(env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &depositor, &refund_amount);
    } else {
        // Native XLM refund
    }

    escrow_core::save_escrow(env, escrow_id, &escrow);
    Ok(())
}

pub fn extend_deadline(env: &Env, escrow_id: u32, depositor: Address, extra_seconds: u32) -> Result<(), Error> {
    depositor.require_auth();

    if extra_seconds == 0 || extra_seconds > 2592000 {
        // Max 30 days
        return Err(Error::from_contract_error(SecureFlowError::InvalidExtension as u32));
    }

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let mut escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.depositor != depositor {
        return Err(Error::from_contract_error(SecureFlowError::OnlyDepositor as u32));
    }

    if escrow.status != EscrowStatus::InProgress && escrow.status != EscrowStatus::Pending {
        return Err(Error::from_contract_error(SecureFlowError::CannotExtend as u32));
    }

    escrow.deadline += extra_seconds as u32;
    escrow_core::save_escrow(env, escrow_id, &escrow);
    Ok(())
}

/// Raise an overdue dispute — callable by either the depositor or the beneficiary
/// once the project deadline has passed.
///
/// This flags the escrow for arbiter review. Neither party can directly pull
/// funds; resolution comes from `arbiter_approve_refund` or `arbiter_award_freelancer`.
pub fn raise_overdue_dispute(
    env: &Env,
    escrow_id: u32,
    requester: Address,
    reason: String,
) -> Result<(), Error> {
    requester.require_auth();

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let mut escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    // Only the depositor or current beneficiary can raise this
    let is_depositor = escrow.depositor == requester;
    let is_beneficiary = escrow.beneficiary == Some(requester.clone());
    if !is_depositor && !is_beneficiary {
        return Err(Error::from_contract_error(SecureFlowError::Unauthorized as u32));
    }

    // Must be past the deadline
    let current_ledger = env.ledger().sequence();
    if current_ledger <= escrow.deadline {
        return Err(Error::from_contract_error(SecureFlowError::DeadlineNotPassed as u32));
    }

    // Cannot re-open an already resolved escrow
    if escrow.status == EscrowStatus::Released
        || escrow.status == EscrowStatus::Refunded
        || escrow.status == EscrowStatus::Expired
    {
        return Err(Error::from_contract_error(SecureFlowError::CannotRefund as u32));
    }

    // Mark escrow as disputed and record the request
    escrow.status = EscrowStatus::Disputed;
    escrow_core::save_escrow(env, escrow_id, &escrow);

    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage().instance().set(
        &DataKey::OverdueRequest(escrow_id),
        &OverdueRequest {
            requester,
            reason,
            requested_at: current_ledger,
        },
    );

    Ok(())
}

/// Arbiter decision: refund all unreleased funds to the depositor (client).
///
/// Requires the caller to be a globally authorized arbiter.
pub fn arbiter_approve_refund(env: &Env, escrow_id: u32, arbiter: Address) -> Result<(), Error> {
    arbiter.require_auth();

    // Confirm caller is an authorized arbiter
    if !escrow_core::is_authorized_arbiter(env, arbiter.clone()) {
        return Err(Error::from_contract_error(SecureFlowError::Unauthorized as u32));
    }

    // Ensure an overdue request exists
    if env
        .storage()
        .instance()
        .get::<DataKey, OverdueRequest>(&DataKey::OverdueRequest(escrow_id))
        .is_none()
    {
        return Err(Error::from_contract_error(SecureFlowError::NoOverdueRequest as u32));
    }

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let mut escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.status == EscrowStatus::Released || escrow.status == EscrowStatus::Refunded {
        return Err(Error::from_contract_error(SecureFlowError::CannotRefund as u32));
    }

    let refund_amount = escrow.total_amount - escrow.paid_amount;
    if refund_amount <= 0 {
        return Err(Error::from_contract_error(SecureFlowError::NothingToRefund as u32));
    }

    escrow.status = EscrowStatus::Refunded;

    let token_key = escrow
        .token
        .clone()
        .unwrap_or_else(|| env.current_contract_address());
    let current_escrowed: i128 = env
        .storage()
        .instance()
        .get(&DataKey::EscrowedAmount(token_key.clone()))
        .unwrap_or(0);
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage().instance().set(
        &DataKey::EscrowedAmount(token_key),
        &(current_escrowed - refund_amount),
    );

    let depositor = escrow.depositor.clone();
    do_transfer(env, escrow.token.clone(), &env.current_contract_address(), &depositor, refund_amount);

    // Remove the request record
    env.storage()
        .instance()
        .remove(&DataKey::OverdueRequest(escrow_id));

    escrow_core::save_escrow(env, escrow_id, &escrow);
    Ok(())
}

/// Arbiter decision: award `freelancer_amount` to the beneficiary (freelancer)
/// and return the remainder to the depositor (client).
///
/// `freelancer_amount` must be ≤ the unreleased balance. Pass the full
/// unreleased balance to award everything to the freelancer.
pub fn arbiter_award_freelancer(
    env: &Env,
    escrow_id: u32,
    arbiter: Address,
    freelancer_amount: i128,
) -> Result<(), Error> {
    arbiter.require_auth();

    if !escrow_core::is_authorized_arbiter(env, arbiter.clone()) {
        return Err(Error::from_contract_error(SecureFlowError::Unauthorized as u32));
    }

    if env
        .storage()
        .instance()
        .get::<DataKey, OverdueRequest>(&DataKey::OverdueRequest(escrow_id))
        .is_none()
    {
        return Err(Error::from_contract_error(SecureFlowError::NoOverdueRequest as u32));
    }

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let mut escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.status == EscrowStatus::Released || escrow.status == EscrowStatus::Refunded {
        return Err(Error::from_contract_error(SecureFlowError::CannotRefund as u32));
    }

    let available = escrow.total_amount - escrow.paid_amount;
    if freelancer_amount < 0 || freelancer_amount > available {
        return Err(Error::from_contract_error(SecureFlowError::InvalidAmount as u32));
    }

    let beneficiary = escrow
        .beneficiary
        .clone()
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::InvalidAddress as u32))?;

    escrow.status = EscrowStatus::Released;
    escrow.paid_amount += freelancer_amount;

    let token_key = escrow
        .token
        .clone()
        .unwrap_or_else(|| env.current_contract_address());
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
        .set(&DataKey::EscrowedAmount(token_key), &(current_escrowed - available));

    // Pay freelancer their portion
    if freelancer_amount > 0 {
        do_transfer(env, escrow.token.clone(), &env.current_contract_address(), &beneficiary, freelancer_amount);
    }

    // Return remainder to depositor
    let client_amount = available - freelancer_amount;
    if client_amount > 0 {
        let depositor = escrow.depositor.clone();
        do_transfer(env, escrow.token.clone(), &env.current_contract_address(), &depositor, client_amount);
    }

    env.storage()
        .instance()
        .remove(&DataKey::OverdueRequest(escrow_id));

    escrow_core::save_escrow(env, escrow_id, &escrow);
    Ok(())
}

/// Get the overdue request for an escrow, if one exists.
pub fn get_overdue_request(env: &Env, escrow_id: u32) -> Option<OverdueRequest> {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .get(&DataKey::OverdueRequest(escrow_id))
}

/// Internal helper: transfer tokens or native XLM.
fn do_transfer(env: &Env, token: Option<Address>, from: &Address, to: &Address, amount: i128) {
    if let Some(token_addr) = token {
        let token_client = token::Client::new(env, &token_addr);
        token_client.transfer(from, to, &amount);
    } else {
        let native_str = String::from_str(env, "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
        let native_addr = Address::from_string(&native_str);
        let native_client = token::Client::new(env, &native_addr);
        native_client.transfer(from, to, &amount);
    }
}

