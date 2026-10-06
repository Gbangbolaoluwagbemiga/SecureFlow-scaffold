//! Owner and fee-collector operations.

use crate::escrow_core::{self, sub};
use crate::events;
use crate::storage_types::{
    DataKey, EscrowStatus, SecureFlowError, SfResult, INSTANCE_BUMP_AMOUNT,
    INSTANCE_LIFETIME_THRESHOLD, MAX_PLATFORM_FEE_BP,
};
use soroban_sdk::{symbol_short, token, Address, Env, Symbol, Vec};

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

pub fn initialize(
    env: &Env,
    owner: Address,
    fee_collector: Address,
    platform_fee_bp: u32,
    default_whitelisted_tokens: Vec<Address>,
) -> SfResult<()> {
    if env.storage().instance().has(&DataKey::Owner) {
        return Err(SecureFlowError::AlreadyInitialized);
    }
    if platform_fee_bp > MAX_PLATFORM_FEE_BP {
        return Err(SecureFlowError::FeeTooHigh);
    }
    // The deployer names the owner, and the owner must agree. Without this
    // anybody watching the deploy could initialise the contract first with
    // themselves as owner.
    owner.require_auth();

    let instance = env.storage().instance();
    instance.set(&DataKey::Owner, &owner);
    instance.set(&DataKey::FeeCollector, &fee_collector);
    instance.set(&DataKey::PlatformFeeBP, &platform_fee_bp);
    instance.set(&DataKey::NextEscrowId, &1u32);
    instance.set(&DataKey::JobCreationPaused, &false);
    instance.set(&DataKey::ContractPaused, &false);
    instance.set(&DataKey::NativeToken, &escrow_core::native_token(env));
    instance.set(&DataKey::WhitelistedTokens, &Vec::<Address>::new(env));
    instance.set(&DataKey::AuthorizedArbiters, &Vec::<Address>::new(env));
    instance.set(&DataKey::BlacklistedTokens, &Vec::<Address>::new(env));

    for t in default_whitelisted_tokens.iter() {
        instance.set(&DataKey::WhitelistedToken(t.clone()), &true);
        add_to_list_unique(env, DataKey::WhitelistedTokens, t);
    }
    bump_instance(env);
    Ok(())
}

// ─── Owner ───────────────────────────────────────────────────────────────────

pub fn get_owner(env: &Env) -> SfResult<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Owner)
        .ok_or(SecureFlowError::NotInitialized)
}

pub fn require_owner(env: &Env) -> SfResult<Address> {
    let owner = get_owner(env)?;
    owner.require_auth();
    bump_instance(env);
    Ok(owner)
}

/// Hand the contract to a new owner. BOTH must sign: a mistyped address can
/// therefore never receive ownership, because nobody holds its key to agree.
pub fn set_owner(env: &Env, new_owner: Address) -> SfResult<()> {
    let previous = require_owner(env)?;
    new_owner.require_auth();
    env.storage().instance().set(&DataKey::Owner, &new_owner);
    events::OwnerChanged {
        previous_owner: previous,
        new_owner,
    }
    .publish(env);
    Ok(())
}

// ─── Fees ────────────────────────────────────────────────────────────────────

pub fn get_fee_collector(env: &Env) -> SfResult<Address> {
    env.storage()
        .instance()
        .get(&DataKey::FeeCollector)
        .ok_or(SecureFlowError::NotInitialized)
}

pub fn get_platform_fee_bp(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::PlatformFeeBP)
        .unwrap_or(0)
}

/// Applies to escrows created from now on. Existing escrows keep the fee they
/// were created with.
pub fn set_platform_fee_bp(env: &Env, fee_bp: u32) -> SfResult<()> {
    require_owner(env)?;
    if fee_bp > MAX_PLATFORM_FEE_BP {
        return Err(SecureFlowError::FeeTooHigh);
    }
    env.storage()
        .instance()
        .set(&DataKey::PlatformFeeBP, &fee_bp);
    events::PlatformFeeUpdated { fee_bp }.publish(env);
    Ok(())
}

pub fn set_fee_collector(env: &Env, fee_collector: Address) -> SfResult<()> {
    require_owner(env)?;
    if fee_collector == env.current_contract_address() {
        return Err(SecureFlowError::InvalidAddress);
    }
    env.storage()
        .instance()
        .set(&DataKey::FeeCollector, &fee_collector);
    events::FeeCollectorUpdated { fee_collector }.publish(env);
    Ok(())
}

/// Earned, unwithdrawn fees for a token (`None` = native XLM).
pub fn get_withdrawable_fees(env: &Env, token: Option<Address>) -> i128 {
    let key = DataKey::TotalFeesByToken(escrow_core::token_address(env, token.as_ref()));
    env.storage().instance().get(&key).unwrap_or(0)
}

/// Fee collector withdraws every EARNED fee for a token. Fees still held for
/// live escrows are not touched — they may yet be refunded to a client.
pub fn withdraw_fees(env: &Env, token: Option<Address>, caller: Address) -> SfResult<()> {
    caller.require_auth();
    if caller != get_fee_collector(env)? {
        return Err(SecureFlowError::OnlyFeeCollector);
    }
    let token_addr = escrow_core::token_address(env, token.as_ref());
    let key = DataKey::TotalFeesByToken(token_addr.clone());
    let fees: i128 = env.storage().instance().get(&key).unwrap_or(0);
    if fees <= 0 {
        return Err(SecureFlowError::NoFeesToWithdraw);
    }
    env.storage().instance().set(&key, &0i128);
    bump_instance(env);
    escrow_core::pay_out(env, token.as_ref(), &caller, fees)?;
    events::FeesWithdrawn {
        token: token_addr,
        amount: fees,
        to: caller,
    }
    .publish(env);
    Ok(())
}

/// Owner recovers tokens sent to the contract by mistake: only the surplus
/// above everything owed to escrows AND every earned fee.
pub fn withdraw_stuck_funds(
    env: &Env,
    token_addr: Address,
    to: Address,
    amount: i128,
) -> SfResult<()> {
    require_owner(env)?;
    if amount <= 0 {
        return Err(SecureFlowError::InvalidAmount);
    }
    let instance = env.storage().instance();
    let owed: i128 = instance
        .get(&DataKey::EscrowedAmount(token_addr.clone()))
        .unwrap_or(0);
    let fees: i128 = instance
        .get(&DataKey::TotalFeesByToken(token_addr.clone()))
        .unwrap_or(0);
    let balance =
        token::TokenClient::new(env, &token_addr).balance(&env.current_contract_address());
    let surplus = sub(sub(balance, owed)?, fees)?;
    if surplus <= 0 || amount > surplus {
        return Err(SecureFlowError::InsufficientWithdrawable);
    }
    escrow_core::pay_out(env, Some(&token_addr), &to, amount)?;
    events::StuckFundsWithdrawn {
        token: token_addr,
        amount,
        to,
    }
    .publish(env);
    Ok(())
}

// ─── Lists ───────────────────────────────────────────────────────────────────

pub fn add_to_list_unique(env: &Env, key: DataKey, value: Address) {
    let mut list: Vec<Address> = env.storage().instance().get(&key).unwrap_or(Vec::new(env));
    if !list.contains(&value) {
        list.push_back(value);
        env.storage().instance().set(&key, &list);
    }
}

pub fn remove_from_list(env: &Env, key: DataKey, value: &Address) {
    let mut list: Vec<Address> = env.storage().instance().get(&key).unwrap_or(Vec::new(env));
    if let Some(pos) = list.first_index_of(value) {
        list.remove(pos);
        env.storage().instance().set(&key, &list);
    }
}

fn token_event(env: &Env, token: Address, change: Symbol) {
    events::TokenListChanged { token, change }.publish(env);
}

pub fn whitelist_token(env: &Env, token: Address) -> SfResult<()> {
    require_owner(env)?;
    env.storage()
        .instance()
        .set(&DataKey::WhitelistedToken(token.clone()), &true);
    add_to_list_unique(env, DataKey::WhitelistedTokens, token.clone());
    token_event(env, token, symbol_short!("whitelist"));
    Ok(())
}

/// Stops NEW escrows in this token. Escrows already funded with it continue.
pub fn delist_token(env: &Env, token: Address) -> SfResult<()> {
    require_owner(env)?;
    env.storage()
        .instance()
        .remove(&DataKey::WhitelistedToken(token.clone()));
    remove_from_list(env, DataKey::WhitelistedTokens, &token);
    token_event(env, token, symbol_short!("delist"));
    Ok(())
}

pub fn get_whitelisted_tokens(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::WhitelistedTokens)
        .unwrap_or(Vec::new(env))
}

pub fn is_blacklisted_token(env: &Env, token: &Address) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::BlacklistedToken(token.clone()))
        .unwrap_or(false)
}

pub fn blacklist_token(env: &Env, token: Address) -> SfResult<()> {
    require_owner(env)?;
    if is_blacklisted_token(env, &token) {
        return Err(SecureFlowError::AlreadyBlacklisted);
    }
    env.storage()
        .instance()
        .set(&DataKey::BlacklistedToken(token.clone()), &true);
    add_to_list_unique(env, DataKey::BlacklistedTokens, token.clone());
    token_event(env, token, symbol_short!("blacklist"));
    Ok(())
}

pub fn unblacklist_token(env: &Env, token: Address) -> SfResult<()> {
    require_owner(env)?;
    if !is_blacklisted_token(env, &token) {
        return Err(SecureFlowError::TokenNotBlacklisted);
    }
    env.storage()
        .instance()
        .remove(&DataKey::BlacklistedToken(token.clone()));
    remove_from_list(env, DataKey::BlacklistedTokens, &token);
    token_event(env, token, symbol_short!("unblack"));
    Ok(())
}

pub fn get_blacklisted_tokens(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::BlacklistedTokens)
        .unwrap_or(Vec::new(env))
}

// ─── Arbiters ────────────────────────────────────────────────────────────────

pub fn authorize_arbiter(env: &Env, arbiter: Address) -> SfResult<()> {
    require_owner(env)?;
    if arbiter == env.current_contract_address() {
        return Err(SecureFlowError::InvalidAddress);
    }
    env.storage()
        .instance()
        .set(&DataKey::AuthorizedArbiter(arbiter.clone()), &true);
    add_to_list_unique(env, DataKey::AuthorizedArbiters, arbiter.clone());
    events::ArbiterAuthorized { arbiter }.publish(env);
    Ok(())
}

/// Takes effect immediately, including on disputes already open: a revoked
/// arbiter's earlier votes stop counting toward quorum.
pub fn remove_arbiter(env: &Env, arbiter: Address) -> SfResult<()> {
    require_owner(env)?;
    env.storage()
        .instance()
        .remove(&DataKey::AuthorizedArbiter(arbiter.clone()));
    remove_from_list(env, DataKey::AuthorizedArbiters, &arbiter);
    events::ArbiterRevoked { arbiter }.publish(env);
    Ok(())
}

pub fn get_authorized_arbiters(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::AuthorizedArbiters)
        .unwrap_or(Vec::new(env))
}

// ─── Pause ───────────────────────────────────────────────────────────────────

pub fn is_job_creation_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::JobCreationPaused)
        .unwrap_or(false)
}

pub fn set_job_creation_paused(env: &Env, paused: bool) -> SfResult<()> {
    require_owner(env)?;
    env.storage()
        .instance()
        .set(&DataKey::JobCreationPaused, &paused);
    events::PauseChanged {
        scope: symbol_short!("jobs"),
        paused,
    }
    .publish(env);
    Ok(())
}

pub fn is_contract_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::ContractPaused)
        .unwrap_or(false)
}

pub fn require_not_paused(env: &Env) -> SfResult<()> {
    if is_contract_paused(env) {
        return Err(SecureFlowError::ContractIsPaused);
    }
    Ok(())
}

/// Emergency stop for user actions. Deliberately NOT gated by it: the
/// client's emergency refund and arbiter rulings — the paths that get money
/// OUT to its rightful owner while everything else is frozen.
pub fn set_contract_paused(env: &Env, paused: bool) -> SfResult<()> {
    require_owner(env)?;
    env.storage()
        .instance()
        .set(&DataKey::ContractPaused, &paused);
    events::PauseChanged {
        scope: symbol_short!("contract"),
        paused,
    }
    .publish(env);
    Ok(())
}

// ─── Escrow records ──────────────────────────────────────────────────────────

/// Permanently delete a settled escrow and everything stored under it.
pub fn delete_escrow(env: &Env, escrow_id: u32) -> SfResult<()> {
    require_owner(env)?;
    let escrow = escrow_core::load_escrow(env, escrow_id)?;
    if !escrow_core::is_terminal(&escrow.status) {
        return Err(SecureFlowError::EscrowNotTerminal);
    }
    // A Released/Refunded escrow has paid == total. Expired and Cancelled keep
    // their totals for the record but have returned the money, so only a live
    // status could still be holding principal — and that was refused above.
    if escrow.status == EscrowStatus::Released && escrow.total_amount != escrow.paid_amount {
        return Err(SecureFlowError::FundsStillLocked);
    }

    for i in 0..escrow.milestone_count {
        escrow_core::p_remove(env, &DataKey::Milestone(escrow_id, i));
        escrow_core::p_remove(env, &DataKey::Evidence(escrow_id, i));
    }
    let applicants: Vec<Address> =
        escrow_core::p_get(env, &DataKey::Applicants(escrow_id)).unwrap_or(Vec::new(env));
    for a in applicants.iter() {
        escrow_core::p_remove(env, &DataKey::Application(escrow_id, a));
    }
    for key in [
        DataKey::Applicants(escrow_id),
        DataKey::JobManager(escrow_id),
        DataKey::Arbitrated(escrow_id),
        DataKey::OverdueRequest(escrow_id),
        DataKey::DisputeVoters(escrow_id),
        DataKey::Escrow(escrow_id),
    ] {
        escrow_core::p_remove(env, &key);
    }

    escrow_core::remove_user_escrow(env, escrow.depositor.clone(), escrow_id);
    if let Some(b) = escrow.beneficiary {
        escrow_core::remove_user_escrow(env, b, escrow_id);
    }
    events::EscrowDeleted { escrow_id }.publish(env);
    Ok(())
}
