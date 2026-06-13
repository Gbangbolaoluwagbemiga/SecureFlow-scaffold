use crate::admin;
use crate::escrow_core;
use crate::storage_types::{Application, DataKey, EscrowStatus, SecureFlowError, INSTANCE_BUMP_AMOUNT, INSTANCE_LIFETIME_THRESHOLD};
use soroban_sdk::{Env, Address, String, Vec, Error};

const MAX_APPLICATIONS: u32 = 50;

pub fn apply_to_job(
    env: &Env,
    escrow_id: u32,
    freelancer: Address,
    cover_letter: String,
    proposed_timeline: u32,
) -> Result<(), Error> {
    // Require auth from the freelancer address
    // The freelancer must sign the transaction
    freelancer.require_auth();

    admin::require_not_paused(env)?;

    // Check if job creation is paused
    if admin::is_job_creation_paused(env) {
        return Err(Error::from_contract_error(SecureFlowError::JobCreationPaused as u32));
    }

    // Validate escrow
    escrow_core::require_valid_escrow(env, escrow_id)?;
    let escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    // Validate escrow is an open job
    if !escrow.is_open_job {
        return Err(Error::from_contract_error(SecureFlowError::NotOpenJob as u32));
    }

    if escrow.status != EscrowStatus::Pending {
        return Err(Error::from_contract_error(SecureFlowError::JobClosed as u32));
    }

    if escrow.depositor == freelancer {
        return Err(Error::from_contract_error(SecureFlowError::CannotApplyToOwnJob as u32));
    }

    // Check if already applied
    if has_applied(env, escrow_id, freelancer.clone()) {
        return Err(Error::from_contract_error(SecureFlowError::AlreadyApplied as u32));
    }

    // Find the first available slot and count existing applications
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    
    let mut application_count = 0u32;
    let mut next_available_index: Option<u32> = None;
    
    // Check all possible application indices to find first empty slot
    for app_index in 0..MAX_APPLICATIONS {
        let key = DataKey::Application(escrow_id, app_index);
        if let Some(_existing_app) = env.storage().instance().get::<DataKey, Application>(&key) {
            application_count += 1;
        } else if next_available_index.is_none() {
            next_available_index = Some(app_index);
        }
    }
    
    // Check if we've reached max applications
    if application_count >= MAX_APPLICATIONS {
        return Err(Error::from_contract_error(SecureFlowError::TooManyApplications as u32));
    }
    
    // Get the next available index (should always be Some at this point)
    let application_index = next_available_index
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::TooManyApplications as u32))?;

    // Create application
    let application = Application {
        freelancer: freelancer.clone(),
        cover_letter,
        proposed_timeline,
        applied_at: env.ledger().sequence(),
    };

    // Save application at the next available index
    env.storage()
        .instance()
        .set(&DataKey::Application(escrow_id, application_index), &application);
    
    Ok(())
}

pub fn accept_freelancer(env: &Env, escrow_id: u32, depositor: Address, freelancer: Address) -> Result<(), Error> {
    depositor.require_auth();
    admin::require_not_paused(env)?;

    escrow_core::require_valid_escrow(env, escrow_id)?;
    let mut escrow = escrow_core::get_escrow(env, escrow_id)
        .ok_or_else(|| Error::from_contract_error(SecureFlowError::EscrowNotFound as u32))?;

    if escrow.depositor != depositor {
        return Err(Error::from_contract_error(SecureFlowError::OnlyDepositor as u32));
    }

    if !escrow.is_open_job {
        return Err(Error::from_contract_error(SecureFlowError::NotOpenJob as u32));
    }

    if escrow.status != EscrowStatus::Pending {
        return Err(Error::from_contract_error(SecureFlowError::JobClosed as u32));
    }

    // TODO: Check if freelancer applied

    // Accept freelancer
    escrow.beneficiary = Some(freelancer.clone());
    escrow.is_open_job = false;

    // Save updated escrow
    escrow_core::save_escrow(env, escrow_id, &escrow);

    // Add to user escrows
    escrow_core::add_user_escrow(env, freelancer, escrow_id);
    
    Ok(())
}

/// Check if a freelancer has applied to a job
pub fn has_applied(env: &Env, escrow_id: u32, freelancer: Address) -> bool {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    
    // Check all possible application indices (0 to MAX_APPLICATIONS - 1)
    for app_index in 0..MAX_APPLICATIONS {
        let key = DataKey::Application(escrow_id, app_index);
        if let Some(application) = env.storage().instance().get::<DataKey, Application>(&key) {
            if application.freelancer == freelancer {
                return true;
            }
        }
    }
    
    false
}

/// Get an application by escrow_id and freelancer
pub fn get_application(env: &Env, escrow_id: u32, freelancer: Address) -> Option<Application> {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    
    // Check all possible application indices
    for app_index in 0..MAX_APPLICATIONS {
        let key = DataKey::Application(escrow_id, app_index);
        if let Some(application) = env.storage().instance().get::<DataKey, Application>(&key) {
            if application.freelancer == freelancer {
                return Some(application);
            }
        }
    }
    
    None
}

/// Get all applications for an escrow
pub fn get_applications(env: &Env, escrow_id: u32) -> Vec<Application> {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);

    let mut applications = Vec::new(env);

    // Check all possible application indices
    for app_index in 0..MAX_APPLICATIONS {
        let key = DataKey::Application(escrow_id, app_index);
        if let Some(application) = env.storage().instance().get::<DataKey, Application>(&key) {
            applications.push_back(application);
        }
    }

    applications
}

/// Get a page of applications for an escrow.
/// `offset` is the zero-based starting position; `limit` is the max entries to return.
pub fn get_applications_page(env: &Env, escrow_id: u32, offset: u32, limit: u32) -> Vec<Application> {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);

    let mut result = Vec::new(env);
    let mut seen: u32 = 0;
    let mut returned: u32 = 0;

    for app_index in 0..MAX_APPLICATIONS {
        if returned >= limit {
            break;
        }
        let key = DataKey::Application(escrow_id, app_index);
        if let Some(application) = env.storage().instance().get::<DataKey, Application>(&key) {
            if seen >= offset {
                result.push_back(application);
                returned += 1;
            }
            seen += 1;
        }
    }

    result
}

/// Return the total number of applications for an escrow.
pub fn get_application_count(env: &Env, escrow_id: u32) -> u32 {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);

    let mut count: u32 = 0;
    for app_index in 0..MAX_APPLICATIONS {
        let key = DataKey::Application(escrow_id, app_index);
        if env.storage().instance().has(&key) {
            count += 1;
        }
    }
    count
}

