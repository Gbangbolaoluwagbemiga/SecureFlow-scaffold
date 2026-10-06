//! Two-way ratings once a job is fully released.

use crate::escrow_core as core;
use crate::events;
use crate::storage_types::{
    Badge, ClientRatingData, DataKey, EscrowStatus, Rating, SecureFlowError, SfResult,
};
use soroban_sdk::{Address, Env, String};

fn validate(rating: u32) -> SfResult<()> {
    if !(1..=5).contains(&rating) {
        return Err(SecureFlowError::InvalidRating);
    }
    Ok(())
}

fn add_to_average(env: &Env, key: DataKey, rating: u32) {
    let (total, count): (u32, u32) = core::p_get(env, &key).unwrap_or((0, 0));
    core::p_set(
        env,
        &key,
        &(total.saturating_add(rating), count.saturating_add(1)),
    );
}

/// The client rates the freelancer.
pub fn submit_rating(
    env: &Env,
    escrow_id: u32,
    rating: u32,
    review: String,
    client: Address,
) -> SfResult<()> {
    client.require_auth();
    validate(rating)?;
    let escrow = core::load_escrow(env, escrow_id)?;
    if escrow.depositor != client {
        return Err(SecureFlowError::OnlyDepositorCanRate);
    }
    if escrow.status != EscrowStatus::Released {
        return Err(SecureFlowError::EscrowNotCompleted);
    }
    let key = DataKey::Rating(escrow_id);
    if core::p_has(env, &key) {
        return Err(SecureFlowError::RatingAlreadySubmitted);
    }
    let freelancer = escrow.beneficiary.ok_or(SecureFlowError::NoBeneficiary)?;
    core::p_set(
        env,
        &key,
        &Rating {
            escrow_id,
            freelancer: freelancer.clone(),
            client: client.clone(),
            rating,
            review,
            rated_at: env.ledger().sequence(),
        },
    );
    add_to_average(env, DataKey::AverageRating(freelancer.clone()), rating);
    events::RatingSubmitted {
        escrow_id,
        rated: freelancer,
        rater: client,
        score: rating,
    }
    .publish(env);
    Ok(())
}

/// The freelancer rates the client.
pub fn submit_client_rating(
    env: &Env,
    escrow_id: u32,
    rating: u32,
    review: String,
    freelancer: Address,
) -> SfResult<()> {
    freelancer.require_auth();
    validate(rating)?;
    let escrow = core::load_escrow(env, escrow_id)?;
    if escrow.beneficiary.as_ref() != Some(&freelancer) {
        return Err(SecureFlowError::OnlyBeneficiaryCanRate);
    }
    if escrow.status != EscrowStatus::Released {
        return Err(SecureFlowError::EscrowNotCompleted);
    }
    let key = DataKey::ClientRating(escrow_id);
    if core::p_has(env, &key) {
        return Err(SecureFlowError::ClientRatingAlreadySubmitted);
    }
    core::p_set(
        env,
        &key,
        &ClientRatingData {
            escrow_id,
            client: escrow.depositor.clone(),
            freelancer: freelancer.clone(),
            rating,
            review,
            rated_at: env.ledger().sequence(),
        },
    );
    add_to_average(
        env,
        DataKey::AverageClientRating(escrow.depositor.clone()),
        rating,
    );
    events::RatingSubmitted {
        escrow_id,
        rated: escrow.depositor,
        rater: freelancer,
        score: rating,
    }
    .publish(env);
    Ok(())
}

pub fn get_rating(env: &Env, escrow_id: u32) -> Option<Rating> {
    core::p_get(env, &DataKey::Rating(escrow_id))
}

pub fn get_average_rating(env: &Env, freelancer: Address) -> (u32, u32) {
    core::p_get(env, &DataKey::AverageRating(freelancer)).unwrap_or((0, 0))
}

pub fn get_client_rating(env: &Env, escrow_id: u32) -> Option<ClientRatingData> {
    core::p_get(env, &DataKey::ClientRating(escrow_id))
}

pub fn get_average_client_rating(env: &Env, client: Address) -> (u32, u32) {
    core::p_get(env, &DataKey::AverageClientRating(client)).unwrap_or((0, 0))
}

pub fn get_completed_escrows(env: &Env, user: Address) -> u32 {
    core::p_get(env, &DataKey::CompletedEscrows(user)).unwrap_or(0)
}

pub fn get_badge(env: &Env, freelancer: Address) -> Badge {
    match get_completed_escrows(env, freelancer) {
        0..=4 => Badge::Beginner,
        5..=14 => Badge::Intermediate,
        15..=49 => Badge::Advanced,
        _ => Badge::Expert,
    }
}
