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

// ─── Identity verification (Didit) ───────────────────────────────────────────

#[test]
fn verification_binds_one_person_to_one_wallet() {
    let t = setup();
    let verifier = Address::generate(&t.env);
    let person_a = soroban_sdk::BytesN::from_array(&t.env, &[1u8; 32]);
    let person_b = soroban_sdk::BytesN::from_array(&t.env, &[2u8; 32]);
    let sybil = Address::generate(&t.env);

    assert_eq!(
        t.sf.try_attest_verification(&verifier, &t.freelancer, &person_a),
        Err(Ok(err(SecureFlowError::NoVerifierSet)))
    );
    t.sf.set_verifier(&verifier);
    assert_eq!(
        t.sf.try_attest_verification(&t.client, &t.freelancer, &person_a),
        Err(Ok(err(SecureFlowError::OnlyVerifier)))
    );

    assert!(!t.sf.is_verified(&t.freelancer));
    t.sf.attest_verification(&verifier, &t.freelancer, &person_a);
    assert!(t.sf.is_verified(&t.freelancer));
    // Re-verifying the same person on the same wallet is a harmless refresh.
    t.sf.attest_verification(&verifier, &t.freelancer, &person_a);

    // The sybil: the same person tries to verify a second wallet.
    assert_eq!(
        t.sf.try_attest_verification(&verifier, &sybil, &person_a),
        Err(Ok(err(SecureFlowError::DuplicateIdentity)))
    );
    // A verified wallet can't be re-bound to someone else.
    assert_eq!(
        t.sf.try_attest_verification(&verifier, &t.freelancer, &person_b),
        Err(Ok(err(SecureFlowError::WalletBoundToOtherIdentity)))
    );
    assert!(!t.sf.is_verified(&sybil));

    // Revoking frees the identity, so the person can move to a new wallet.
    t.sf.revoke_verification(&verifier, &t.freelancer);
    assert!(!t.sf.is_verified(&t.freelancer));
    assert_eq!(
        t.sf.try_revoke_verification(&verifier, &t.freelancer),
        Err(Ok(err(SecureFlowError::NotVerified)))
    );
    t.sf.attest_verification(&verifier, &sybil, &person_a);
    assert_eq!(
        t.sf.get_verification(&sybil).unwrap().identity_hash,
        person_a
    );
}

// ─── Read indexes ────────────────────────────────────────────────────────────

#[test]
fn open_jobs_and_applications_index_follow_the_job() {
    let t = setup();
    let open = t.create(None, Vec::new(&t.env), 1, &[100]);
    let direct = t.direct(&[100]);
    assert_eq!(t.sf.get_open_jobs(), vec![&t.env, open]); // direct jobs aren't listed

    t.sf.apply_to_job(&open, &s(&t.env, "me"), &1, &t.freelancer);
    assert_eq!(
        t.sf.get_freelancer_applications(&t.freelancer),
        vec![&t.env, open]
    );

    t.sf.accept_freelancer(&open, &t.freelancer, &t.client);
    assert!(t.sf.get_open_jobs().is_empty()); // hired: no longer open

    t.sf.decline_assignment(&open, &t.freelancer);
    assert!(t.sf.get_open_jobs().is_empty()); // declined isn't open until reopened
    t.sf.reopen_job(&open, &t.client);
    assert_eq!(t.sf.get_open_jobs(), vec![&t.env, open]);

    t.sf.cancel_job(&open, &t.client);
    assert!(t.sf.get_open_jobs().is_empty());

    // Batch read: one call, missing ids skipped, capped at 50.
    let got = t.sf.get_escrows(&vec![&t.env, open, direct, 999]);
    assert_eq!(got.len(), 2);
    assert_eq!(got.get(1).unwrap().0, direct);
    let mut too_many = Vec::new(&t.env);
    for i in 0..51u32 {
        too_many.push_back(i);
    }
    assert_eq!(
        t.sf.try_get_escrows(&too_many),
        Err(Ok(err(SecureFlowError::InvalidParameter)))
    );

    // Backfill is idempotent and owner-only.
    assert_eq!(t.sf.rebuild_indexes(&1, &10), 0);
    assert_eq!(
        t.sf.get_freelancer_applications(&t.freelancer),
        vec![&t.env, open]
    );
}

// ─── Yield on idle funds ─────────────────────────────────────────────────────

mod mock_pool {
    //! Behaves like a Blend pool for what `SecureFlow` uses: supply mints
    //! b-tokens at `b_rate` (rounded down), withdraw burns them (rounded up).
    //! Raising `b_rate` is interest; `set_fail` makes every call refuse.
    use crate::blend::{Positions, Request, Reserve, ReserveConfig, ReserveData, SCALAR_12};
    use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Map, Vec};

    #[contracttype]
    enum K {
        BRate,
        Fail,
        BTokens(Address),
    }

    #[contract]
    pub struct MockPool;

    #[contractimpl]
    impl MockPool {
        pub fn set_b_rate(env: Env, b_rate: i128) {
            env.storage().instance().set(&K::BRate, &b_rate);
        }
        pub fn set_fail(env: Env, fail: bool) {
            env.storage().instance().set(&K::Fail, &fail);
        }
        pub fn get_reserve(env: Env, asset: Address) -> Reserve {
            Reserve {
                asset,
                config: ReserveConfig {
                    c_factor: 0,
                    decimals: 7,
                    enabled: true,
                    index: 0,
                    l_factor: 0,
                    max_util: 0,
                    r_base: 0,
                    r_one: 0,
                    r_three: 0,
                    r_two: 0,
                    reactivity: 0,
                    supply_cap: i128::MAX,
                    util: 0,
                },
                data: ReserveData {
                    b_rate: rate(&env),
                    b_supply: 0,
                    backstop_credit: 0,
                    d_rate: SCALAR_12,
                    d_supply: 0,
                    ir_mod: 0,
                    last_time: 0,
                },
                scalar: 10_000_000,
            }
        }
        pub fn get_positions(env: Env, address: Address) -> Positions {
            let mut supply = Map::new(&env);
            let bt: i128 = env
                .storage()
                .instance()
                .get(&K::BTokens(address))
                .unwrap_or(0);
            if bt > 0 {
                supply.set(0, bt);
            }
            Positions {
                collateral: Map::new(&env),
                liabilities: Map::new(&env),
                supply,
            }
        }
        pub fn submit(
            env: Env,
            from: Address,
            spender: Address,
            to: Address,
            requests: Vec<Request>,
        ) -> Positions {
            assert!(
                !env.storage().instance().get(&K::Fail).unwrap_or(false),
                "pool refuses"
            );
            from.require_auth();
            spender.require_auth();
            let me = env.current_contract_address();
            let key = K::BTokens(from.clone());
            let mut bt: i128 = env.storage().instance().get(&key).unwrap_or(0);
            for r in requests.iter() {
                let tok = token::TokenClient::new(&env, &r.address);
                match r.request_type {
                    0 => {
                        tok.transfer(&spender, &me, &r.amount);
                        bt += r.amount * SCALAR_12 / rate(&env);
                    }
                    1 => {
                        let burn = (r.amount * SCALAR_12 + rate(&env) - 1) / rate(&env);
                        assert!(burn <= bt, "burning more than held");
                        bt -= burn;
                        tok.transfer(&me, &to, &r.amount);
                    }
                    _ => panic!("unsupported request"),
                }
            }
            env.storage().instance().set(&key, &bt);
            Self::get_positions(env, from)
        }
    }

    fn rate(env: &Env) -> i128 {
        env.storage().instance().get(&K::BRate).unwrap_or(SCALAR_12)
    }
}

use mock_pool::{MockPool, MockPoolClient};

fn with_pool<'a>(t: &Setup<'a>) -> MockPoolClient<'a> {
    let id = t.env.register(MockPool, ());
    let pool = MockPoolClient::new(&t.env, &id);
    // b_rate 1.1: a pool that has already earned, so deposits round.
    pool.set_b_rate(&1_100_000_000_000);
    // The pool's own liquidity, which pays the interest.
    StellarAssetClient::new(&t.env, &t.token.address).mint(&id, &1_000_000_000_000);
    t.sf.set_yield_pool(&Some(t.token.address.clone()), &Some(id.clone()));
    pool
}

impl Setup<'_> {
    /// With funds in a pool the cash alone can't cover what's owed; cash plus
    /// what the pool holds for this contract must.
    fn assert_covered(&self, ids: &[u32]) {
        let token = Some(self.token.address.clone());
        let cash = self.token.balance(&self.sf.address);
        let supplied: i128 = ids.iter().map(|id| self.sf.get_yield_info(id).value).sum();
        let owed = self.sf.get_escrowed_amount(&token);
        let fees = self.sf.get_withdrawable_fees(&token);
        // The pool rounds each deposit down by up to a stroop or two; that
        // dust is covered by the escrow's held fee when the money comes back.
        let dust = 2 * ids.len() as i128;
        assert!(
            cash + supplied + dust >= owed + fees,
            "cash {cash} + supplied {supplied} < owed {owed} + fees {fees}"
        );
    }
}

#[test]
fn yield_supplies_idle_funds_and_pays_milestones_whole() {
    let t = setup();
    let pool = with_pool(&t);
    let id = t.direct(&[600_000, 400_000]);

    t.sf.set_yield_opt_in(&id, &true, &t.client);
    let info = t.sf.get_yield_info(&id);
    assert!(info.opted_in && info.available);
    assert_eq!(info.principal, 1_000_000);
    t.assert_covered(&[id]);

    // Interest: the pool's rate rises 10%.
    pool.set_b_rate(&1_210_000_000_000);
    assert!(t.sf.get_yield_info(&id).value > 1_090_000);

    t.sf.start_work(&id, &t.freelancer);
    let before = t.token.balance(&t.freelancer);
    t.deliver_and_approve(id, 0);
    // Paid exactly the milestone, from cash brought home first.
    assert_eq!(t.token.balance(&t.freelancer) - before, 600_000);
    let info = t.sf.get_yield_info(&id);
    assert_eq!(info.principal, 0, "everything came home before the payout");
    assert!(
        info.earned >= 99_000,
        "interest held for the escrow: {}",
        info.earned
    );
    t.assert_solvent();

    // A keeper puts the rest back to work.
    assert_eq!(t.sf.invest_idle(&id), 400_000);
    t.assert_covered(&[id]);
    t.deliver_and_approve(id, 1);
    assert_eq!(t.sf.get_escrow(&id).unwrap().status, EscrowStatus::Released);
    t.assert_solvent();
}

#[test]
fn yield_is_claimed_once_with_the_freelancer_share() {
    let t = setup();
    let pool = with_pool(&t);
    let id = t.direct(&[1_000_000]);
    t.sf.set_yield_opt_in(&id, &true, &t.client);
    pool.set_b_rate(&1_320_000_000_000); // +20%

    // Not before the job is finished.
    assert_eq!(
        t.sf.try_claim_yield(&id),
        Err(Ok(err(SecureFlowError::YieldEscrowNotFinal)))
    );

    t.sf.start_work(&id, &t.freelancer);
    t.deliver_and_approve(id, 0);
    let earned = t.sf.get_yield_info(&id).earned;
    assert!(earned > 190_000);

    let (c0, f0) = (t.token.balance(&t.client), t.token.balance(&t.freelancer));
    let (to_client, to_freelancer) = t.sf.claim_yield(&id);
    assert_eq!(to_client + to_freelancer, earned);
    assert_eq!(to_freelancer, earned * 2_000 / 10_000, "20% default share");
    assert_eq!(t.token.balance(&t.client) - c0, to_client);
    assert_eq!(t.token.balance(&t.freelancer) - f0, to_freelancer);
    t.assert_solvent();

    // Exactly once.
    assert_eq!(
        t.sf.try_claim_yield(&id),
        Err(Ok(err(SecureFlowError::YieldNothingToClaim)))
    );
}

#[test]
fn cancelled_job_returns_principal_and_all_yield_to_the_client() {
    let t = setup();
    let pool = with_pool(&t);
    let id = t.direct(&[1_000_000]);
    let start = t.token.balance(&t.client);
    t.sf.set_yield_opt_in(&id, &true, &t.client);
    pool.set_b_rate(&1_210_000_000_000);

    t.sf.cancel_job(&id, &t.client);
    t.assert_solvent();
    let (to_client, to_freelancer) = t.sf.claim_yield(&id);
    assert_eq!(to_freelancer, 0, "no work, no freelancer share");
    assert!(to_client > 0);
    // Budget and fee back (nobody applied, no penalty), plus the interest.
    assert_eq!(t.token.balance(&t.client), start + 1_025_000 + to_client);
    t.assert_solvent();
}

#[test]
fn rounding_dust_comes_from_the_fee_never_the_principal() {
    let t = setup();
    let _pool = with_pool(&t); // rate 1.1, no interest added
    let id = t.direct(&[1_000_001]);
    let fee_before = t.sf.get_escrow(&id).unwrap().platform_fee;
    t.sf.set_yield_opt_in(&id, &true, &t.client);

    // Brought straight back: the pool's rounding loses a stroop or two.
    t.sf.set_yield_opt_in(&id, &false, &t.client);
    let escrow = t.sf.get_escrow(&id).unwrap();
    assert!(escrow.platform_fee < fee_before && escrow.platform_fee >= fee_before - 5);
    assert_eq!(escrow.total_amount, 1_000_001, "principal untouched");
    t.assert_solvent();

    // And the freelancer still gets every stroop.
    t.sf.start_work(&id, &t.freelancer);
    let before = t.token.balance(&t.freelancer);
    t.deliver_and_approve(id, 0);
    assert_eq!(t.token.balance(&t.freelancer) - before, 1_000_001);
    t.assert_solvent();
}

#[test]
fn a_refusing_pool_delays_a_payout_and_loses_nothing() {
    let t = setup();
    let pool = with_pool(&t);
    let id = t.direct(&[1_000_000]);
    t.sf.set_yield_opt_in(&id, &true, &t.client);
    t.sf.start_work(&id, &t.freelancer);
    t.sf.submit_milestone(&id, &0, &s(&t.env, "done"), &t.freelancer);

    pool.set_fail(&true);
    assert_eq!(
        t.sf.try_approve_milestone(&id, &0, &t.client),
        Err(Ok(err(SecureFlowError::YieldPoolCallFailed)))
    );
    // Nothing moved: still supplied, still owed, milestone still waiting.
    assert_eq!(t.sf.get_yield_info(&id).principal, 1_000_000);
    t.assert_covered(&[id]);

    pool.set_fail(&false);
    let before = t.token.balance(&t.freelancer);
    t.sf.approve_milestone(&id, &0, &t.client);
    assert_eq!(t.token.balance(&t.freelancer) - before, 1_000_000);
    t.assert_solvent();
}

#[test]
fn yield_guards() {
    let t = setup();
    let id = t.direct(&[1_000_000]);
    // No pool for the token yet.
    assert_eq!(
        t.sf.try_set_yield_opt_in(&id, &true, &t.client),
        Err(Ok(err(SecureFlowError::YieldNotConfigured)))
    );
    let pool = with_pool(&t);
    // Only the client.
    assert_eq!(
        t.sf.try_set_yield_opt_in(&id, &true, &t.freelancer),
        Err(Ok(err(SecureFlowError::OnlyDepositor)))
    );
    // Not opted in: nothing to invest.
    assert_eq!(
        t.sf.try_invest_idle(&id),
        Err(Ok(err(SecureFlowError::YieldNotOptedIn)))
    );
    // Share above 100%.
    assert_eq!(
        t.sf.try_set_yield_freelancer_share(&10_001),
        Err(Ok(err(SecureFlowError::YieldShareTooHigh)))
    );

    // Earned yield is owed, so the owner can't sweep it as surplus...
    t.sf.set_yield_opt_in(&id, &true, &t.client);
    pool.set_b_rate(&1_210_000_000_000);
    t.sf.set_yield_opt_in(&id, &false, &t.client);
    let earned = t.sf.get_yield_info(&id).earned;
    assert!(earned > 0);
    assert_eq!(
        t.sf.try_withdraw_stuck_funds(&t.token.address, &t.owner, &earned),
        Err(Ok(err(SecureFlowError::InsufficientWithdrawable)))
    );
    // ...and an escrow holding it can't be deleted.
    t.sf.cancel_job(&id, &t.client);
    assert_eq!(
        t.sf.try_delete_escrow(&id),
        Err(Ok(err(SecureFlowError::FundsStillLocked)))
    );
    t.sf.claim_yield(&id);
    t.sf.delete_escrow(&id);
    t.assert_solvent();
}

#[test]
fn zero_fee_platform_still_returns_principal_whole() {
    let t = setup();
    let _pool = with_pool(&t); // rate 1.1: every round trip loses dust

    // A 0% platform with no fees earned yet can't cover rounding: refused.
    t.sf.set_platform_fee_bp(&0);
    let early = t.direct(&[1_000_001]);
    assert_eq!(
        t.sf.try_set_yield_opt_in(&early, &true, &t.client),
        Err(Ok(err(SecureFlowError::YieldFeeReserveTooSmall)))
    );

    // Earlier jobs have earned the platform some fees.
    t.sf.set_platform_fee_bp(&FEE_BP);
    let paid = t.direct(&[1_000_000]);
    t.sf.start_work(&paid, &t.freelancer);
    t.deliver_and_approve(paid, 0);
    let token = Some(t.token.address.clone());
    let fees_before = t.sf.get_withdrawable_fees(&token);
    assert!(fees_before >= 1_000);

    // Back to 0%: a new job holds no fee, but the platform's fees cover dust.
    t.sf.set_platform_fee_bp(&0);
    let id = t.direct(&[1_000_001]);
    assert_eq!(t.sf.get_escrow(&id).unwrap().platform_fee, 0);
    t.sf.set_yield_opt_in(&id, &true, &t.client);
    t.sf.set_yield_opt_in(&id, &false, &t.client);
    let fees_after = t.sf.get_withdrawable_fees(&token);
    assert!(
        fees_before - fees_after > 0 && fees_before - fees_after <= 5,
        "platform paid the dust: {fees_before} -> {fees_after}"
    );
    t.assert_solvent();

    // The freelancer is paid every stroop, from real cash.
    t.sf.start_work(&id, &t.freelancer);
    let before = t.token.balance(&t.freelancer);
    t.deliver_and_approve(id, 0);
    assert_eq!(t.token.balance(&t.freelancer) - before, 1_000_001);
    t.assert_solvent();

    // Withdrawing fees leaves the rounding reserve behind.
    t.sf.withdraw_fees(&token, &t.fee_collector);
    assert_eq!(t.sf.get_withdrawable_fees(&token), 1_000);
    t.assert_solvent();
}
