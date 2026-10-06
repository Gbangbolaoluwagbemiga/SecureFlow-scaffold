//! Open jobs: applying and hiring.

use crate::admin;
use crate::escrow_core as core;
use crate::events;
use crate::storage_types::{
    Application, DataKey, EscrowStatus, SecureFlowError, SfResult, MAX_APPLICATIONS,
};
use soroban_sdk::{Address, Env, String, Vec};

fn applicants(env: &Env, escrow_id: u32) -> Vec<Address> {
    core::p_get(env, &DataKey::Applicants(escrow_id)).unwrap_or(Vec::new(env))
}

pub fn apply_to_job(
    env: &Env,
    escrow_id: u32,
    freelancer: Address,
    cover_letter: String,
    proposed_timeline: u32,
) -> SfResult<()> {
    freelancer.require_auth();
    admin::require_not_paused(env)?;
    if admin::is_job_creation_paused(env) {
        return Err(SecureFlowError::JobCreationPaused);
    }
    let escrow = core::load_escrow(env, escrow_id)?;
    if !escrow.is_open_job {
        return Err(SecureFlowError::NotOpenJob);
    }
    if escrow.status != EscrowStatus::Pending || escrow.beneficiary.is_some() {
        return Err(SecureFlowError::JobClosed);
    }
    if escrow.depositor == freelancer {
        return Err(SecureFlowError::CannotApplyToOwnJob);
    }
    if core::get_job_manager(env, escrow_id).as_ref() == Some(&freelancer) {
        return Err(SecureFlowError::ManagerCannotSelfHire);
    }
    if escrow.arbiters.contains(&freelancer) {
        return Err(SecureFlowError::ArbiterIsParty);
    }
    let key = DataKey::Application(escrow_id, freelancer.clone());
    if core::p_has(env, &key) {
        return Err(SecureFlowError::AlreadyApplied);
    }
    let mut list = applicants(env, escrow_id);
    if list.len() >= MAX_APPLICATIONS {
        return Err(SecureFlowError::TooManyApplications);
    }

    core::p_set(
        env,
        &key,
        &Application {
            freelancer: freelancer.clone(),
            cover_letter,
            proposed_timeline,
            applied_at: env.ledger().sequence(),
        },
    );
    list.push_back(freelancer.clone());
    core::p_set(env, &DataKey::Applicants(escrow_id), &list);

    events::ApplicationSubmitted {
        escrow_id,
        depositor: escrow.depositor,
        freelancer,
        proposed_timeline,
    }
    .publish(env);
    Ok(())
}

/// Hire a freelancer for a job that has nobody on it. `caller` is the client
/// or their job manager.
///
/// "Nobody is on this job" rather than "this job is open": the two agree for
/// open jobs, but a job whose named freelancer declined has nobody on it and
/// is not open, and the client must be able to fill it without first pushing
/// it to the board.
pub fn accept_freelancer(
    env: &Env,
    escrow_id: u32,
    caller: Address,
    freelancer: Address,
) -> SfResult<()> {
    caller.require_auth();
    admin::require_not_paused(env)?;
    let mut escrow = core::load_escrow(env, escrow_id)?;
    core::require_depositor_or_manager(env, &escrow, escrow_id, &caller)?;
    if escrow.status != EscrowStatus::Pending {
        return Err(SecureFlowError::JobClosed);
    }
    if escrow.beneficiary.is_some() {
        return Err(SecureFlowError::JobAlreadyAssigned);
    }
    let applied = core::p_has(env, &DataKey::Application(escrow_id, freelancer.clone()));
    let declined = core::p_get::<bool>(env, &DataKey::Declined(escrow_id, freelancer.clone()))
        .unwrap_or(false);
    if !applied && !declined {
        // The old version had a `TODO: Check if freelancer applied` here and
        // would hire any address at all.
        return Err(SecureFlowError::FreelancerNotApplied);
    }
    // THE ONE-WAY KEY, second enforcement point. On an open job the freelancer
    // is only known now, after the manager was appointed — so a manager could
    // otherwise hire itself and approve its own milestones.
    if core::get_job_manager(env, escrow_id).as_ref() == Some(&freelancer) {
        return Err(SecureFlowError::ManagerCannotSelfHire);
    }
    if freelancer == escrow.depositor {
        return Err(SecureFlowError::SelfDealing);
    }
    if escrow.arbiters.contains(&freelancer) {
        return Err(SecureFlowError::ArbiterIsParty);
    }

    escrow.beneficiary = Some(freelancer.clone());
    escrow.is_open_job = false;
    core::save_escrow(env, escrow_id, &escrow);
    core::add_user_escrow(env, freelancer.clone(), escrow_id);

    events::FreelancerAccepted {
        escrow_id,
        freelancer,
        accepted_by: caller,
    }
    .publish(env);
    Ok(())
}

pub fn has_applied(env: &Env, escrow_id: u32, freelancer: Address) -> bool {
    core::p_has(env, &DataKey::Application(escrow_id, freelancer))
}

pub fn get_application(env: &Env, escrow_id: u32, freelancer: Address) -> Option<Application> {
    core::p_get(env, &DataKey::Application(escrow_id, freelancer))
}

pub fn get_applications(env: &Env, escrow_id: u32) -> Vec<Application> {
    get_applications_page(env, escrow_id, 0, MAX_APPLICATIONS)
}

pub fn get_applications_page(
    env: &Env,
    escrow_id: u32,
    offset: u32,
    limit: u32,
) -> Vec<Application> {
    let mut out = Vec::new(env);
    let list = applicants(env, escrow_id);
    let end = offset.saturating_add(limit).min(list.len());
    for i in offset..end {
        if let Some(addr) = list.get(i) {
            if let Some(app) = get_application(env, escrow_id, addr) {
                out.push_back(app);
            }
        }
    }
    out
}

pub fn get_application_count(env: &Env, escrow_id: u32) -> u32 {
    applicants(env, escrow_id).len()
}
