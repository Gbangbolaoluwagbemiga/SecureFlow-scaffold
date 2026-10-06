//! Shared building blocks: storage access, checked arithmetic, token movement,
//! role checks, and the accounting every money-moving function goes through.
//!
//! Nothing here panics. Every failure is a `SecureFlowError`, and arithmetic
//! goes through `add`/`sub`/`mul_div` so an overflow is a refusal rather than
//! an abort (`overflow-checks = true` in the release profile would otherwise
//! turn it into an opaque trap).

use crate::admin;
use crate::events;
use crate::storage_types::{
    DataKey, EscrowData, EscrowStatus, Milestone, MilestoneStatus, SecureFlowError, SfResult,
    PERSISTENT_BUMP_AMOUNT, PERSISTENT_LIFETIME_THRESHOLD,
};
use soroban_sdk::{token, Address, Bytes, Env, IntoVal, TryFromVal, Val, Vec};

const REPUTATION_PER_MILESTONE: u32 = 10;
const REPUTATION_PER_ESCROW: u32 = 25;
/// Escrows below this (0.1 of a 7-decimal token) earn no reputation, so it
/// cannot be farmed with dust jobs.
const MIN_REP_ELIGIBLE_ESCROW_VALUE: i128 = 1_000_000;

// ─── Checked arithmetic ──────────────────────────────────────────────────────

pub fn add(a: i128, b: i128) -> SfResult<i128> {
    a.checked_add(b).ok_or(SecureFlowError::ArithmeticOverflow)
}

pub fn sub(a: i128, b: i128) -> SfResult<i128> {
    a.checked_sub(b).ok_or(SecureFlowError::ArithmeticOverflow)
}

/// `a * b / d`, refusing on overflow or a zero divisor.
pub fn mul_div(a: i128, b: i128, d: i128) -> SfResult<i128> {
    if d == 0 {
        return Err(SecureFlowError::ArithmeticOverflow);
    }
    a.checked_mul(b)
        .and_then(|x| x.checked_div(d))
        .ok_or(SecureFlowError::ArithmeticOverflow)
}

pub fn add_u32(a: u32, b: u32) -> SfResult<u32> {
    a.checked_add(b).ok_or(SecureFlowError::ArithmeticOverflow)
}

/// Seconds -> ledgers, rounding up so a deadline is never shorter than asked.
pub fn seconds_to_ledgers(seconds: u32) -> u32 {
    let l = crate::storage_types::LEDGER_SECONDS;
    seconds.div_ceil(l)
}

// ─── Persistent storage ──────────────────────────────────────────────────────

pub fn p_get<V: TryFromVal<Env, Val>>(env: &Env, key: &DataKey) -> Option<V> {
    env.storage().persistent().get(key)
}

pub fn p_set<V: IntoVal<Env, Val>>(env: &Env, key: &DataKey, value: &V) {
    let storage = env.storage().persistent();
    storage.set(key, value);
    storage.extend_ttl(key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

pub fn p_has(env: &Env, key: &DataKey) -> bool {
    env.storage().persistent().has(key)
}

pub fn p_remove(env: &Env, key: &DataKey) {
    env.storage().persistent().remove(key);
}

// ─── Escrows & milestones ────────────────────────────────────────────────────

pub fn get_escrow(env: &Env, escrow_id: u32) -> Option<EscrowData> {
    p_get(env, &DataKey::Escrow(escrow_id))
}

pub fn load_escrow(env: &Env, escrow_id: u32) -> SfResult<EscrowData> {
    get_escrow(env, escrow_id).ok_or(SecureFlowError::EscrowNotFound)
}

/// Also keeps the contract instance (and code) alive: every user action that
/// changes an escrow ends here.
pub fn save_escrow(env: &Env, escrow_id: u32, escrow: &EscrowData) {
    p_set(env, &DataKey::Escrow(escrow_id), escrow);
    admin::bump_instance(env);
}

pub fn get_milestone(env: &Env, escrow_id: u32, index: u32) -> Option<Milestone> {
    p_get(env, &DataKey::Milestone(escrow_id, index))
}

/// Load a milestone, refusing an index past the end of this escrow.
pub fn load_milestone(
    env: &Env,
    escrow: &EscrowData,
    escrow_id: u32,
    index: u32,
) -> SfResult<Milestone> {
    if index >= escrow.milestone_count {
        return Err(SecureFlowError::InvalidMilestone);
    }
    get_milestone(env, escrow_id, index).ok_or(SecureFlowError::InvalidMilestone)
}

pub fn save_milestone(env: &Env, escrow_id: u32, index: u32, milestone: &Milestone) {
    p_set(env, &DataKey::Milestone(escrow_id, index), milestone);
}

pub fn get_milestones(env: &Env, escrow_id: u32) -> Vec<Milestone> {
    let mut out = Vec::new(env);
    if let Some(escrow) = get_escrow(env, escrow_id) {
        for i in 0..escrow.milestone_count {
            if let Some(m) = get_milestone(env, escrow_id, i) {
                out.push_back(m);
            }
        }
    }
    out
}

/// A fresh milestone: the client's text is both the requirement (permanent)
/// and the description (until the freelancer submits over it).
pub fn new_milestone(amount: i128, text: soroban_sdk::String) -> Milestone {
    Milestone {
        description: text.clone(),
        requirements: text,
        amount,
        status: MilestoneStatus::NotStarted,
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
    }
}

pub fn increment_next_escrow_id(env: &Env) -> SfResult<u32> {
    let current: u32 = env
        .storage()
        .instance()
        .get(&DataKey::NextEscrowId)
        .unwrap_or(1);
    let next = add_u32(current, 1)?;
    env.storage().instance().set(&DataKey::NextEscrowId, &next);
    Ok(current)
}

// ─── User indexes ────────────────────────────────────────────────────────────

pub fn get_user_escrows(env: &Env, user: Address) -> Vec<u32> {
    p_get(env, &DataKey::UserEscrows(user)).unwrap_or(Vec::new(env))
}

pub fn add_user_escrow(env: &Env, user: Address, escrow_id: u32) {
    let key = DataKey::UserEscrows(user);
    let mut list: Vec<u32> = p_get(env, &key).unwrap_or(Vec::new(env));
    if !list.contains(escrow_id) {
        list.push_back(escrow_id);
        p_set(env, &key, &list);
    }
}

pub fn remove_user_escrow(env: &Env, user: Address, escrow_id: u32) {
    let key = DataKey::UserEscrows(user);
    let list: Vec<u32> = p_get(env, &key).unwrap_or(Vec::new(env));
    if let Some(pos) = list.first_index_of(escrow_id) {
        let mut list = list;
        list.remove(pos);
        p_set(env, &key, &list);
    }
}

pub fn get_reputation(env: &Env, user: Address) -> u32 {
    p_get(env, &DataKey::Reputation(user)).unwrap_or(0)
}

fn bump_counter(env: &Env, key: DataKey, by: u32) {
    let current: u32 = p_get(env, &key).unwrap_or(0);
    p_set(env, &key, &current.saturating_add(by));
}

// ─── Roles ───────────────────────────────────────────────────────────────────

pub fn get_job_manager(env: &Env, escrow_id: u32) -> Option<Address> {
    p_get(env, &DataKey::JobManager(escrow_id))
}

pub fn require_depositor(escrow: &EscrowData, caller: &Address) -> SfResult<()> {
    if &escrow.depositor != caller {
        return Err(SecureFlowError::OnlyDepositor);
    }
    Ok(())
}

pub fn require_beneficiary(escrow: &EscrowData, caller: &Address) -> SfResult<()> {
    match &escrow.beneficiary {
        Some(b) if b == caller => Ok(()),
        _ => Err(SecureFlowError::OnlyBeneficiary),
    }
}

/// The client, or the manager the client appointed.
///
/// A manager may do the LABOUR of running a job — hire, approve, reject,
/// escalate — and nothing that moves money anywhere but to the freelancer.
/// That is the one-way key: no action a manager can take sends value to the
/// manager, which holds because a manager can never be the freelancer
/// (enforced in `set_job_manager` and again in `accept_freelancer`).
pub fn require_depositor_or_manager(
    env: &Env,
    escrow: &EscrowData,
    escrow_id: u32,
    caller: &Address,
) -> SfResult<()> {
    if &escrow.depositor == caller {
        return Ok(());
    }
    match get_job_manager(env, escrow_id) {
        Some(m) if &m == caller => Ok(()),
        _ => Err(SecureFlowError::OnlyDepositorOrManager),
    }
}

pub fn is_party(env: &Env, escrow: &EscrowData, escrow_id: u32, who: &Address) -> bool {
    &escrow.depositor == who
        || escrow.beneficiary.as_ref() == Some(who)
        || get_job_manager(env, escrow_id).as_ref() == Some(who)
}

pub fn is_authorized_arbiter(env: &Env, arbiter: &Address) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::AuthorizedArbiter(arbiter.clone()))
        .unwrap_or(false)
}

/// Does the panel this escrow named contain anybody who can still act?
fn panel_has_live_member(env: &Env, escrow: &EscrowData) -> bool {
    escrow
        .arbiters
        .iter()
        .any(|a| is_authorized_arbiter(env, &a))
}

/// May `who` (already known to be an authorised arbiter) rule on this escrow?
///
/// The panel a client named decides, but only while somebody on it can
/// actually act. Panels are not required to hold protocol authority, and
/// authority is revocable, so a panel can be made of addresses that never
/// could arbitrate — the frontend's placeholder arbiter is exactly that.
/// Enforcing the panel unconditionally would leave such an escrow's money with
/// nowhere to go. So: no panel, or a panel with nobody live on it, and the
/// protocol's arbiters govern; otherwise only the panel rules.
pub fn panel_allows(env: &Env, escrow: &EscrowData, who: &Address) -> bool {
    if escrow.arbiters.is_empty() || escrow.arbiters.contains(who) {
        return true;
    }
    !panel_has_live_member(env, escrow)
}

/// All the checks an arbiter must pass before voting on an escrow.
pub fn require_arbiter_for(
    env: &Env,
    escrow: &EscrowData,
    escrow_id: u32,
    arbiter: &Address,
) -> SfResult<()> {
    if !is_authorized_arbiter(env, arbiter) {
        return Err(SecureFlowError::OnlyArbiter);
    }
    if is_party(env, escrow, escrow_id, arbiter) {
        return Err(SecureFlowError::ArbiterIsParty);
    }
    if !panel_allows(env, escrow, arbiter) {
        return Err(SecureFlowError::NotOnArbiterPanel);
    }
    Ok(())
}

/// How many agreeing votes settle a dispute on this escrow.
///
/// The client's `required_confirmations` when their panel is live. When the
/// protocol arbiters are standing in, capped at how many of those exist, so a
/// panel of three dead addresses cannot demand three votes from a protocol
/// that has one arbiter and lock the job for ever.
pub fn quorum(env: &Env, escrow: &EscrowData) -> u32 {
    let required = escrow.required_confirmations.max(1);
    if !escrow.arbiters.is_empty() && panel_has_live_member(env, escrow) {
        return required;
    }
    let available = admin::get_authorized_arbiters(env).len();
    required.min(available).max(1)
}

// ─── Tokens ──────────────────────────────────────────────────────────────────

/// The native XLM Stellar Asset Contract on whatever network this runs on.
///
/// Derived from the native asset rather than hard-coded: the old contract
/// carried the TESTNET address as a string literal, so the same build would
/// have moved nothing (or the wrong thing) on mainnet.
pub fn native_token(env: &Env) -> Address {
    if let Some(addr) = env.storage().instance().get(&DataKey::NativeToken) {
        return addr;
    }
    // XDR of `Asset::Native` is the 4-byte discriminant 0.
    let native_asset = Bytes::from_array(env, &[0u8; 4]);
    env.deployer()
        .with_stellar_asset(native_asset)
        .deployed_address()
}

/// `None` means native XLM.
pub fn token_address(env: &Env, token: Option<&Address>) -> Address {
    match token {
        Some(t) => t.clone(),
        None => native_token(env),
    }
}

/// Move `amount` from this contract to `to`. Zero is a no-op.
pub fn pay_out(env: &Env, token: Option<&Address>, to: &Address, amount: i128) -> SfResult<()> {
    if amount < 0 {
        return Err(SecureFlowError::InvalidAmount);
    }
    if amount == 0 {
        return Ok(());
    }
    let client = token::TokenClient::new(env, &token_address(env, token));
    match client.try_transfer(&env.current_contract_address(), to, &amount) {
        Ok(Ok(())) => Ok(()),
        _ => Err(SecureFlowError::TokenTransferFailed),
    }
}

/// Pull `amount` from `from` into this contract. `from` must have authorised
/// the call. Zero is a no-op.
pub fn pull_in(env: &Env, token: Option<&Address>, from: &Address, amount: i128) -> SfResult<()> {
    if amount < 0 {
        return Err(SecureFlowError::InvalidAmount);
    }
    if amount == 0 {
        return Ok(());
    }
    let client = token::TokenClient::new(env, &token_address(env, token));
    match client.try_transfer(from, env.current_contract_address(), &amount) {
        Ok(Ok(())) => Ok(()),
        _ => Err(SecureFlowError::TokenTransferFailed),
    }
}

pub fn is_whitelisted_token(env: &Env, token: Option<Address>) -> bool {
    match token {
        None => true, // native XLM is always accepted
        Some(addr) => {
            if admin::is_blacklisted_token(env, &addr) {
                return false;
            }
            env.storage()
                .instance()
                .get(&DataKey::WhitelistedToken(addr))
                .unwrap_or(false)
        }
    }
}

// ─── Accounting ──────────────────────────────────────────────────────────────
//
// Two numbers per token, both in instance storage:
//   EscrowedAmount   everything still owed to escrows: unpaid principal plus
//                    fees held but not yet earned
//   TotalFeesByToken fees EARNED and not yet withdrawn
//
// The contract's real balance minus both is genuinely surplus, which is what
// `withdraw_stuck_funds` may take and nothing more.

fn adjust_instance_i128(env: &Env, key: DataKey, delta: i128) -> SfResult<()> {
    let current: i128 = env.storage().instance().get(&key).unwrap_or(0);
    let next = add(current, delta)?;
    env.storage().instance().set(&key, &next);
    Ok(())
}

pub fn liabilities_add(env: &Env, token: Option<&Address>, amount: i128) -> SfResult<()> {
    adjust_instance_i128(
        env,
        DataKey::EscrowedAmount(token_address(env, token)),
        amount,
    )
}

pub fn liabilities_sub(env: &Env, token: Option<&Address>, amount: i128) -> SfResult<()> {
    let neg = sub(0, amount)?;
    adjust_instance_i128(env, DataKey::EscrowedAmount(token_address(env, token)), neg)
}

pub fn fees_credit(env: &Env, token: Option<&Address>, amount: i128) -> SfResult<()> {
    if amount == 0 {
        return Ok(());
    }
    adjust_instance_i128(
        env,
        DataKey::TotalFeesByToken(token_address(env, token)),
        amount,
    )
}

/// Fee for a new escrow of `amount`, at the current platform rate.
pub fn calculate_fee(env: &Env, amount: i128) -> SfResult<i128> {
    let fee_bp = i128::from(admin::get_platform_fee_bp(env));
    if fee_bp == 0 {
        return Ok(0);
    }
    mul_div(amount, fee_bp, 10_000)
}

/// The fee that belongs to `part` of this escrow, at the rate THIS escrow
/// pays — not today's platform rate.
///
/// Every function that grows or shrinks a funded job uses this. Using the
/// global rate instead charges a job created at 0 % a fee its client was told
/// they would not pay, and tries to refund a fee that was never taken — which
/// underflows. Scaling by what the escrow holds is right at both ends, and a
/// refund can never exceed what was collected.
pub fn fee_share(escrow: &EscrowData, part: i128) -> SfResult<i128> {
    if escrow.platform_fee == 0 || escrow.total_amount == 0 || part == 0 {
        return Ok(0);
    }
    mul_div(part, escrow.platform_fee, escrow.total_amount)
}

pub fn update_reputation(env: &Env, user: &Address, points: u32) {
    bump_counter(env, DataKey::Reputation(user.clone()), points);
}

pub fn reward_milestone(env: &Env, escrow: &EscrowData, beneficiary: &Address) {
    if escrow.total_amount >= MIN_REP_ELIGIBLE_ESCROW_VALUE {
        update_reputation(env, beneficiary, REPUTATION_PER_MILESTONE);
    }
}

/// Close out an escrow whose last unit of principal has just been paid or
/// returned. Call after `paid_amount`/`total_amount` have been updated.
///
/// If anything was paid to the freelancer the job is Released: the remaining
/// held fee becomes revenue, both sides earn reputation, and ratings open.
/// If nothing was (every milestone went back to the client) it is Refunded and
/// the remaining held fee goes back too.
///
/// Returns `true` when the escrow was closed.
pub fn finalize_if_complete(env: &Env, escrow_id: u32, escrow: &mut EscrowData) -> SfResult<bool> {
    if escrow.paid_amount != escrow.total_amount {
        return Ok(false);
    }
    let fee = escrow.platform_fee;
    escrow.platform_fee = 0;
    liabilities_sub(env, escrow.token.as_ref(), fee)?;

    if escrow.total_amount == 0 {
        escrow.status = EscrowStatus::Refunded;
        pay_out(env, escrow.token.as_ref(), &escrow.depositor, fee)?;
        events::EscrowRefunded {
            escrow_id,
            depositor: escrow.depositor.clone(),
            beneficiary: escrow.beneficiary.clone(),
            amount: fee,
            kind: soroban_sdk::symbol_short!("arbiter"),
        }
        .publish(env);
        return Ok(true);
    }

    escrow.status = EscrowStatus::Released;
    fees_credit(env, escrow.token.as_ref(), fee)?;

    let beneficiary = escrow
        .beneficiary
        .clone()
        .ok_or(SecureFlowError::NoBeneficiary)?;
    if escrow.total_amount >= MIN_REP_ELIGIBLE_ESCROW_VALUE {
        update_reputation(env, &beneficiary, REPUTATION_PER_ESCROW);
        update_reputation(env, &escrow.depositor, REPUTATION_PER_ESCROW);
        bump_counter(env, DataKey::CompletedEscrows(beneficiary.clone()), 1);
        bump_counter(env, DataKey::CompletedEscrows(escrow.depositor.clone()), 1);
    }

    events::EscrowCompleted {
        escrow_id,
        beneficiary,
        depositor: escrow.depositor.clone(),
        total_paid: escrow.paid_amount,
        fee_earned: fee,
    }
    .publish(env);
    Ok(true)
}

/// Is the escrow in a state no further action can change?
pub fn is_terminal(status: &EscrowStatus) -> bool {
    matches!(
        status,
        EscrowStatus::Released
            | EscrowStatus::Refunded
            | EscrowStatus::Expired
            | EscrowStatus::Cancelled
    )
}
