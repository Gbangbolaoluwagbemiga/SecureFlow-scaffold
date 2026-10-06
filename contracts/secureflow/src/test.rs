extern crate std;

use crate::{
    EscrowStatus, MilestoneStatus, SecureFlow, SecureFlowClient, SecureFlowError, DAY_IN_LEDGERS,
    EMERGENCY_REFUND_DELAY_LEDGERS,
};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, Error, String, Symbol, TryFromVal, Vec,
};

const FEE_BP: u32 = 250; // 2.5 %
const DAY_SECONDS: u32 = 86_400;

struct Setup<'a> {
    env: Env,
    sf: SecureFlowClient<'a>,
    token: TokenClient<'a>,
    owner: Address,
    fee_collector: Address,
    client: Address,
    freelancer: Address,
    arbiter: Address,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let arbiter = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(owner.clone());
    let token = TokenClient::new(&env, &sac.address());
    StellarAssetClient::new(&env, &sac.address()).mint(&client, &1_000_000_000_000);

    let id = env.register(SecureFlow, ());
    let sf = SecureFlowClient::new(&env, &id);
    sf.initialize(&owner, &fee_collector, &FEE_BP, &vec![&env, sac.address()]);
    sf.authorize_arbiter(&arbiter);

    Setup {
        env,
        sf,
        token,
        owner,
        fee_collector,
        client,
        freelancer,
        arbiter,
    }
}

fn s(env: &Env, text: &str) -> String {
    String::from_str(env, text)
}

fn ms(env: &Env, amounts: &[i128]) -> Vec<(i128, String)> {
    let mut v = Vec::new(env);
    for a in amounts {
        v.push_back((*a, s(env, "deliverable")));
    }
    v
}

fn err(e: SecureFlowError) -> Error {
    e.into()
}

impl Setup<'_> {
    fn create(
        &self,
        beneficiary: Option<Address>,
        arbiters: Vec<Address>,
        confirmations: u32,
        amounts: &[i128],
    ) -> u32 {
        let total: i128 = amounts.iter().sum();
        self.sf.create_escrow(
            &self.client,
            &beneficiary,
            &arbiters,
            &confirmations,
            &ms(&self.env, amounts),
            &Some(self.token.address.clone()),
            &total,
            &(7 * DAY_SECONDS),
            &s(&self.env, "Logo"),
            &s(&self.env, "A logo"),
        )
    }

    fn direct(&self, amounts: &[i128]) -> u32 {
        self.create(
            Some(self.freelancer.clone()),
            Vec::new(&self.env),
            1,
            amounts,
        )
    }

    /// The accounting invariant: the contract holds exactly what it owes to
    /// escrows plus what it has earned in fees. Nothing more, nothing less.
    fn assert_solvent(&self) {
        let token = Some(self.token.address.clone());
        let balance = self.token.balance(&self.sf.address);
        let owed = self.sf.get_escrowed_amount(&token);
        let fees = self.sf.get_withdrawable_fees(&token);
        assert_eq!(
            balance,
            owed + fees,
            "balance {balance} != owed {owed} + fees {fees}"
        );
    }

    fn deliver_and_approve(&self, id: u32, index: u32) {
        self.sf
            .submit_milestone(&id, &index, &s(&self.env, "done"), &self.freelancer);
        self.sf.approve_milestone(&id, &index, &self.client);
    }

    fn advance(&self, ledgers: u32) {
        self.env.ledger().with_mut(|l| l.sequence_number += ledgers);
    }
}

// ─── Happy path ──────────────────────────────────────────────────────────────

#[test]
fn full_job_pays_freelancer_and_earns_fee_once() {
    let t = setup();
    let before = t.token.balance(&t.client);
    let id = t.direct(&[600, 400]);

    let (deposit, fee) = t.sf.quote_deposit(&1_000);
    assert_eq!((deposit, fee), (1_025, 25));
    assert_eq!(t.token.balance(&t.client), before - 1_025);
    t.assert_solvent();

    t.sf.start_work(&id, &t.freelancer);
    // Starting work must NOT book the fee as revenue (the old double-count).
    assert_eq!(
        t.sf.get_withdrawable_fees(&Some(t.token.address.clone())),
        0
    );

    t.deliver_and_approve(id, 0);
    t.assert_solvent();
    t.deliver_and_approve(id, 1);
    t.assert_solvent();

    let e = t.sf.get_escrow(&id).unwrap();
    assert_eq!(e.status, EscrowStatus::Released);
    assert_eq!(t.token.balance(&t.freelancer), 1_000);
    assert_eq!(
        t.sf.get_withdrawable_fees(&Some(t.token.address.clone())),
        25
    );

    t.sf.withdraw_fees(&Some(t.token.address.clone()), &t.fee_collector);
    assert_eq!(t.token.balance(&t.fee_collector), 25);
    assert_eq!(t.token.balance(&t.sf.address), 0);
    t.assert_solvent();

    // Two-way ratings open on release.
    t.sf.submit_rating(&id, &5, &s(&t.env, "great"), &t.client);
    t.sf.submit_client_rating(&id, &4, &s(&t.env, "clear brief"), &t.freelancer);
    assert_eq!(t.sf.get_average_rating(&t.freelancer), (5, 1));
    assert_eq!(t.sf.get_average_client_rating(&t.client), (4, 1));
}

#[test]
fn contract_emits_events_for_the_notification_poller() {
    let t = setup();
    let id = t.direct(&[100]);
    t.sf.start_work(&id, &t.freelancer);
    t.sf.submit_milestone(&id, &0, &s(&t.env, "done"), &t.freelancer);
    t.sf.approve_milestone(&id, &0, &t.client);

    // The test env keeps the events of the last call. The poller reads
    // topics[0] = name, topics[1] = escrow id, topics[2] = milestone index,
    // last topic = who to notify.
    let ours: std::vec::Vec<Vec<soroban_sdk::Val>> = t
        .env
        .events()
        .all()
        .iter()
        .filter(|(contract, _, _)| contract == &t.sf.address)
        .map(|(_, topics, _)| topics)
        .collect();
    let name = |topics: &Vec<soroban_sdk::Val>| {
        Symbol::try_from_val(&t.env, &topics.get(0).unwrap()).unwrap()
    };

    let approved = ours
        .iter()
        .find(|tp| name(tp) == Symbol::new(&t.env, "milestone_approved"))
        .expect("milestone_approved");
    assert_eq!(
        u32::try_from_val(&t.env, &approved.get(1).unwrap()).unwrap(),
        id
    );
    assert_eq!(
        u32::try_from_val(&t.env, &approved.get(2).unwrap()).unwrap(),
        0
    );
    assert_eq!(
        Address::try_from_val(&t.env, &approved.get(3).unwrap()).unwrap(),
        t.freelancer
    );

    let completed = ours
        .iter()
        .find(|tp| name(tp) == Symbol::new(&t.env, "escrow_completed"))
        .expect("escrow_completed");
    assert_eq!(
        Address::try_from_val(&t.env, &completed.get(2).unwrap()).unwrap(),
        t.freelancer
    );
}

// ─── Creation validation ─────────────────────────────────────────────────────

#[test]
fn create_rejects_bad_input_with_specific_errors() {
    let t = setup();
    let env = &t.env;
    let token = Some(t.token.address.clone());
    let none: Vec<Address> = Vec::new(env);
    let create = |beneficiary: Option<Address>,
                  arbiters: &Vec<Address>,
                  conf: u32,
                  m: Vec<(i128, String)>,
                  total: i128| {
        t.sf.try_create_escrow(
            &t.client,
            &beneficiary,
            arbiters,
            &conf,
            &m,
            &token,
            &total,
            &DAY_SECONDS,
            &s(env, "t"),
            &s(env, "d"),
        )
    };

    assert_eq!(
        create(None, &none, 1, ms(env, &[100, 100]), 150),
        Err(Ok(err(SecureFlowError::MilestoneSumMismatch)))
    );
    assert_eq!(
        create(None, &none, 1, ms(env, &[100, 0]), 100),
        Err(Ok(err(SecureFlowError::ZeroMilestoneAmount)))
    );
    assert_eq!(
        create(None, &none, 1, Vec::new(env), 0),
        Err(Ok(err(SecureFlowError::InvalidAmount)))
    );
    assert_eq!(
        create(Some(t.client.clone()), &none, 1, ms(env, &[100]), 100),
        Err(Ok(err(SecureFlowError::SelfDealing)))
    );
    let dup = vec![env, t.arbiter.clone(), t.arbiter.clone()];
    assert_eq!(
        create(None, &dup, 1, ms(env, &[100]), 100),
        Err(Ok(err(SecureFlowError::DuplicateArbiter)))
    );
    let one = vec![env, t.arbiter.clone()];
    assert_eq!(
        create(None, &one, 2, ms(env, &[100]), 100),
        Err(Ok(err(SecureFlowError::InvalidConfirmations)))
    );
    let party = vec![env, t.freelancer.clone()];
    assert_eq!(
        create(Some(t.freelancer.clone()), &party, 1, ms(env, &[100]), 100),
        Err(Ok(err(SecureFlowError::ArbiterIsParty)))
    );

    let other = env
        .register_stellar_asset_contract_v2(t.owner.clone())
        .address();
    let r = t.sf.try_create_escrow(
        &t.client,
        &None,
        &none,
        &1,
        &ms(env, &[100]),
        &Some(other),
        &100,
        &DAY_SECONDS,
        &s(env, "t"),
        &s(env, "d"),
    );
    assert_eq!(r, Err(Ok(err(SecureFlowError::TokenNotWhitelisted))));
    // Nothing was taken from the client by any refused call.
    assert_eq!(t.token.balance(&t.sf.address), 0);
}

// ─── Open jobs, cancellation, decline, reopen ────────────────────────────────

#[test]
fn open_job_cannot_hire_someone_who_never_applied() {
    let t = setup();
    let id = t.create(None, Vec::new(&t.env), 1, &[100]);
    let stranger = Address::generate(&t.env);
    assert_eq!(
        t.sf.try_accept_freelancer(&id, &stranger, &t.client),
        Err(Ok(err(SecureFlowError::FreelancerNotApplied)))
    );
    t.sf.apply_to_job(&id, &s(&t.env, "hire me"), &5, &t.freelancer);
    assert_eq!(
        t.sf.try_apply_to_job(&id, &s(&t.env, "again"), &5, &t.freelancer),
        Err(Ok(err(SecureFlowError::AlreadyApplied)))
    );
    t.sf.accept_freelancer(&id, &t.freelancer, &t.client);
    assert_eq!(
        t.sf.get_escrow(&id).unwrap().beneficiary,
        Some(t.freelancer.clone())
    );
    assert_eq!(t.sf.get_application_count(&id), 1);
}

#[test]
fn cancel_refunds_fee_and_charges_penalty_only_with_applicants() {
    let t = setup();
    let start = t.token.balance(&t.client);

    // No applicants: everything back, fee included.
    let id = t.create(None, Vec::new(&t.env), 1, &[1_000]);
    t.sf.cancel_job(&id, &t.client);
    assert_eq!(t.token.balance(&t.client), start);
    t.assert_solvent();

    // One applicant: 5 % penalty on the budget, fee still refunded.
    let id = t.create(None, Vec::new(&t.env), 1, &[1_000]);
    t.sf.apply_to_job(&id, &s(&t.env, "me"), &3, &t.freelancer);
    t.sf.cancel_job(&id, &t.client);
    assert_eq!(t.token.balance(&t.client), start - 50);
    assert_eq!(
        t.sf.get_withdrawable_fees(&Some(t.token.address.clone())),
        50
    );
    assert_eq!(
        t.sf.get_escrow(&id).unwrap().status,
        EscrowStatus::Cancelled
    );
    t.assert_solvent();
}

#[test]
fn directly_assigned_job_can_be_cancelled_before_work_starts() {
    let t = setup();
    let start = t.token.balance(&t.client);
    let id = t.direct(&[500]);
    t.sf.cancel_job(&id, &t.client); // the old contract refused this outright
    assert_eq!(t.token.balance(&t.client), start);

    let id = t.direct(&[500]);
    t.sf.start_work(&id, &t.freelancer);
    assert_eq!(
        t.sf.try_cancel_job(&id, &t.client),
        Err(Ok(err(SecureFlowError::CannotModifyStartedEscrow)))
    );
    t.assert_solvent();
}

#[test]
fn decline_then_rehire_or_reopen() {
    let t = setup();
    let id = t.direct(&[300]);
    t.sf.decline_assignment(&id, &t.freelancer);
    let e = t.sf.get_escrow(&id).unwrap();
    assert_eq!(e.beneficiary, None);
    assert!(!e.is_open_job);
    assert!(t.sf.get_user_escrows(&t.freelancer).is_empty());

    // The client can name the decliner again without an application...
    t.sf.accept_freelancer(&id, &t.freelancer, &t.client);
    t.sf.decline_assignment(&id, &t.freelancer);
    // ...or put the job on the board.
    t.sf.reopen_job(&id, &t.client);
    assert!(t.sf.get_escrow(&id).unwrap().is_open_job);
    let other = Address::generate(&t.env);
    t.sf.apply_to_job(&id, &s(&t.env, "me"), &2, &other);
    t.sf.accept_freelancer(&id, &other, &t.client);
    t.assert_solvent();
}

// ─── Job manager (Autopilot) ─────────────────────────────────────────────────

#[test]
fn manager_can_run_the_job_but_never_be_paid_by_it() {
    let t = setup();
    let manager = Address::generate(&t.env);
    let id = t.create(None, Vec::new(&t.env), 1, &[200]);
    t.sf.set_job_manager(&id, &manager, &t.client);

    // The manager cannot apply to, or hire itself for, the job it manages.
    assert_eq!(
        t.sf.try_apply_to_job(&id, &s(&t.env, "me"), &1, &manager),
        Err(Ok(err(SecureFlowError::ManagerCannotSelfHire)))
    );

    t.sf.apply_to_job(&id, &s(&t.env, "me"), &1, &t.freelancer);
    t.sf.accept_freelancer(&id, &t.freelancer, &manager); // manager hires
    assert_eq!(
        t.sf.try_set_job_manager(&id, &t.freelancer, &t.client),
        Err(Ok(err(SecureFlowError::ManagerCannotBeBeneficiary)))
    );

    t.sf.start_work(&id, &t.freelancer);
    t.sf.submit_milestone(&id, &0, &s(&t.env, "v1"), &t.freelancer);
    t.sf.reject_milestone(&id, &0, &s(&t.env, "fix"), &manager);
    t.sf.submit_milestone(&id, &0, &s(&t.env, "v2"), &t.freelancer);
    t.sf.approve_milestone(&id, &0, &manager); // manager approves...
    assert_eq!(t.token.balance(&t.freelancer), 200); // ...the freelancer is paid
    assert_eq!(t.token.balance(&manager), 0);

    t.sf.revoke_job_manager(&id, &t.client);
    assert_eq!(t.sf.get_job_manager(&id), None);
    t.assert_solvent();
}

// ─── Disputes ────────────────────────────────────────────────────────────────

#[test]
fn quorum_needs_agreement_on_the_same_split() {
    let t = setup();
    let a2 = Address::generate(&t.env);
    t.sf.authorize_arbiter(&a2);
    let panel = vec![&t.env, t.arbiter.clone(), a2.clone()];
    let id = t.create(Some(t.freelancer.clone()), panel, 2, &[1_000]);
    t.sf.start_work(&id, &t.freelancer);
    t.sf.submit_milestone(&id, &0, &s(&t.env, "done"), &t.freelancer);
    t.sf.dispute_milestone(&id, &0, &s(&t.env, "incomplete"), &t.client);

    let why = s(&t.env, "ruling");
    // Opposite splits: two votes cast, no quorum, no money moves.
    t.sf.resolve_dispute(&id, &0, &t.arbiter, &1_000, &0, &why);
    t.sf.resolve_dispute(&id, &0, &a2, &0, &1_000, &why);
    assert_eq!(t.sf.get_escrow(&id).unwrap().status, EscrowStatus::Disputed);
    assert_eq!(t.sf.get_dispute_vote_count(&id), 2);

    // Agreement executes.
    t.sf.resolve_dispute(&id, &0, &t.arbiter, &600, &400, &why);
    t.sf.resolve_dispute(&id, &0, &a2, &600, &400, &why);
    assert_eq!(t.token.balance(&t.freelancer), 600);
    let e = t.sf.get_escrow(&id).unwrap();
    assert_eq!(e.status, EscrowStatus::Released);
    assert_eq!(
        t.sf.get_milestone(&id, &0).unwrap().status,
        MilestoneStatus::Resolved
    );
    // Client got 400 back plus that share of the fee (25 * 400/1000 = 10);
    // the platform keeps the fee on the 600 that was paid.
    assert_eq!(
        t.sf.get_withdrawable_fees(&Some(t.token.address.clone())),
        15
    );
    t.assert_solvent();
}

#[test]
fn arbiter_cannot_pay_an_already_approved_milestone_twice() {
    let t = setup();
    let id = t.direct(&[500, 500]);
    t.sf.start_work(&id, &t.freelancer);
    t.deliver_and_approve(id, 0);
    t.sf.submit_milestone(&id, &1, &s(&t.env, "done"), &t.freelancer);
    t.sf.dispute_milestone(&id, &1, &s(&t.env, "late"), &t.client);
    assert_eq!(
        t.sf.try_resolve_dispute(&id, &0, &t.arbiter, &500, &0, &s(&t.env, "x")),
        Err(Ok(err(SecureFlowError::MilestoneAlreadySettled)))
    );
    assert_eq!(
        t.sf.try_resolve_dispute(&id, &1, &t.arbiter, &300, &100, &s(&t.env, "x")),
        Err(Ok(err(SecureFlowError::ResolutionSplitMismatch)))
    );
    assert_eq!(
        t.sf.try_resolve_dispute(&id, &1, &t.arbiter, &500, &0, &s(&t.env, "")),
        Err(Ok(err(SecureFlowError::ReasonRequired)))
    );
    t.sf.resolve_dispute(&id, &1, &t.arbiter, &250, &250, &s(&t.env, "half"));
    assert_eq!(t.token.balance(&t.freelancer), 750);
    t.assert_solvent();
}

#[test]
fn dead_panel_falls_back_to_protocol_arbiters_and_parties_cannot_rule() {
    let t = setup();
    // The frontend names a placeholder arbiter that holds no authority.
    let placeholder = Address::generate(&t.env);
    let id = t.create(
        Some(t.freelancer.clone()),
        vec![&t.env, placeholder],
        1,
        &[400],
    );
    t.sf.start_work(&id, &t.freelancer);
    t.sf.submit_milestone(&id, &0, &s(&t.env, "done"), &t.freelancer);
    t.sf.dispute_milestone(&id, &0, &s(&t.env, "bad"), &t.freelancer);

    // The freelancer, even if authorised, may not rule on their own job.
    t.sf.authorize_arbiter(&t.freelancer);
    assert_eq!(
        t.sf.try_resolve_dispute(&id, &0, &t.freelancer, &400, &0, &s(&t.env, "mine")),
        Err(Ok(err(SecureFlowError::ArbiterIsParty)))
    );
    t.sf.resolve_dispute(&id, &0, &t.arbiter, &400, &0, &s(&t.env, "delivered"));
    assert_eq!(t.sf.get_escrow(&id).unwrap().status, EscrowStatus::Released);
    t.assert_solvent();
}

#[test]
fn after_arbitration_client_can_withdraw_or_reopen_the_rest() {
    let t = setup();
    let id = t.direct(&[300, 700]);
    t.sf.start_work(&id, &t.freelancer);
    t.sf.submit_milestone(&id, &0, &s(&t.env, "done"), &t.freelancer);
    t.sf.dispute_milestone(&id, &0, &s(&t.env, "x"), &t.client);
    t.sf.resolve_dispute(&id, &0, &t.arbiter, &300, &0, &s(&t.env, "ok"));
    assert!(t.sf.is_arbitrated(&id));

    // Reopen keeps the paid milestone paid and puts the rest on the board.
    t.sf.reopen_job(&id, &t.client);
    let e = t.sf.get_escrow(&id).unwrap();
    assert_eq!(
        (e.status, e.paid_amount, e.beneficiary),
        (EscrowStatus::Pending, 300, None)
    );
    // A full rewrite would erase paid history, so it is refused...
    assert_eq!(
        t.sf.try_set_milestones(&id, &ms(&t.env, &[500]), &t.client),
        Err(Ok(err(SecureFlowError::MilestoneAlreadyStarted)))
    );
    // ...and cancelling returns only the unpaid 700 (plus its fee share).
    let before = t.token.balance(&t.client);
    t.sf.cancel_job(&id, &t.client);
    assert_eq!(t.token.balance(&t.client), before + 700 + 17); // 25 * 700/1000 = 17
    t.assert_solvent();
}

// ─── Deadlines & emergency exits ─────────────────────────────────────────────

#[test]
fn emergency_refund_waits_for_the_window_and_respects_delivered_work() {
    let t = setup();
    let id = t.direct(&[400, 600]);
    t.sf.start_work(&id, &t.freelancer);
    t.deliver_and_approve(id, 0);
    t.sf.submit_milestone(&id, &1, &s(&t.env, "done"), &t.freelancer);

    assert_eq!(
        t.sf.try_emergency_refund_after_deadline(&id, &t.client),
        Err(Ok(err(SecureFlowError::EmergencyPeriodNotReached)))
    );
    t.advance(7 * DAY_IN_LEDGERS + EMERGENCY_REFUND_DELAY_LEDGERS + 1);
    assert_eq!(
        t.sf.try_emergency_refund_after_deadline(&id, &t.client),
        Err(Ok(err(SecureFlowError::RefundBlockedBySubmittedWork)))
    );

    t.sf.reject_milestone(&id, &1, &s(&t.env, "no"), &t.client);
    let before = t.token.balance(&t.client);
    t.sf.emergency_refund_after_deadline(&id, &t.client);
    // 600 unpaid + its fee share (25 * 600/1000 = 15) back to the client.
    assert_eq!(t.token.balance(&t.client), before + 615);
    assert_eq!(t.sf.get_escrow(&id).unwrap().status, EscrowStatus::Expired);
    t.assert_solvent();
}

#[test]
fn overdue_dispute_lets_an_arbiter_settle_the_whole_job() {
    let t = setup();
    let id = t.direct(&[500, 500]);
    t.sf.start_work(&id, &t.freelancer);
    assert_eq!(
        t.sf.try_raise_overdue_dispute(&id, &t.freelancer, &s(&t.env, "late")),
        Err(Ok(err(SecureFlowError::DeadlineNotPassed)))
    );
    t.advance(8 * DAY_IN_LEDGERS);
    t.sf.raise_overdue_dispute(&id, &t.freelancer, &s(&t.env, "client went quiet"));
    t.sf.arbiter_award_freelancer(&id, &t.arbiter, &700);
    assert_eq!(t.token.balance(&t.freelancer), 700);
    assert_eq!(t.sf.get_escrow(&id).unwrap().status, EscrowStatus::Released);
    assert!(t.sf.get_overdue_request(&id).is_none());
    t.assert_solvent();
}

#[test]
fn deadline_extension_is_converted_from_seconds_to_ledgers() {
    let t = setup();
    let id = t.direct(&[100]);
    let before = t.sf.get_escrow(&id).unwrap().deadline;
    t.sf.extend_deadline(&id, &DAY_SECONDS, &t.client);
    assert_eq!(
        t.sf.get_escrow(&id).unwrap().deadline,
        before + DAY_IN_LEDGERS
    );
}

// ─── Editing a funded job ────────────────────────────────────────────────────

#[test]
fn approved_price_change_moves_the_money() {
    let t = setup();
    let id = t.direct(&[1_000]);
    t.sf.start_work(&id, &t.freelancer);
    t.sf.propose_milestone_change(&id, &0, &1_200, &s(&t.env, "bigger scope"), &t.freelancer);
    let before = t.token.balance(&t.client);
    t.sf.approve_milestone_proposal(&id, &0, &t.client);
    assert_eq!(t.token.balance(&t.client), before - 205); // 200 + 2.5 % fee share
    assert_eq!(t.sf.get_escrow(&id).unwrap().total_amount, 1_200);

    t.deliver_and_approve(id, 0);
    assert_eq!(t.sf.get_escrow(&id).unwrap().status, EscrowStatus::Released);
    t.assert_solvent();
}

#[test]
fn milestone_edits_keep_funds_and_milestones_in_step() {
    let t = setup();
    let id = t.direct(&[100, 200]);
    t.sf.add_milestone(&id, &300, &s(&t.env, "extra"), &t.client);
    t.sf.add_job_funds(&id, &t.client, &40, &0);
    t.sf.withdraw_job_funds(&id, &t.client, &20, &1);
    t.sf.remove_milestone(&id, &0, &t.client);
    t.assert_solvent();

    let e = t.sf.get_escrow(&id).unwrap();
    let sum: i128 = t.sf.get_milestones(&id).iter().map(|m| m.amount).sum();
    assert_eq!(sum, e.total_amount);
    assert_eq!(e.milestone_count, 2);

    t.sf.set_milestones(&id, &ms(&t.env, &[250, 250, 250]), &t.client);
    let e = t.sf.get_escrow(&id).unwrap();
    assert_eq!((e.total_amount, e.milestone_count), (750, 3));
    t.assert_solvent();

    // Finish it and confirm the contract empties out completely.
    t.sf.start_work(&id, &t.freelancer);
    for i in 0..3 {
        t.deliver_and_approve(id, i);
    }
    t.sf.withdraw_fees(&Some(t.token.address.clone()), &t.fee_collector);
    assert_eq!(t.token.balance(&t.sf.address), 0);
}

// ─── Admin ───────────────────────────────────────────────────────────────────

#[test]
fn admin_guards() {
    let t = setup();
    assert_eq!(
        t.sf.try_set_platform_fee_bp(&1_001),
        Err(Ok(err(SecureFlowError::FeeTooHigh)))
    );
    assert_eq!(
        t.sf.try_initialize(&t.owner, &t.fee_collector, &FEE_BP, &Vec::new(&t.env)),
        Err(Ok(err(SecureFlowError::AlreadyInitialized)))
    );
    assert_eq!(
        t.sf.try_withdraw_fees(&Some(t.token.address.clone()), &t.client),
        Err(Ok(err(SecureFlowError::OnlyFeeCollector)))
    );

    t.sf.pause_contract();
    assert_eq!(
        t.sf.try_create_escrow(
            &t.client,
            &None,
            &Vec::new(&t.env),
            &1,
            &ms(&t.env, &[1]),
            &Some(t.token.address.clone()),
            &1,
            &DAY_SECONDS,
            &s(&t.env, "t"),
            &s(&t.env, "d"),
        ),
        Err(Ok(err(SecureFlowError::ContractIsPaused)))
    );
    t.sf.unpause_contract();
    t.sf.set_job_creation_paused(&true);
    assert!(t.sf.is_job_creation_paused());

    // Only surplus above what is owed can be recovered.
    t.sf.set_job_creation_paused(&false);
    let id = t.direct(&[1_000]);
    StellarAssetClient::new(&t.env, &t.token.address).mint(&t.sf.address, &50);
    assert_eq!(
        t.sf.try_withdraw_stuck_funds(&t.token.address, &t.owner, &51),
        Err(Ok(err(SecureFlowError::InsufficientWithdrawable)))
    );
    t.sf.withdraw_stuck_funds(&t.token.address, &t.owner, &50);
    t.assert_solvent();
    let _ = id;
}
