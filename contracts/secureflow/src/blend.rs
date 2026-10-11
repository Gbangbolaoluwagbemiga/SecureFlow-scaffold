//! The slice of a Blend lending pool that `SecureFlow` uses to put idle escrow
//! money to work.
//!
//! The types mirror Blend v2's pool contract field for field (checked against
//! the deployed `lendingPoolV2` WASM, hash a41fc53d…). Contract types travel as
//! maps keyed by field name, so these decode exactly what the pool returns
//! without vendoring its WASM.
//!
//! Every call goes through `try_invoke_contract`: a pool that refuses (paused,
//! out of liquidity, upgraded) becomes a `YieldPoolCallFailed` error the caller
//! can handle, never a panic that takes an escrow action down with it.

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contracttype, vec, Address, Env, IntoVal, Map, Symbol, Val, Vec,
};

use crate::storage_types::{SecureFlowError, SfResult};

/// Blend's fixed-point scale for `b_rate`.
pub const SCALAR_12: i128 = 1_000_000_000_000;

pub const REQUEST_SUPPLY: u32 = 0;
pub const REQUEST_WITHDRAW: u32 = 1;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
// Field names are Blend's and must match exactly for the type to decode.
#[allow(clippy::struct_field_names)]
pub struct Request {
    pub address: Address,
    pub amount: i128,
    pub request_type: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Positions {
    pub collateral: Map<u32, i128>,
    pub liabilities: Map<u32, i128>,
    pub supply: Map<u32, i128>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveConfig {
    pub c_factor: u32,
    pub decimals: u32,
    pub enabled: bool,
    pub index: u32,
    pub l_factor: u32,
    pub max_util: u32,
    pub r_base: u32,
    pub r_one: u32,
    pub r_three: u32,
    pub r_two: u32,
    pub reactivity: u32,
    pub supply_cap: i128,
    pub util: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveData {
    pub b_rate: i128,
    pub b_supply: i128,
    pub backstop_credit: i128,
    pub d_rate: i128,
    pub d_supply: i128,
    pub ir_mod: i128,
    pub last_time: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reserve {
    pub asset: Address,
    pub config: ReserveConfig,
    pub data: ReserveData,
    pub scalar: i128,
}

fn call<T>(env: &Env, pool: &Address, func: &str, args: Vec<Val>) -> SfResult<T>
where
    T: soroban_sdk::TryFromVal<Env, Val>,
{
    match env.try_invoke_contract::<T, soroban_sdk::Error>(pool, &Symbol::new(env, func), args) {
        Ok(Ok(value)) => Ok(value),
        _ => Err(SecureFlowError::YieldPoolCallFailed),
    }
}

pub fn get_reserve(env: &Env, pool: &Address, asset: &Address) -> SfResult<Reserve> {
    call(env, pool, "get_reserve", vec![env, asset.into_val(env)])
}

/// b-tokens this contract holds in the pool for `index`.
pub fn supplied_b_tokens(env: &Env, pool: &Address, index: u32) -> SfResult<i128> {
    let positions: Positions = call(
        env,
        pool,
        "get_positions",
        vec![env, env.current_contract_address().into_val(env)],
    )?;
    Ok(positions.supply.get(index).unwrap_or(0))
}

fn submit(env: &Env, pool: &Address, request: Request) -> SfResult<()> {
    let me = env.current_contract_address();
    let _: Positions = call(
        env,
        pool,
        "submit",
        vec![
            env,
            me.into_val(env),
            me.into_val(env),
            me.into_val(env),
            vec![env, request].into_val(env),
        ],
    )?;
    Ok(())
}

/// Supply `amount` of `asset` from this contract into the pool.
///
/// The pool pulls the tokens with `asset.transfer(this, pool, amount)`, a call
/// one level below the one this contract makes, so that transfer has to be
/// authorised explicitly. Exactly that transfer and nothing else.
pub fn supply(env: &Env, pool: &Address, asset: &Address, amount: i128) -> SfResult<()> {
    let me = env.current_contract_address();
    env.authorize_as_current_contract(vec![
        env,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: asset.clone(),
                fn_name: Symbol::new(env, "transfer"),
                args: (me, pool.clone(), amount).into_val(env),
            },
            sub_invocations: vec![env],
        }),
    ]);
    submit(
        env,
        pool,
        Request {
            address: asset.clone(),
            amount,
            request_type: REQUEST_SUPPLY,
        },
    )
}

/// Withdraw `amount` of `asset` from the pool back to this contract.
pub fn withdraw(env: &Env, pool: &Address, asset: &Address, amount: i128) -> SfResult<()> {
    submit(
        env,
        pool,
        Request {
            address: asset.clone(),
            amount,
            request_type: REQUEST_WITHDRAW,
        },
    )
}
