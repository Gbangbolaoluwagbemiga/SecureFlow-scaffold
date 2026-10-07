use soroban_sdk::{contracttype, Address, BytesN, String, Vec};

// ─── Time & storage constants ────────────────────────────────────────────────

/// Stellar closes a ledger roughly every five seconds. Deadlines are stored as
/// ledger sequence numbers (the frontend converts them with the same factor),
/// so every duration that arrives in seconds is divided by this exactly once,
/// on the way in.
pub const LEDGER_SECONDS: u32 = 5;
pub const DAY_IN_LEDGERS: u32 = 17_280;

/// Instance storage holds only configuration (owner, fees, token lists,
/// counters). Its TTL also keeps the contract CODE alive, so it is bumped on
/// every escrow write: with a short TTL bumped only by admin calls, a quiet
/// month would archive the whole contract.
pub const INSTANCE_BUMP_AMOUNT: u32 = 120 * DAY_IN_LEDGERS;
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = INSTANCE_BUMP_AMOUNT - 30 * DAY_IN_LEDGERS;

/// Persistent storage holds every per-escrow record. It used to live in
/// instance storage, which the host loads in full on EVERY call: each new
/// escrow made every later transaction more expensive, until the instance
/// entry hit its size limit and the contract stopped working altogether.
pub const PERSISTENT_BUMP_AMOUNT: u32 = 120 * DAY_IN_LEDGERS;
pub const PERSISTENT_LIFETIME_THRESHOLD: u32 = PERSISTENT_BUMP_AMOUNT - 30 * DAY_IN_LEDGERS;

// ─── Business limits ─────────────────────────────────────────────────────────

pub const MAX_PLATFORM_FEE_BP: u32 = 1_000; // 10 %
pub const MAX_MILESTONES: u32 = 20;
pub const MAX_ARBITERS: u32 = 5;
pub const MAX_APPLICATIONS: u32 = 50;
pub const MAX_EVIDENCE_PER_MILESTONE: u32 = 50;
pub const MIN_DURATION_SECONDS: u32 = 3_600; // 1 hour
pub const MAX_DURATION_SECONDS: u32 = 365 * 86_400; // 1 year
pub const MAX_EXTENSION_SECONDS: u32 = 365 * 86_400;
/// How long after the deadline a client must wait before pulling unpaid funds
/// back without anybody's agreement.
pub const EMERGENCY_REFUND_DELAY_LEDGERS: u32 = 30 * DAY_IN_LEDGERS;

/// Milestone index used to key arbiter votes on a whole-escrow overdue ruling,
/// which is not about any one milestone.
pub const OVERDUE_RESOLUTION_INDEX: u32 = u32::MAX;

pub const CONTRACT_VERSION: &str = "2.1.0-didit-verification";

// ─── Errors ──────────────────────────────────────────────────────────────────

// Every way a SecureFlow call can be refused.
//
// Codes are grouped by area and are STABLE: the frontend maps them to
// messages (`src/lib/web3/contract-errors.ts`), so an existing number must
// never be reused for a different meaning. Add new errors at the end of their
// range.
//
// No function in this contract panics on bad input. Each refusal returns one
// of these, so a failed simulation tells the caller exactly what was wrong
// instead of `Error(WasmVm, InvalidAction)`.
//
// (Plain comments, not doc comments: the contract spec caps doc length.)
// (Not `#[contracterror]`: the contract spec allows at most 50 cases per
// error enum, and these errors are deliberately detailed. Each converts to
// `Error(Contract, #code)` at the contract boundary — see the `From` impl.)
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SecureFlowError {
    // ── Admin (1000-1099) ────────────────────────────────────────────────────
    /// `initialize` was called on a contract that already has an owner.
    AlreadyInitialized = 1000,
    /// Platform fee above `MAX_PLATFORM_FEE_BP` (10 %).
    FeeTooHigh = 1001,
    /// Caller is not the contract owner.
    NotOwner = 1002,
    /// The contract has not been initialised yet.
    NotInitialized = 1003,

    // ── Escrow state (1100-1199) ─────────────────────────────────────────────
    /// No escrow exists with this id (or it was deleted).
    EscrowNotFound = 1100,
    /// The escrow is not `InProgress`, which this action requires.
    EscrowNotActive = 1101,
    /// The escrow's status does not allow this action.
    InvalidEscrowStatus = 1102,
    /// The freelancer has already started work.
    WorkAlreadyStarted = 1103,
    /// The freelancer has not started work yet.
    WorkNotStarted = 1104,
    /// The escrow is already under dispute.
    EscrowAlreadyDisputed = 1105,
    /// The escrow has no freelancer assigned.
    NoBeneficiary = 1106,

    // ── Escrow creation (1200-1299) ──────────────────────────────────────────
    /// The owner has paused new job creation.
    JobCreationPaused = 1200,
    /// Duration outside 1 hour .. 365 days.
    InvalidDuration = 1201,
    /// Milestone amount and description lists differ in length.
    MilestoneCountMismatch = 1202,
    /// More than `MAX_MILESTONES` (20) milestones.
    TooManyMilestones = 1203,
    /// More than `MAX_ARBITERS` (5) arbiters.
    TooManyArbiters = 1204,
    /// Required confirmations exceed the number of arbiters named.
    InvalidConfirmations = 1205,
    /// The token is not on the whitelist (or has been blacklisted).
    TokenNotWhitelisted = 1206,
    /// An escrow needs at least one milestone.
    NoMilestones = 1207,
    /// Milestone amounts do not add up to the escrow's total.
    MilestoneSumMismatch = 1208,
    /// Every milestone must be worth more than zero.
    ZeroMilestoneAmount = 1209,
    /// Client and freelancer are the same address. Hiring yourself is how a
    /// reputation gets manufactured: fund, release to yourself, rate five
    /// stars, repeat.
    SelfDealing = 1210,
    /// The same arbiter is named twice on one panel.
    DuplicateArbiter = 1211,

    // ── Marketplace (1300-1399) ──────────────────────────────────────────────
    /// The escrow is not an open job.
    NotOpenJob = 1300,
    /// The job is no longer accepting applications.
    JobClosed = 1301,
    /// A client cannot apply to their own job.
    CannotApplyToOwnJob = 1302,
    /// The job already has `MAX_APPLICATIONS` (50) applications.
    TooManyApplications = 1303,
    /// Only the client (depositor) can do this.
    OnlyDepositor = 1304,
    /// The freelancer being hired never applied (or declined) this job.
    FreelancerNotApplied = 1305,
    /// This freelancer has already applied.
    AlreadyApplied = 1306,
    /// A freelancer is already assigned to this job.
    JobAlreadyAssigned = 1307,

    // ── Milestones (1400-1499) ───────────────────────────────────────────────
    /// Milestone index does not exist on this escrow.
    InvalidMilestone = 1400,
    /// The milestone has already been submitted.
    MilestoneAlreadySubmitted = 1401,
    /// The milestone must be submitted first.
    MilestoneNotSubmitted = 1402,
    /// The milestone is not in a state this action can change.
    MilestoneAlreadyProcessed = 1403,
    /// Only a rejected milestone can be resubmitted.
    MilestoneNotRejected = 1404,
    /// The milestone was already paid or resolved; paying it again would spend
    /// money belonging to the rest of the job.
    MilestoneAlreadySettled = 1405,

    // ── Refunds & deadlines (1500-1599) ──────────────────────────────────────
    /// There is no unpaid balance to return.
    NothingToRefund = 1500,
    /// The deadline has not passed yet.
    DeadlineNotPassed = 1501,
    /// The 30-day emergency window after the deadline has not elapsed.
    EmergencyPeriodNotReached = 1502,
    /// The escrow is already settled, refunded, expired or cancelled.
    CannotRefund = 1503,
    /// Extension must be between 1 second and 365 days.
    InvalidExtension = 1504,
    /// The deadline can only be extended on a `Pending` or `InProgress` escrow.
    CannotExtend = 1505,
    /// An open dispute outranks the clock: waiting out arbitration must not
    /// beat arbitration.
    RefundBlockedByDispute = 1506,
    /// Delivered work is waiting on a review; the deadline passing is not that
    /// review.
    RefundBlockedBySubmittedWork = 1507,

    // ── Authorisation (1600-1699) ────────────────────────────────────────────
    /// Only the assigned freelancer can do this.
    OnlyBeneficiary = 1600,
    /// Caller has no role on this escrow that allows this action.
    Unauthorized = 1601,
    /// Only the client or the job manager they appointed can do this.
    OnlyDepositorOrManager = 1602,
    /// Caller is not an authorised arbiter.
    OnlyArbiter = 1603,
    /// An arbiter cannot rule on (or be hired for) a job they are party to.
    ArbiterIsParty = 1604,
    /// This escrow named its own arbiter panel and the caller is not on it.
    NotOnArbiterPanel = 1605,
    /// Only the fee collector can withdraw fees.
    OnlyFeeCollector = 1606,
    /// Only the client, the freelancer, or the job manager can do this.
    OnlyParticipant = 1607,

    // ── Validation (1700-1799) ───────────────────────────────────────────────
    /// Amount must be greater than zero (or within the allowed range).
    InvalidAmount = 1700,
    /// The address supplied cannot be used here.
    InvalidAddress = 1701,
    /// A parameter is out of range.
    InvalidParameter = 1702,
    /// Not enough surplus balance to withdraw that much.
    InsufficientWithdrawable = 1703,
    /// No overdue dispute has been raised on this escrow.
    NoOverdueRequest = 1704,
    /// No arbiter is able to rule on this escrow.
    NoArbitersAvailable = 1705,
    /// A balance calculation overflowed. Nothing was changed.
    ArithmeticOverflow = 1706,
    /// Freelancer share plus client share must equal the milestone amount.
    ResolutionSplitMismatch = 1707,
    /// A written reason is required for this action.
    ReasonRequired = 1708,
    /// There are no accumulated fees for this token.
    NoFeesToWithdraw = 1709,

    // ── Ratings (1800-1899) ──────────────────────────────────────────────────
    /// Ratings open once the escrow is fully released.
    EscrowNotCompleted = 1800,
    /// The client has already rated this job.
    RatingAlreadySubmitted = 1801,
    /// Rating must be 1 to 5.
    InvalidRating = 1802,
    /// Only the client can rate the freelancer.
    OnlyDepositorCanRate = 1803,
    /// Only the freelancer can rate the client.
    OnlyBeneficiaryCanRate = 1804,
    /// The freelancer has already rated this client.
    ClientRatingAlreadySubmitted = 1805,

    // ── Evidence (1900-1999) ─────────────────────────────────────────────────
    /// Only parties and arbiters may submit evidence.
    NotPartyToEscrow = 1900,
    /// Evidence needs a CID or description.
    EvidenceCidEmpty = 1901,
    /// This milestone already holds the maximum number of evidence entries.
    TooManyEvidenceEntries = 1902,

    // ── Pause (2000-2099) ────────────────────────────────────────────────────
    /// The contract is paused for an emergency.
    ContractIsPaused = 2000,

    // ── Token lists (2100-2199) ──────────────────────────────────────────────
    /// The token is blacklisted.
    TokenIsBlacklisted = 2100,
    /// The token is already blacklisted.
    AlreadyBlacklisted = 2101,
    /// The token is not blacklisted.
    TokenNotBlacklisted = 2102,

    // ── Milestone editing (2200-2299) ────────────────────────────────────────
    /// The milestone is past `NotStarted` and can no longer be edited.
    MilestoneAlreadyStarted = 2200,
    /// Milestone index is out of bounds.
    MilestoneIndexOutOfBounds = 2201,
    /// Milestones and funds can only be edited before work starts.
    CannotModifyStartedEscrow = 2202,
    /// An escrow must keep at least one milestone.
    CannotRemoveLastMilestone = 2203,

    // ── Cancellation & reopening (2300-2399) ─────────────────────────────────
    /// The freelancer has started; the job can no longer be cancelled.
    CannotCancelAssignedJob = 2300,
    /// Every milestone is already delivered or paid; nothing to hand on.
    NothingLeftToFinish = 2301,
    /// Only a declined or arbitrated job can be put back on the board.
    CannotReopenJob = 2302,

    // ── Milestone negotiation (2400-2499) ────────────────────────────────────
    /// There is no pending change proposal on this milestone.
    NoPendingProposal = 2400,
    /// A change proposal is waiting on a milestone; answer it first.
    PendingProposalExists = 2401,

    // ── Escrow admin (2500-2599) ─────────────────────────────────────────────
    /// Unpaid funds are still held; the escrow cannot be deleted.
    FundsStillLocked = 2500,
    /// The escrow is not in a final state.
    EscrowNotTerminal = 2501,

    // ── Job manager / Autopilot (2600-2699) ──────────────────────────────────
    /// A manager can never be the freelancer: it could approve its own work.
    ManagerCannotBeBeneficiary = 2600,
    /// A manager cannot hire itself (or apply) as the freelancer.
    ManagerCannotSelfHire = 2601,
    /// The client manages their own job already; appoint someone else.
    ManagerCannotBeDepositor = 2602,
    /// No job manager is set on this escrow.
    NoManagerSet = 2603,

    // ── Tokens (2700-2799) ───────────────────────────────────────────────────
    /// The token contract refused the transfer (usually: insufficient balance
    /// or missing trustline).
    TokenTransferFailed = 2700,

    // ── Identity verification (2800-2899) ────────────────────────────────────
    /// The owner has not appointed a verifier yet.
    NoVerifierSet = 2800,
    /// Only the appointed verifier can attest or revoke verifications.
    OnlyVerifier = 2801,
    /// This person is already verified on a different wallet. One human, one
    /// verified freelancer account: this is the sybil block.
    DuplicateIdentity = 2802,
    /// This wallet is already verified as a different person.
    WalletBoundToOtherIdentity = 2803,
    /// This wallet has no verification to revoke.
    NotVerified = 2804,
}

impl From<SecureFlowError> for soroban_sdk::Error {
    fn from(e: SecureFlowError) -> Self {
        soroban_sdk::Error::from_contract_error(e as u32)
    }
}

pub type SfResult<T> = core::result::Result<T, SecureFlowError>;

// ─── Enums ───────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq)]
#[contracttype]
pub enum EscrowStatus {
    Pending,
    InProgress,
    Released,
    Refunded,
    Disputed,
    Expired,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[contracttype]
pub enum MilestoneStatus {
    NotStarted,
    Submitted,
    Approved,
    Disputed,
    Resolved,
    Rejected,
    ProposalPending,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[contracttype]
pub enum Badge {
    Beginner,     // 0-4 completed projects
    Intermediate, // 5-14
    Advanced,     // 15-49
    Expert,       // 50+
}

// ─── Records ─────────────────────────────────────────────────────────────────
//
// The field layout of these structs is read by the frontend by name. Adding a
// field is safe for the UI; removing or renaming one is not.

#[derive(Clone, Debug)]
#[contracttype]
pub struct Milestone {
    /// Freelancer's submission text (the client's requirement until the first
    /// submission, or an approved scope change).
    pub description: String,
    /// The client's original requirement. Set once and never overwritten, so
    /// a dispute can always be judged against what was actually asked for.
    pub requirements: String,
    pub amount: i128,
    pub status: MilestoneStatus,
    pub submitted_at: u32,
    pub approved_at: u32,
    pub disputed_at: u32,
    pub disputed_by: Option<Address>,
    pub dispute_reason: Option<String>,
    pub rejection_reason: Option<String>,
    pub resolved_at: u32,
    pub resolved_by: Option<Address>,
    pub resolution_freelancer_amount: i128,
    pub resolution_client_amount: i128,
    pub resolution_reason: Option<String>,
    pub proposed_amount: i128,
    pub proposed_description: Option<String>,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct Application {
    pub freelancer: Address,
    pub cover_letter: String,
    pub proposed_timeline: u32,
    pub applied_at: u32,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct Rating {
    pub escrow_id: u32,
    pub freelancer: Address,
    pub client: Address,
    pub rating: u32,
    pub review: String,
    pub rated_at: u32,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct ClientRatingData {
    pub escrow_id: u32,
    pub client: Address,
    pub freelancer: Address,
    pub rating: u32,
    pub review: String,
    pub rated_at: u32,
}

/// One escrow.
///
/// FEE MODEL. The client deposits `total_amount + platform_fee`. Milestones
/// always sum to `total_amount`, so paying every milestone leaves exactly the
/// fee behind. The fee is HELD, not earned, until the job settles: cancelling,
/// shrinking the job or a refund ruling hands back the matching share of it.
/// Only a completed (or partly completed) job turns it into revenue.
#[derive(Clone, Debug)]
#[contracttype]
pub struct EscrowData {
    pub depositor: Address,
    pub beneficiary: Option<Address>,
    pub arbiters: Vec<Address>,
    pub required_confirmations: u32,
    pub token: Option<Address>, // None = native XLM
    /// Net of fee. Milestones sum to this.
    pub total_amount: i128,
    pub paid_amount: i128,
    /// Fee still held for this escrow (not yet earned or refunded).
    pub platform_fee: i128,
    /// Ledger sequence.
    pub deadline: u32,
    pub status: EscrowStatus,
    pub work_started: bool,
    /// Ledger sequence.
    pub created_at: u32,
    pub milestone_count: u32,
    pub is_open_job: bool,
    pub project_title: String,
    pub project_description: String,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct OverdueRequest {
    pub requester: Address,
    pub reason: String,
    pub requested_at: u32,
}

/// A freelancer's identity verification, attested by the verifier after a
/// Didit check. Holds NO personal data: `identity_hash` is a salted hash of
/// the person's normalised identity, computed off-chain with a secret salt, so
/// it cannot be reversed — it only lets the contract notice the same person
/// verifying a second wallet.
#[derive(Clone, Debug)]
#[contracttype]
pub struct FreelancerVerification {
    pub identity_hash: BytesN<32>,
    /// Ledger timestamp (seconds) of the attestation.
    pub verified_at: u64,
    pub verifier: Address,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct EvidenceEntry {
    pub submitter: Address,
    pub cid: String,
    pub submitted_at: u64,
}

// ─── Storage keys ────────────────────────────────────────────────────────────

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    // ── Instance: configuration & global counters ──
    Owner,
    FeeCollector,
    PlatformFeeBP,
    NextEscrowId,
    JobCreationPaused,
    ContractPaused,
    /// Address of the native XLM Stellar Asset Contract on this network,
    /// derived at initialisation rather than hard-coded, so the same WASM
    /// works on testnet and mainnet.
    NativeToken,
    WhitelistedToken(Address),
    WhitelistedTokens,
    BlacklistedToken(Address),
    BlacklistedTokens,
    AuthorizedArbiter(Address),
    AuthorizedArbiters,
    /// token -> everything still owed to escrows (unpaid principal + held fees).
    EscrowedAmount(Address),
    /// token -> fees earned and not yet withdrawn.
    TotalFeesByToken(Address),

    // ── Persistent: per escrow ──
    Escrow(u32),
    Milestone(u32, u32),
    /// escrow -> applicant addresses, in application order.
    Applicants(u32),
    Application(u32, Address),
    /// A freelancer who was named on the job and declined it. Lets the client
    /// name them again without an application, without counting as an
    /// applicant for the cancellation penalty.
    Declined(u32, Address),
    JobManager(u32),
    /// The job has been through arbitration at least once.
    Arbitrated(u32),
    OverdueRequest(u32),
    Evidence(u32, u32),
    /// Arbiters who have voted in the escrow's current dispute round.
    DisputeVoters(u32),
    /// (escrow, milestone, `freelancer_amount`, `client_amount`) -> voters.
    /// Keyed by the split, so quorum means N arbiters agreeing on one outcome
    /// rather than N arbiters turning up.
    ResolutionVotes(u32, u32, i128, i128),

    // ── Persistent: per user ──
    UserEscrows(Address),
    Reputation(Address),
    CompletedEscrows(Address),
    Rating(u32),
    AverageRating(Address),
    ClientRating(u32),
    AverageClientRating(Address),
    UserCancellations(Address),
    LastCancellationLedger(Address),

    // ── Identity verification (appended for the in-place upgrade) ──
    /// Instance: the address allowed to attest verifications.
    Verifier,
    /// Persistent: wallet -> `FreelancerVerification`.
    Verification(Address),
    /// Persistent: identity hash -> the one wallet it is verified on.
    IdentityBinding(BytesN<32>),
}
