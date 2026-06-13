use crate::admin;
use crate::storage_types::{
    DataKey, EscrowData, SecureFlowError, INSTANCE_BUMP_AMOUNT, INSTANCE_LIFETIME_THRESHOLD,
};
use soroban_sdk::{token, Address, Env, String, Vec, Error};

// Helper functions for escrow operations
#[allow(dead_code)]
pub fn get_next_escrow_id(env: &Env) -> u32 {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    let current_id: u32 = env
        .storage()
        .instance()
        .get(&DataKey::NextEscrowId)
        .unwrap_or(1);
    current_id
}

pub fn increment_next_escrow_id(env: &Env) -> u32 {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    let current_id: u32 = env
        .storage()
        .instance()
        .get(&DataKey::NextEscrowId)
        .unwrap_or(1);
    let next_id = current_id + 1;
    env.storage()
        .instance()
        .set(&DataKey::NextEscrowId, &next_id);
    current_id
    }

pub fn save_escrow(env: &Env, escrow_id: u32, escrow_data: &EscrowData) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::Escrow(escrow_id), escrow_data);
    }

pub fn get_reputation(env: &Env, user: Address) -> u32 {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .get(&DataKey::Reputation(user))
        .unwrap_or(0)
    }

pub fn get_escrow(env: &Env, escrow_id: u32) -> Option<EscrowData> {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage().instance().get(&DataKey::Escrow(escrow_id))
    }

pub fn require_valid_escrow(env: &Env, escrow_id: u32) -> Result<(), Error> {
    if escrow_id == 0 || get_escrow(env, escrow_id).is_none() {
    return Err(Error::from_contract_error(SecureFlowError::EscrowNotFound as u32));
    }
    Ok(())
}

pub fn add_user_escrow(env: &Env, user: Address, escrow_id: u32) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    
    let mut escrows: Vec<u32> = env
        .storage()
        .instance()
        .get(&DataKey::UserEscrows(user.clone()))
        .unwrap_or(Vec::new(&env));
    
    escrows.push_back(escrow_id);
    env.storage()
        .instance()
        .set(&DataKey::UserEscrows(user), &escrows);
    }

pub fn get_user_escrows(env: &Env, user: Address) -> Vec<u32> {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .get(&DataKey::UserEscrows(user))
        .unwrap_or(Vec::new(&env))
    }

pub fn calculate_fee(env: &Env, amount: i128) -> i128 {
    let fee_bp = admin::get_platform_fee_bp(env);
    if fee_bp == 0 {
        return 0;
    }
    (amount * fee_bp as i128) / 10000
    }

#[allow(dead_code)]
pub fn is_authorized_arbiter(env: &Env, arbiter: Address) -> bool {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .get(&DataKey::AuthorizedArbiter(arbiter))
        .unwrap_or(false)
    }

/// Transfer tokens from this contract to `to`. No-op if amount <= 0.
pub fn do_transfer(env: &Env, token_opt: &Option<Address>, to: &Address, amount: i128) {
    if amount <= 0 {
        return;
    }
    if let Some(token_addr) = token_opt {
        token::Client::new(env, token_addr).transfer(&env.current_contract_address(), to, &amount);
    } else {
        let native = Address::from_string(&String::from_str(
            env,
            "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        ));
        token::Client::new(env, &native).transfer(&env.current_contract_address(), to, &amount);
    }
}

/// Transfer tokens from `from` into this contract. No-op if amount <= 0.
pub fn transfer_in(env: &Env, token_opt: &Option<Address>, from: &Address, amount: i128) {
    if amount <= 0 {
        return;
    }
    if let Some(token_addr) = token_opt {
        token::Client::new(env, token_addr).transfer(from, &env.current_contract_address(), &amount);
    } else {
        let native = Address::from_string(&String::from_str(
            env,
            "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        ));
        token::Client::new(env, &native).transfer(from, &env.current_contract_address(), &amount);
    }
}

/// Remove a single escrow ID from a user's escrow list.
pub fn remove_user_escrow(env: &Env, user: Address, escrow_id: u32) {
    let list: Vec<u32> = env
        .storage()
        .instance()
        .get(&DataKey::UserEscrows(user.clone()))
        .unwrap_or(Vec::new(env));
    let mut new_list: Vec<u32> = Vec::new(env);
    for id in list.iter() {
        if id != escrow_id {
            new_list.push_back(id);
        }
    }
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::UserEscrows(user), &new_list);
}

pub fn is_whitelisted_token(env: &Env, token: Option<Address>) -> bool {
    if token.is_none() {
        return true; // Native XLM is always whitelisted
    }
    let addr = token.unwrap();
    // Reject if blacklisted even if previously whitelisted
    if admin::is_blacklisted_token(env, &addr) {
        return false;
    }
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .get(&DataKey::WhitelistedToken(addr))
        .unwrap_or(false)
}

