//! Evidence trail for disputes, stored on-chain.

use crate::escrow_core as core;
use crate::events;
use crate::storage_types::{
    DataKey, EvidenceEntry, SecureFlowError, SfResult, MAX_EVIDENCE_PER_MILESTONE,
};
use soroban_sdk::{Address, Env, String, Vec};

/// Attach evidence (an IPFS CID, optionally `CID|description`) to a
/// milestone. Parties to the escrow and arbiters who could rule on it may
/// submit.
pub fn submit_evidence(
    env: &Env,
    escrow_id: u32,
    milestone_index: u32,
    submitter: Address,
    cid: String,
) -> SfResult<()> {
    submitter.require_auth();
    if cid.is_empty() {
        return Err(SecureFlowError::EvidenceCidEmpty);
    }
    let escrow = core::load_escrow(env, escrow_id)?;
    if milestone_index >= escrow.milestone_count {
        return Err(SecureFlowError::InvalidMilestone);
    }
    let is_party = core::is_party(env, &escrow, escrow_id, &submitter);
    let is_arbiter = escrow.arbiters.contains(&submitter)
        || (core::is_authorized_arbiter(env, &submitter)
            && core::panel_allows(env, &escrow, &submitter));
    if !is_party && !is_arbiter {
        return Err(SecureFlowError::NotPartyToEscrow);
    }

    let key = DataKey::Evidence(escrow_id, milestone_index);
    let mut entries: Vec<EvidenceEntry> = core::p_get(env, &key).unwrap_or(Vec::new(env));
    if entries.len() >= MAX_EVIDENCE_PER_MILESTONE {
        return Err(SecureFlowError::TooManyEvidenceEntries);
    }
    entries.push_back(EvidenceEntry {
        submitter: submitter.clone(),
        cid: cid.clone(),
        submitted_at: env.ledger().timestamp(),
    });
    core::p_set(env, &key, &entries);

    events::EvidenceSubmitted {
        escrow_id,
        milestone_index,
        submitter,
        cid,
    }
    .publish(env);
    Ok(())
}

pub fn get_evidence(env: &Env, escrow_id: u32, milestone_index: u32) -> Vec<EvidenceEntry> {
    core::p_get(env, &DataKey::Evidence(escrow_id, milestone_index)).unwrap_or(Vec::new(env))
}
