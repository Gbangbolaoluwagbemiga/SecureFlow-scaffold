use crate::storage_types::{
    DataKey, SecureFlowError, INSTANCE_BUMP_AMOUNT, INSTANCE_LIFETIME_THRESHOLD,
};
// Note: delete_escrow also uses DataKey::Escrow, DataKey::Milestone — both in DataKey enum above
use soroban_sdk::{token, Address, Env, Error, String, Vec};

pub fn initialize(
    env: &Env,
    owner: Address,
    fee_collector: Address,
    platform_fee_bp: u32,
    default_whitelisted_tokens: Vec<Address>,
) -> Result<(), Error> {
    // Check if already initialized
    if env.storage().instance().has(&DataKey::Owner) {
        return Err(Error::from_contract_error(SecureFlowError::AlreadyInitialized as u32));
    }

    // Validate parameters
    if platform_fee_bp > 1000 {
        // Max 10% (1000 basis points)
        return Err(Error::from_contract_error(SecureFlowError::FeeTooHigh as u32));
    }

    // Extend instance TTL
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);

    // Set initial state
    env.storage().instance().set(&DataKey::Owner, &owner);
    env.storage()
        .instance()
        .set(&DataKey::FeeCollector, &fee_collector);
    env.storage()
        .instance()
        .set(&DataKey::PlatformFeeBP, &platform_fee_bp);
    env.storage().instance().set(&DataKey::NextEscrowId, &1u32);
    env.storage()
        .instance()
        .set(&DataKey::JobCreationPaused, &false);

    // Initialize lists
    env.storage()
        .instance()
        .set(&DataKey::WhitelistedTokens, &Vec::<Address>::new(env));
    env.storage()
        .instance()
        .set(&DataKey::AuthorizedArbiters, &Vec::<Address>::new(env));

    // Default whitelisted tokens (e.g., USDC on Stellar)
    for t in default_whitelisted_tokens.iter() {
        env.storage()
            .instance()
            .set(&DataKey::WhitelistedToken(t.clone()), &true);
        add_to_list_unique(env, DataKey::WhitelistedTokens, t.clone());
    }
    
    Ok(())
}

pub fn get_owner(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Owner)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::NotInitialized as u32))
}

pub fn require_owner(env: &Env) -> Result<(), Error> {
    let owner = get_owner(env)?;
    owner.require_auth();
    Ok(())
}

#[allow(dead_code)]
pub fn get_fee_collector(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::FeeCollector)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::NotInitialized as u32))
}

pub fn get_platform_fee_bp(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::PlatformFeeBP)
        .unwrap_or(0)
}

pub fn set_platform_fee_bp(env: &Env, fee_bp: u32) -> Result<(), Error> {
    require_owner(env)?;
    if fee_bp > 1000 {
        return Err(Error::from_contract_error(SecureFlowError::FeeTooHigh as u32));
    }
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage().instance().set(&DataKey::PlatformFeeBP, &fee_bp);
    Ok(())
}

pub fn set_fee_collector(env: &Env, fee_collector: Address) -> Result<(), Error> {
    require_owner(env)?;
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::FeeCollector, &fee_collector);
    Ok(())
}

pub fn set_owner(env: &Env, new_owner: Address) -> Result<(), Error> {
    require_owner(env)?;
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::Owner, &new_owner);
    Ok(())
}

pub fn add_to_list_unique(env: &Env, key: DataKey, value: Address) {
    let mut list: Vec<Address> = env.storage().instance().get(&key).unwrap_or(Vec::new(env));
    let mut exists = false;
    for item in list.iter() {
        if item == value {
            exists = true;
            break;
        }
    }
    if !exists {
        list.push_back(value);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
        env.storage().instance().set(&key, &list);
    }
}

pub fn remove_from_list(env: &Env, key: DataKey, value: &Address) {
    let list: Vec<Address> = env.storage().instance().get(&key).unwrap_or(Vec::new(env));
    let mut new_list: Vec<Address> = Vec::new(env);
    for item in list.iter() {
        if &item != value {
            new_list.push_back(item);
        }
    }
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage().instance().set(&key, &new_list);
}

pub fn remove_arbiter(env: &Env, arbiter: Address) -> Result<(), Error> {
    require_owner(env)?;
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    // Remove the individual lookup key
    env.storage()
        .instance()
        .remove(&DataKey::AuthorizedArbiter(arbiter.clone()));
    // Remove from the list
    remove_from_list(env, DataKey::AuthorizedArbiters, &arbiter);
    Ok(())
}

/// Owner-only: withdraw only the "excess" balance above what is currently escrowed.
/// This protects active escrows while allowing recovery of accidental transfers.
pub fn withdraw_stuck_funds(
    env: &Env,
    token_addr: Address,
    to: Address,
    amount: i128,
) -> Result<(), Error> {
    require_owner(env)?;

    if amount <= 0 {
        return Err(Error::from_contract_error(SecureFlowError::InvalidAmount as u32));
    }

    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);

    let escrowed: i128 = env
        .storage()
        .instance()
        .get(&DataKey::EscrowedAmount(token_addr.clone()))
        .unwrap_or(0);

    // Read actual on-chain token balance for this contract
    let token_client = token::Client::new(env, &token_addr);
    let bal = token_client.balance(&env.current_contract_address());

    let withdrawable = bal - escrowed;
    if withdrawable <= 0 || amount > withdrawable {
        return Err(Error::from_contract_error(
            SecureFlowError::InsufficientWithdrawable as u32,
        ));
    }

    token_client.transfer(&env.current_contract_address(), &to, &amount);
    Ok(())
}

pub fn is_job_creation_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::JobCreationPaused)
        .unwrap_or(false)
}

#[allow(dead_code)]
pub fn set_job_creation_paused(env: &Env, paused: bool) -> Result<(), Error> {
    require_owner(env)?;
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::JobCreationPaused, &paused);
    Ok(())
}

// ─── Full Contract Pause ──────────────────────────────────────────────────────

pub fn is_contract_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::ContractPaused)
        .unwrap_or(false)
}

/// Abort the current call if the contract is in emergency-paused state.
pub fn require_not_paused(env: &Env) -> Result<(), Error> {
    if is_contract_paused(env) {
        return Err(Error::from_contract_error(SecureFlowError::ContractIsPaused as u32));
    }
    Ok(())
}

/// Owner-only: pause all contract write operations (emergency).
pub fn pause_contract(env: &Env) -> Result<(), Error> {
    require_owner(env)?;
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage().instance().set(&DataKey::ContractPaused, &true);
    Ok(())
}

/// Owner-only: lift the emergency pause.
pub fn unpause_contract(env: &Env) -> Result<(), Error> {
    require_owner(env)?;
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage().instance().set(&DataKey::ContractPaused, &false);
    Ok(())
}

// ─── Token Blacklist ──────────────────────────────────────────────────────────

pub fn is_blacklisted_token(env: &Env, token: &Address) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::BlacklistedToken(token.clone()))
        .unwrap_or(false)
}

/// Owner-only: blacklist a token so it can no longer be used for new escrows.
pub fn blacklist_token(env: &Env, token: Address) -> Result<(), Error> {
    require_owner(env)?;
    if is_blacklisted_token(env, &token) {
        return Err(Error::from_contract_error(SecureFlowError::AlreadyBlacklisted as u32));
    }
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::BlacklistedToken(token.clone()), &true);
    add_to_list_unique(env, DataKey::BlacklistedTokens, token);
    Ok(())
}

/// Owner-only: remove a token from the blacklist.
pub fn unblacklist_token(env: &Env, token: Address) -> Result<(), Error> {
    require_owner(env)?;
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .remove(&DataKey::BlacklistedToken(token.clone()));
    remove_from_list(env, DataKey::BlacklistedTokens, &token);
    Ok(())
}

pub fn get_blacklisted_tokens(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::BlacklistedTokens)
        .unwrap_or(Vec::new(env))
}

// ─── Fee Withdrawal ───────────────────────────────────────────────────────────

/// Return the accumulated (unclaimed) platform fees for a given token.
/// Pass `None` for native XLM.
pub fn get_withdrawable_fees(env: &Env, token: Option<Address>) -> i128 {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    let key = token.unwrap_or_else(|| env.current_contract_address());
    env.storage()
        .instance()
        .get(&DataKey::TotalFeesByToken(key))
        .unwrap_or(0)
}

/// Fee collector: withdraw all accumulated platform fees for a given token.
/// Pass `None` for native XLM.
/// Owner-only: permanently delete a terminal escrow with no remaining funds.
/// Removes the escrow record, all its milestones, and user-index entries.
/// Status must be Released, Refunded, Expired, or Cancelled.
pub fn delete_escrow(env: &Env, escrow_id: u32) -> Result<(), Error> {
    use crate::escrow_core;
    use crate::storage_types::EscrowStatus;

    require_owner(env)?;

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    let is_terminal = escrow.status == EscrowStatus::Released
        || escrow.status == EscrowStatus::Refunded
        || escrow.status == EscrowStatus::Expired
        || escrow.status == EscrowStatus::Cancelled;

    if !is_terminal {
        return Err(Error::from_contract_error(SecureFlowError::EscrowNotTerminal as u32));
    }

    let remaining = escrow.total_amount.saturating_sub(escrow.paid_amount);
    if remaining > 0 {
        return Err(Error::from_contract_error(SecureFlowError::FundsStillLocked as u32));
    }

    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);

    // Remove milestones
    for i in 0..escrow.milestone_count {
        env.storage()
            .instance()
            .remove(&DataKey::Milestone(escrow_id, i));
    }

    // Remove escrow record
    env.storage().instance().remove(&DataKey::Escrow(escrow_id));

    // Remove from user indexes
    escrow_core::remove_user_escrow(env, escrow.depositor.clone(), escrow_id);
    if let Some(beneficiary) = escrow.beneficiary.clone() {
        escrow_core::remove_user_escrow(env, beneficiary, escrow_id);
    }

    Ok(())
}

pub fn withdraw_fees(env: &Env, token: Option<Address>, caller: Address) -> Result<(), Error> {
    let fee_collector: Address = env
        .storage()
        .instance()
        .get(&DataKey::FeeCollector)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::NotInitialized as u32))?;

    if fee_collector != caller {
        return Err(Error::from_contract_error(SecureFlowError::Unauthorized as u32));
    }
    caller.require_auth();

    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);

    let token_key = token.clone().unwrap_or_else(|| env.current_contract_address());
    let fees: i128 = env
        .storage()
        .instance()
        .get(&DataKey::TotalFeesByToken(token_key.clone()))
        .unwrap_or(0);

    if fees <= 0 {
        return Err(Error::from_contract_error(SecureFlowError::NothingToRefund as u32));
    }

    // Reset accumulated fees to zero before transfer (reentrancy guard)
    env.storage()
        .instance()
        .set(&DataKey::TotalFeesByToken(token_key), &0i128);

    if let Some(token_addr) = token {
        let token_client = token::Client::new(env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &caller, &fees);
    } else {
        let native_str = String::from_str(env, "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
        let native_addr = Address::from_string(&native_str);
        let native_client = token::Client::new(env, &native_addr);
        native_client.transfer(&env.current_contract_address(), &caller, &fees);
    }

    Ok(())
}

