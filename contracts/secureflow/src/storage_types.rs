use soroban_sdk::{contracttype, Address, String, Vec, Error};

// Constants
pub const DAY_IN_LEDGERS: u32 = 17280;
pub const INSTANCE_BUMP_AMOUNT: u32 = 7 * DAY_IN_LEDGERS;
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = INSTANCE_BUMP_AMOUNT - DAY_IN_LEDGERS;

// Error codes for proper error handling
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SecureFlowError {
    // Admin errors (1000-1099)
    AlreadyInitialized = 1000,
    FeeTooHigh = 1001,
    NotOwner = 1002,
    NotInitialized = 1003,
    
    // Escrow errors (1100-1199)
    EscrowNotFound = 1100,
    EscrowNotActive = 1101,
    InvalidEscrowStatus = 1102,
    WorkAlreadyStarted = 1103,
    WorkNotStarted = 1104,
    
    // Escrow creation errors (1200-1299)
    JobCreationPaused = 1200,
    InvalidDuration = 1201,
    MilestoneCountMismatch = 1202,
    TooManyMilestones = 1203,
    TooManyArbiters = 1204,
    InvalidConfirmations = 1205,
    TokenNotWhitelisted = 1206,
    
    // Marketplace errors (1300-1399)
    NotOpenJob = 1300,
    JobClosed = 1301,
    CannotApplyToOwnJob = 1302,
    TooManyApplications = 1303,
    OnlyDepositor = 1304,
    FreelancerNotApplied = 1305,
    AlreadyApplied = 1306,
    
    // Milestone errors (1400-1499)
    InvalidMilestone = 1400,
    MilestoneAlreadySubmitted = 1401,
    MilestoneNotSubmitted = 1402,
    MilestoneAlreadyProcessed = 1403,
    
    // Refund errors (1500-1599)
    NothingToRefund = 1500,
    DeadlineNotPassed = 1501,
    EmergencyPeriodNotReached = 1502,
    CannotRefund = 1503,
    InvalidExtension = 1504,
    CannotExtend = 1505,
    
    // Authorization errors (1600-1699)
    OnlyBeneficiary = 1600,
    Unauthorized = 1601,
    
    // Validation errors (1700-1799)
    InvalidAmount = 1700,
    InvalidAddress = 1701,
    InvalidParameter = 1702,
    InsufficientWithdrawable = 1703,
    NoOverdueRequest = 1704,
    NoArbitersAvailable = 1705,
    
    // Rating errors (1800-1899)
    EscrowNotCompleted = 1800,
    RatingAlreadySubmitted = 1801,
    InvalidRating = 1802,
    OnlyDepositorCanRate = 1803,
    OnlyBeneficiaryCanRate = 1804,
    ClientRatingAlreadySubmitted = 1805,

    // Evidence errors (1900-1999)
    NotPartyToEscrow = 1900,
    EvidenceCidEmpty = 1901,

    // Pause errors (2000-2099)
    ContractIsPaused = 2000,

    // Blacklist errors (2100-2199)
    TokenIsBlacklisted = 2100,
    AlreadyBlacklisted = 2101,

    // Milestone management errors (2200-2299)
    MilestoneAlreadyStarted = 2200,
    MilestoneIndexOutOfBounds = 2201,
    CannotModifyStartedEscrow = 2202,

    // Job cancellation errors (2300-2399)
    CannotCancelAssignedJob = 2300,

    // Milestone negotiation errors (2400-2499)
    NoPendingProposal = 2400,

    // Escrow admin errors (2500-2599)
    FundsStillLocked = 2500,
    EscrowNotTerminal = 2501,
}

impl From<SecureFlowError> for Error {
    fn from(e: SecureFlowError) -> Self {
        Error::from_contract_error(e as u32)
    }
}

// Enum for Escrow Status
#[derive(Clone, Debug, PartialEq, Eq)]
#[contracttype]
pub enum EscrowStatus {
    Pending,
    InProgress,
    Released,
    Refunded,
    Disputed,
    Expired,
    Cancelled, // open job cancelled by depositor before freelancer assigned
}

// Enum for Milestone Status
#[derive(Clone, Debug, PartialEq, Eq)]
#[contracttype]
pub enum MilestoneStatus {
    NotStarted,
    Submitted,
    Approved,
    Disputed,
    Resolved,
    Rejected,
    ProposalPending, // freelancer proposed milestone change; awaiting client response
}

// Milestone struct
#[derive(Clone, Debug)]
#[contracttype]
pub struct Milestone {
    pub description: String,    // freelancer submission response (or original before any submission)
    pub requirements: String,   // original client requirements — set at creation, never overwritten
    pub amount: i128,
    pub status: MilestoneStatus,
    pub submitted_at: u32,
    pub approved_at: u32,
    pub disputed_at: u32,
    pub disputed_by: Option<Address>,
    pub dispute_reason: Option<String>,
    pub rejection_reason: Option<String>,
    // Dispute resolution fields
    pub resolved_at: u32,
    pub resolved_by: Option<Address>,
    pub resolution_freelancer_amount: i128,
    pub resolution_client_amount: i128,
    pub resolution_reason: Option<String>,
    // Milestone negotiation fields
    pub proposed_amount: i128,
    pub proposed_description: Option<String>,
}

// Application struct
#[derive(Clone, Debug)]
#[contracttype]
pub struct Application {
    pub freelancer: Address,
    pub cover_letter: String,
    pub proposed_timeline: u32,
    pub applied_at: u32,
}

// Rating struct
#[derive(Clone, Debug)]
#[contracttype]
pub struct Rating {
    pub escrow_id: u32,
    pub freelancer: Address,
    pub client: Address,
    pub rating: u32, // 1-5 stars
    pub review: String,
    pub rated_at: u32,
}

// Client rating struct (freelancer rates client)
#[derive(Clone, Debug)]
#[contracttype]
pub struct ClientRatingData {
    pub escrow_id: u32,
    pub client: Address,
    pub freelancer: Address,
    pub rating: u32, // 1-5 stars
    pub review: String,
    pub rated_at: u32,
}

// Badge enum
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[contracttype]
pub enum Badge {
    Beginner,      // 0-4 completed projects
    Intermediate,  // 5-14 completed projects
    Advanced,      // 15-49 completed projects
    Expert,        // 50+ completed projects
}

// EscrowData struct
#[derive(Clone, Debug)]
#[contracttype]
pub struct EscrowData {
    pub depositor: Address,
    pub beneficiary: Option<Address>,
    pub arbiters: Vec<Address>,
    pub required_confirmations: u32,
    pub token: Option<Address>, // None for native XLM
    pub total_amount: i128,
    pub paid_amount: i128,
    pub platform_fee: i128,
    pub deadline: u32,
    pub status: EscrowStatus,
    pub work_started: bool,
    pub created_at: u32,
    pub milestone_count: u32,
    pub is_open_job: bool,
    pub project_title: String,
    pub project_description: String,
}

/// Stored when either party raises an overdue dispute, awaiting arbiter resolution.
#[derive(Clone, Debug)]
#[contracttype]
pub struct OverdueRequest {
    pub requester: Address,
    pub reason: String,
    pub requested_at: u32,
}

/// A single piece of evidence submitted by a party during a dispute.
#[derive(Clone, Debug)]
#[contracttype]
pub struct EvidenceEntry {
    pub submitter: Address,
    pub cid: String,         // IPFS CID (or description if no IPFS)
    pub submitted_at: u64,   // ledger timestamp
}

// Storage keys enum
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Escrow(u32),                    // escrow_id -> EscrowData
    Milestone(u32, u32),            // (escrow_id, milestone_index) -> Milestone
    Application(u32, u32),          // (escrow_id, application_index) -> Application
    UserEscrows(Address),           // user -> Vec<u32>
    AuthorizedArbiter(Address),    // arbiter -> bool
    AuthorizedArbiters,            // -> Vec<Address>
    WhitelistedToken(Address),      // token -> bool
    WhitelistedTokens,             // -> Vec<Address>
    EscrowedAmount(Address),        // token -> i128
    TotalFeesByToken(Address),      // token -> i128
    Reputation(Address),            // user -> u32
    CompletedEscrows(Address),      // user -> u32
    Rating(u32),                    // escrow_id -> Rating (client rates freelancer)
    FreelancerRating(Address),      // freelancer -> Vec<u32> (escrow_ids with ratings)
    AverageRating(Address),         // freelancer -> (total_rating, count)
    ClientRating(u32),              // escrow_id -> ClientRatingData (freelancer rates client)
    AverageClientRating(Address),   // client -> (total_rating, count)
    NextEscrowId,                   // -> u32
    PlatformFeeBP,                  // -> u32
    FeeCollector,                   // -> Address
    Owner,                          // -> Address
    JobCreationPaused,              // -> bool
    ContractPaused,                 // -> bool  (full emergency pause)
    OverdueRequest(u32),            // escrow_id -> OverdueRequest
    Evidence(u32, u32),             // (escrow_id, milestone_index) -> Vec<EvidenceEntry>
    BlacklistedToken(Address),      // token -> bool
    BlacklistedTokens,              // -> Vec<Address>
    // Dispute resolution voting
    DisputeVote(u32, Address),      // (escrow_id, arbiter) -> bool  (has voted?)
    DisputeVoteCount(u32),          // escrow_id -> u32  (total votes cast)
    // Job cancellation anti-abuse
    UserCancellations(Address),     // user -> u32  (lifetime cancellation count)
    LastCancellationLedger(Address), // user -> u32  (ledger of last cancellation)
}

