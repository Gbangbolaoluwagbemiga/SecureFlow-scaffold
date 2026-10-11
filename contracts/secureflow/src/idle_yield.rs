//! Productive escrow: money waiting for a milestone can earn in a Blend
//! lending pool instead of sitting idle.
//!
//! THE RULES
//!
//! - Opt-in, per escrow, by the client. Nothing moves otherwise.
//! - Only unpaid principal is supplied. The platform fee stays in cash.
//! - Before ANY money leaves an escrow (payout, refund, cancel, withdrawal,
//!   dispute ruling) its whole position comes back to cash first, so every
//!   payout runs on cash exactly as it did before yield existed. If the pool
//!   cannot pay out at that moment, the action fails and can be retried: a
//!   pool can delay a payout, never lose it.
//! - The escrow's share is the pool's own b-tokens, measured from the pool's
//!   positions before and after each call, so interest accrues to it with no
//!   rate maths of ours.
//! - The pool rounds every deposit and withdrawal down by a stroop or two.
//!   The client's principal always comes back whole, paid in real cash: the
//!   dust is covered by yield the escrow already earned, then its held
//!   platform fee, then the platform's earned fees. Opting in requires one of
//!   those fees to hold `YIELD_DUST_RESERVE`, and fee withdrawals leave that
//!   much behind while a pool is configured, so the cover is always there.
//!   Never from another escrow's money.
//! - Interest is held for the escrow and counted as owed, so the owner's
//!   surplus sweep can never take it. When the escrow is finished, `claim`
//!   distributes it: a job completed without dispute tips its freelancer
//!   (60% by default) and the platform keeps the rest; any other ending
//!   (dispute, cancellation, refund, expiry) sends all of it to the platform.
//!   The client's principal is never touched by any of this.
//!
//! Re-investing after a payout is not automatic: `invest_idle` is public, and
//! a keeper (the Autopilot service) calls it for opted-in escrows. Anyone
//! calling it can only move an escrow's own idle money into its configured
//! pool.

use soroban_sdk::{token, Address, Env};

use crate::admin;
use crate::blend::{self, SCALAR_12};
use crate::escrow_core::{self as core, add, mul_div, sub};
use crate::events;
use crate::storage_types::{
    DataKey, EscrowData, EscrowStatus, SecureFlowError, SfResult, YieldInfo, YieldPosition,
    DEFAULT_YIELD_FREELANCER_SHARE_BP, YIELD_DUST_RESERVE,
};

const BP_DENOMINATOR: i128 = 10_000;

// ─── Configuration (owner) ───────────────────────────────────────────────────

/// Point a token at a Blend pool, or `None` to stop new deposits. Escrows
/// already supplied keep the pool they used, so they can always come back.
pub fn set_pool(env: &Env, token: Option<Address>, pool: Option<Address>) -> SfResult<()> {
    admin::require_owner(env)?;
    let key = DataKey::YieldPool(core::token_address(env, token.as_ref()));
    match pool {
        Some(p) => env.storage().instance().set(&key, &p),
        None => env.storage().instance().remove(&key),
    }
    Ok(())
}

pub fn get_pool(env: &Env, token: Option<Address>) -> Option<Address> {
    pool_for(env, &core::token_address(env, token.as_ref()))
}

fn pool_for(env: &Env, token: &Address) -> Option<Address> {
    env.storage()
        .instance()
        .get(&DataKey::YieldPool(token.clone()))
}

pub fn set_freelancer_share(env: &Env, bp: u32) -> SfResult<()> {
    admin::require_owner(env)?;
    if i128::from(bp) > BP_DENOMINATOR {
        return Err(SecureFlowError::YieldShareTooHigh);
    }
    env.storage()
        .instance()
        .set(&DataKey::YieldFreelancerShareBp, &bp);
    Ok(())
}

pub fn freelancer_share(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::YieldFreelancerShareBp)
        .unwrap_or(DEFAULT_YIELD_FREELANCER_SHARE_BP)
}

// ─── State ───────────────────────────────────────────────────────────────────

pub fn is_opted_in(env: &Env, escrow_id: u32) -> bool {
    core::p_get(env, &DataKey::YieldOptIn(escrow_id)).unwrap_or(false)
}

fn position(env: &Env, escrow_id: u32) -> Option<YieldPosition> {
    core::p_get(env, &DataKey::YieldPosition(escrow_id))
}

fn earned(env: &Env, escrow_id: u32) -> i128 {
    core::p_get(env, &DataKey::YieldEarned(escrow_id)).unwrap_or(0)
}

fn set_earned(env: &Env, escrow_id: u32, amount: i128) {
    if amount == 0 {
        core::p_remove(env, &DataKey::YieldEarned(escrow_id));
    } else {
        core::p_set(env, &DataKey::YieldEarned(escrow_id), &amount);
    }
}

/// A yield pool is configured for this token: fee withdrawals keep the
/// rounding reserve behind.
pub fn pool_configured(env: &Env, token: &Address) -> bool {
    pool_for(env, token).is_some()
}

/// Nothing supplied and nothing held: safe to delete the escrow.
pub fn is_empty(env: &Env, escrow_id: u32) -> bool {
    position(env, escrow_id).is_none() && earned(env, escrow_id) == 0
}

fn is_active(status: &EscrowStatus) -> bool {
    matches!(status, EscrowStatus::Pending | EscrowStatus::InProgress)
}

fn balance(env: &Env, token: &Address) -> i128 {
    token::TokenClient::new(env, token).balance(&env.current_contract_address())
}

// ─── Client actions ──────────────────────────────────────────────────────────

pub fn set_opt_in(env: &Env, escrow_id: u32, on: bool, depositor: Address) -> SfResult<()> {
    depositor.require_auth();
    admin::require_not_paused(env)?;
    let mut escrow = core::load_escrow(env, escrow_id)?;
    core::require_depositor(&escrow, &depositor)?;

    if on {
        if !is_active(&escrow.status) {
            return Err(SecureFlowError::YieldEscrowNotActive);
        }
        let token = core::token_address(env, escrow.token.as_ref());
        if pool_for(env, &token).is_none() {
            return Err(SecureFlowError::YieldNotConfigured);
        }
        // Rounding dust is paid in real cash, from the escrow's fee or the
        // platform's earned fees; one of them must be able to cover it.
        let platform_fees = admin::get_withdrawable_fees(env, escrow.token.clone()).max(0);
        if escrow.platform_fee < YIELD_DUST_RESERVE && platform_fees < YIELD_DUST_RESERVE {
            return Err(SecureFlowError::YieldFeeReserveTooSmall);
        }
        core::p_set(env, &DataKey::YieldOptIn(escrow_id), &true);
        invest(env, escrow_id, &escrow)?;
    } else {
        release(env, escrow_id, &mut escrow)?;
        core::p_remove(env, &DataKey::YieldOptIn(escrow_id));
    }

    events::YieldOptInChanged {
        escrow_id,
        opted_in: on,
    }
    .publish(env);
    Ok(())
}

/// Put an opted-in escrow's idle money to work. Public on purpose: it can
/// only move this escrow's own unpaid principal into its configured pool.
pub fn invest_idle(env: &Env, escrow_id: u32) -> SfResult<i128> {
    admin::require_not_paused(env)?;
    if !is_opted_in(env, escrow_id) {
        return Err(SecureFlowError::YieldNotOptedIn);
    }
    let escrow = core::load_escrow(env, escrow_id)?;
    if !is_active(&escrow.status) {
        return Err(SecureFlowError::YieldEscrowNotActive);
    }
    invest(env, escrow_id, &escrow)
}

/// Distribute an escrow's yield once it is finished. Anyone may trigger it.
///
/// A job completed without dispute tips its freelancer (60% by default) and
/// the platform keeps the rest. A job that was disputed, cancelled, refunded
/// or expired earned no tip: all of its yield goes to the platform. The
/// client's principal is never part of this; it was returned or paid out
/// before the escrow could finish.
///
/// Returns (to freelancer, to platform).
pub fn claim(env: &Env, escrow_id: u32) -> SfResult<(i128, i128)> {
    let mut escrow = core::load_escrow(env, escrow_id)?;
    if !core::is_terminal(&escrow.status) {
        return Err(SecureFlowError::YieldEscrowNotFinal);
    }
    release(env, escrow_id, &mut escrow)?;

    let total = earned(env, escrow_id);
    if total <= 0 {
        return Err(SecureFlowError::YieldNothingToClaim);
    }
    let disputed = core::p_get(env, &DataKey::EverDisputed(escrow_id)).unwrap_or(false);
    let tipped = match (&escrow.status, &escrow.beneficiary) {
        (EscrowStatus::Released, Some(freelancer)) if !disputed => Some(freelancer.clone()),
        _ => None,
    };
    let to_freelancer = match tipped {
        Some(_) => mul_div(total, i128::from(freelancer_share(env)), BP_DENOMINATOR)?,
        None => 0,
    };
    let to_platform = sub(total, to_freelancer)?;

    set_earned(env, escrow_id, 0);
    core::liabilities_sub(env, escrow.token.as_ref(), total)?;
    if let Some(freelancer) = &tipped {
        core::pay_out(env, escrow.token.as_ref(), freelancer, to_freelancer)?;
    }
    // The platform's share joins its earned fees: withdrawable by the fee
    // collector, and part of the cover for the pool's rounding.
    core::fees_credit(env, escrow.token.as_ref(), to_platform)?;

    events::YieldClaimed {
        escrow_id,
        to_freelancer,
        to_platform,
    }
    .publish(env);
    Ok((to_freelancer, to_platform))
}

// ─── Moving money ────────────────────────────────────────────────────────────

/// Supply whatever unpaid principal isn't earning yet.
fn invest(env: &Env, escrow_id: u32, escrow: &EscrowData) -> SfResult<i128> {
    let token = core::token_address(env, escrow.token.as_ref());
    let pool = pool_for(env, &token).ok_or(SecureFlowError::YieldNotConfigured)?;

    let mut pos = position(env, escrow_id).unwrap_or(YieldPosition {
        pool: pool.clone(),
        token: token.clone(),
        b_tokens: 0,
        principal: 0,
    });
    // The pool was changed under a live position: bring it home first, then
    // start again in the new one.
    if pos.pool != pool && (pos.b_tokens > 0 || pos.principal > 0) {
        let mut copy = escrow.clone();
        release(env, escrow_id, &mut copy)?;
        pos = YieldPosition {
            pool: pool.clone(),
            token: token.clone(),
            b_tokens: 0,
            principal: 0,
        };
    }

    let unpaid = sub(escrow.total_amount, escrow.paid_amount)?;
    let amount = sub(unpaid, pos.principal)?;
    if amount <= 0 {
        return Ok(0);
    }

    let index = blend::get_reserve(env, &pool, &token)?.config.index;
    let before = blend::supplied_b_tokens(env, &pool, index)?;
    blend::supply(env, &pool, &token, amount)?;
    let after = blend::supplied_b_tokens(env, &pool, index)?;

    pos.b_tokens = add(pos.b_tokens, sub(after, before)?)?;
    pos.principal = add(pos.principal, amount)?;
    core::p_set(env, &DataKey::YieldPosition(escrow_id), &pos);

    events::YieldDeployed { escrow_id, amount }.publish(env);
    Ok(amount)
}

/// Bring an escrow's whole position back to cash and account for the
/// difference. Called at the top of every action that moves the escrow's
/// money out, and a no-op for escrows that never opted in.
pub fn release(env: &Env, escrow_id: u32, escrow: &mut EscrowData) -> SfResult<()> {
    let Some(mut pos) = position(env, escrow_id) else {
        return Ok(());
    };
    if pos.b_tokens <= 0 && pos.principal <= 0 {
        core::p_remove(env, &DataKey::YieldPosition(escrow_id));
        return Ok(());
    }

    let reserve = blend::get_reserve(env, &pos.pool, &pos.token)?;
    let index = reserve.config.index;
    // Everything the position is worth, rounded down so the pool never burns
    // more b-tokens than the escrow holds.
    let amount = mul_div(pos.b_tokens, reserve.data.b_rate, SCALAR_12)?;

    let cash_before = balance(env, &pos.token);
    let b_before = blend::supplied_b_tokens(env, &pos.pool, index)?;
    if amount > 0 {
        blend::withdraw(env, &pos.pool, &pos.token, amount)?;
    }
    let received = sub(balance(env, &pos.token), cash_before)?;
    let burned = sub(b_before, blend::supplied_b_tokens(env, &pos.pool, index)?)?;
    pos.b_tokens = sub(pos.b_tokens, burned)?.max(0);

    let principal = pos.principal;
    if received >= principal {
        let profit = sub(received, principal)?;
        if profit > 0 {
            set_earned(env, escrow_id, add(earned(env, escrow_id), profit)?);
            core::liabilities_add(env, escrow.token.as_ref(), profit)?;
        }
    } else {
        absorb_shortfall(env, escrow_id, escrow, sub(principal, received)?)?;
    }

    pos.principal = 0;
    if pos.b_tokens > 0 {
        // Sub-stroop dust the pool's rounding left behind; it rides along
        // with the next deposit.
        core::p_set(env, &DataKey::YieldPosition(escrow_id), &pos);
    } else {
        core::p_remove(env, &DataKey::YieldPosition(escrow_id));
    }

    events::YieldReleased {
        escrow_id,
        principal,
        received,
    }
    .publish(env);
    Ok(())
}

/// Rounding came back a few stroops short. Cover it from yield already earned,
/// then the escrow's held fee, then the platform's earned fees, so the
/// principal owed stays whole whatever the fee rate.
fn absorb_shortfall(
    env: &Env,
    escrow_id: u32,
    escrow: &mut EscrowData,
    shortfall: i128,
) -> SfResult<()> {
    let from_earned = shortfall.min(earned(env, escrow_id));
    if from_earned > 0 {
        set_earned(env, escrow_id, sub(earned(env, escrow_id), from_earned)?);
        core::liabilities_sub(env, escrow.token.as_ref(), from_earned)?;
    }
    let rest = sub(shortfall, from_earned)?;
    let from_fee = rest.min(escrow.platform_fee);
    if from_fee > 0 {
        escrow.platform_fee = sub(escrow.platform_fee, from_fee)?;
        core::liabilities_sub(env, escrow.token.as_ref(), from_fee)?;
        core::save_escrow(env, escrow_id, escrow);
    }
    // Whatever is left comes from the platform's earned fees, which are real
    // cash in this contract (opting in checked they could cover it, and
    // withdrawals leave a reserve). Should they ever fall short, the counter
    // goes negative and `withdraw_fees` pays nothing until it recovers.
    let from_platform = sub(rest, from_fee)?;
    if from_platform > 0 {
        core::fees_credit(env, escrow.token.as_ref(), sub(0, from_platform)?)?;
    }
    Ok(())
}

// ─── Reads ───────────────────────────────────────────────────────────────────

pub fn info(env: &Env, escrow_id: u32) -> SfResult<YieldInfo> {
    let escrow = core::load_escrow(env, escrow_id)?;
    let token = core::token_address(env, escrow.token.as_ref());
    let pos = position(env, escrow_id);
    let (principal, value) = match &pos {
        Some(p) => {
            let value = blend::get_reserve(env, &p.pool, &p.token)
                .and_then(|r| mul_div(p.b_tokens, r.data.b_rate, SCALAR_12))
                .unwrap_or(p.principal);
            (p.principal, value)
        }
        None => (0, 0),
    };
    Ok(YieldInfo {
        opted_in: is_opted_in(env, escrow_id),
        available: pool_for(env, &token).is_some(),
        principal,
        value,
        earned: earned(env, escrow_id),
        freelancer_share_bp: freelancer_share(env),
    })
}
