use crate::storage_types::{
    DataKey, EscrowData, EvidenceEntry, SecureFlowError,
    INSTANCE_BUMP_AMOUNT, INSTANCE_LIFETIME_THRESHOLD,
};
use soroban_sdk::{Address, Env, Error, String, Vec};

fn get_escrow_data(env: &Env, escrow_id: u32) -> Result<EscrowData, Error> {
    env.storage()
        .instance()
        .get::<DataKey, EscrowData>(&DataKey::Escrow(escrow_id))
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))
}

/// Submit a piece of evidence for a disputed milestone.
///
/// Only the depositor (client), beneficiary (freelancer), or an authorized
/// arbiter may submit evidence for a given escrow.
///
/// `cid` is the IPFS CID (or any string identifier) pointing to the evidence
/// document. Use `"|"` as a separator if you want to append a short description,
/// e.g. `"QmXyz|My invoice for phase 1"`.
pub fn submit_evidence(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    submitter: Address,
    cid: String,
) -> Result<(), Error> {
    submitter.require_auth();

    if cid.is_empty() {
        return Err(Error::from_contract_error(SecureFlowError::EvidenceCidEmpty as u32));
    }

    let escrow = get_escrow_data(env, escrow_id)?;

    // Only parties or arbiters may submit evidence
    let is_depositor = escrow.depositor == submitter;
    let is_beneficiary = escrow.beneficiary.as_ref().map_or(false, |b| b == &submitter);
    let is_arbiter = escrow
        .arbiters
        .iter()
        .any(|a| a == submitter);

    if !is_depositor && !is_beneficiary && !is_arbiter {
        return Err(Error::from_contract_error(SecureFlowError::NotPartyToEscrow as u32));
    }

    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);

    let key = DataKey::Evidence(escrow_id, milestone_index);
    let mut entries: Vec<EvidenceEntry> = env
        .storage()
        .instance()
        .get(&key)
        .unwrap_or(Vec::new(env));

    entries.push_back(EvidenceEntry {
        submitter: submitter.clone(),
        cid: cid.clone(),
        submitted_at: env.ledger().timestamp(),
    });

    env.storage().instance().set(&key, &entries);

    Ok(())
}

/// Return all evidence entries for a given escrow / milestone pair.
pub fn get_evidence(env: &Env, escrow_id: u32, milestone_index: u32) -> Vec<EvidenceEntry> {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .get(&DataKey::Evidence(escrow_id, milestone_index))
        .unwrap_or(Vec::new(env))
}
