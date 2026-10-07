//! Freelancer identity verification (Didit), and the one-person-one-wallet
//! rule that makes it a sybil defence rather than just a badge.
//!
//! The KYC itself happens off-chain at Didit. The backend receives Didit's
//! signed webhook, derives a salted hash of the person's identity, and the
//! VERIFIER (a dedicated key the owner appoints, never the owner key itself)
//! attests it here. The contract's job is the part a database could quietly
//! get wrong: an identity can be bound to exactly one wallet, publicly.

use crate::admin;
use crate::escrow_core as core;
use crate::events;
use crate::storage_types::{DataKey, FreelancerVerification, SecureFlowError, SfResult};
use soroban_sdk::{Address, BytesN, Env};

pub fn get_verifier(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Verifier)
}

fn require_verifier(env: &Env, verifier: &Address) -> SfResult<()> {
    verifier.require_auth();
    match get_verifier(env) {
        None => Err(SecureFlowError::NoVerifierSet),
        Some(v) if &v == verifier => Ok(()),
        Some(_) => Err(SecureFlowError::OnlyVerifier),
    }
}

/// Owner appoints (or replaces) the verifier key.
pub fn set_verifier(env: &Env, verifier: Address) -> SfResult<()> {
    admin::require_owner(env)?;
    if verifier == env.current_contract_address() {
        return Err(SecureFlowError::InvalidAddress);
    }
    env.storage().instance().set(&DataKey::Verifier, &verifier);
    events::VerifierSet { verifier }.publish(env);
    Ok(())
}

/// Verifier attests that `wallet` belongs to the person behind
/// `identity_hash`.
///
/// Re-attesting the same person on the same wallet refreshes the record. The
/// same person on a DIFFERENT wallet is refused: that is the sybil case.
pub fn attest_verification(
    env: &Env,
    verifier: Address,
    wallet: Address,
    identity_hash: BytesN<32>,
) -> SfResult<()> {
    require_verifier(env, &verifier)?;

    let binding_key = DataKey::IdentityBinding(identity_hash.clone());
    if let Some(bound) = core::p_get::<Address>(env, &binding_key) {
        if bound != wallet {
            return Err(SecureFlowError::DuplicateIdentity);
        }
    }
    let record_key = DataKey::Verification(wallet.clone());
    if let Some(existing) = core::p_get::<FreelancerVerification>(env, &record_key) {
        if existing.identity_hash != identity_hash {
            return Err(SecureFlowError::WalletBoundToOtherIdentity);
        }
    }

    core::p_set(env, &binding_key, &wallet);
    core::p_set(
        env,
        &record_key,
        &FreelancerVerification {
            identity_hash,
            verified_at: env.ledger().timestamp(),
            verifier,
        },
    );
    admin::bump_instance(env);
    events::FreelancerVerified { wallet }.publish(env);
    Ok(())
}

/// Verifier (or owner) withdraws a verification, e.g. after fraud or a user's
/// request to move their identity to a new wallet. Frees the identity binding
/// so that person can verify again.
pub fn revoke_verification(env: &Env, caller: Address, wallet: Address) -> SfResult<()> {
    let is_owner = admin::get_owner(env)? == caller;
    if is_owner {
        caller.require_auth();
    } else {
        require_verifier(env, &caller)?;
    }
    let record_key = DataKey::Verification(wallet.clone());
    let record: FreelancerVerification =
        core::p_get(env, &record_key).ok_or(SecureFlowError::NotVerified)?;
    core::p_remove(env, &record_key);
    core::p_remove(env, &DataKey::IdentityBinding(record.identity_hash));
    events::VerificationRevoked {
        wallet,
        revoked_by: caller,
    }
    .publish(env);
    Ok(())
}

pub fn get_verification(env: &Env, wallet: Address) -> Option<FreelancerVerification> {
    core::p_get(env, &DataKey::Verification(wallet))
}

pub fn is_verified(env: &Env, wallet: Address) -> bool {
    core::p_has(env, &DataKey::Verification(wallet))
}
