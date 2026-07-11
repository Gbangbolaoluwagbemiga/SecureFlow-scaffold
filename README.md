# SecureFlow

<div align="center">

**A decentralized freelancer marketplace built on Stellar (Soroban) that provides secure, trustless escrow services for freelance work agreements.**

[![Stellar](https://img.shields.io/badge/Stellar-Soroban-7D00FF?style=flat-square&logo=stellar)](https://stellar.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Rust](https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)

</div>

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Smart Contract Details](#smart-contract-details)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Usage Guide](#usage-guide)
- [Deployment](#deployment)
- [Security](#security)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

SecureFlow is a blockchain-powered freelancer marketplace that enables clients and freelancers to collaborate without requiring trust between parties. Built on the Stellar network using Soroban smart contracts, SecureFlow ensures secure milestone-based payments, transparent dispute resolution, and on-chain reputation — all enforced by code, not intermediaries.

### Why SecureFlow?

- **Trustless Escrow** — Funds are locked in smart contracts until work is verified and approved
- **Fast & Low-Cost** — Leverages Stellar's 3–5 second finality and near-zero fees
- **Global Access** — Works with native XLM and any whitelisted token
- **Fair Disputes** — Per-milestone multi-sig arbiter voting with configurable quorum
- **On-Chain Reputation** — Build trust through verifiable, tamper-proof reputation scores
- **Gasless Applications** — Freelancers can apply to jobs without holding XLM for fees

---

## Features

### Core Escrow

| Feature                  | Description                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| Smart contract escrow    | Funds locked until milestones approved                                                                    |
| Milestone-based payments | Each milestone paid independently upon approval                                                           |
| Open job marketplace     | Anyone can apply; client selects the best candidate                                                       |
| Direct contracts         | Create with a known freelancer — no application needed                                                    |
| Tiered cancellation      | Cancel an unstarted job with a tiered penalty (0–30%) based on cancellation history and application count |
| Dynamic fund management  | Add or withdraw funds from specific milestones before work starts                                         |
| Deadline extension       | Depositor can extend the project deadline                                                                 |
| Emergency refund         | Automatic refund path after deadline expiration                                                           |

### Milestone System

| Feature                 | Description                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- |
| Add / remove milestones | Depositor can add or remove milestones before work starts                    |
| Milestone submission    | Freelancer submits work with an updated description                          |
| Resubmission            | Freelancer can resubmit a rejected milestone                                 |
| Approve / reject        | Client approves (pays out) or rejects (with reason) each milestone           |
| Dispute milestone       | Either party can dispute; routes to arbiters                                 |
| Milestone negotiation   | Freelancer proposes an amount/description change; client approves or rejects |
| On-chain evidence       | Either party can attach IPFS CIDs as evidence before an arbiter rules        |

### Dispute Resolution

| Feature                 | Description                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------ |
| Per-milestone multi-sig | Arbiters cast votes per disputed milestone                                           |
| Configurable quorum     | `required_confirmations` set at escrow creation                                      |
| Split payouts           | Arbiter specifies exact freelancer and client amounts (must sum to milestone amount) |
| Vote tracking           | `get_dispute_vote_count` and `has_dispute_voted` prevent double-voting               |
| Overdue disputes        | Either party can raise a dispute after the deadline                                  |
| Arbiter award / refund  | Arbiters can award the freelancer a partial amount or approve a full client refund   |

### Reputation & Ratings

| Feature                    | Description                                                             |
| -------------------------- | ----------------------------------------------------------------------- |
| On-chain reputation        | Score increases with approved milestones                                |
| Client → freelancer rating | 1–5 stars + written review after project completion                     |
| Freelancer → client rating | Freelancers can rate clients too                                        |
| Average ratings            | Per-address average rating and count                                    |
| Badge tiers                | Beginner → Intermediate → Advanced → Expert based on completed projects |

### Platform Administration

| Feature              | Description                                                 |
| -------------------- | ----------------------------------------------------------- |
| Emergency pause      | Owner can pause all write operations instantly              |
| Job creation pause   | Pause new job creation without affecting active escrows     |
| Token whitelisting   | Only approved tokens accepted                               |
| Token blacklisting   | Ban a previously whitelisted token                          |
| Arbiter management   | Authorize or revoke arbiters                                |
| Platform fee control | Configurable fee in basis points (max 10%)                  |
| Fee withdrawal       | Fee collector withdraws accumulated fees per token          |
| Delete escrow        | Owner can delete terminal escrows with zero remaining funds |
| Stuck fund recovery  | Owner withdraws excess balance above all escrowed amounts   |

### Developer Features

| Feature                  | Description                                                         |
| ------------------------ | ------------------------------------------------------------------- |
| Gasless job applications | Backend fee-bump wraps user's signed XDR — applicants need zero XLM |
| Paginated applications   | `get_applications_page(offset, limit)` for scalable UIs             |
| Application count        | `get_application_count` for pagination headers                      |
| User escrow index        | Per-address list of escrow IDs for fast dashboards                  |
| WASM size                | 59 KB (well under the 64 KB Soroban limit)                          |

---

## How It Works

```
Create Job → Apply / Accept → Start Work → Submit Milestones → Approve / Dispute → Payment
```

### 1. Job Creation

The client deposits funds into the escrow contract and defines:

- Project title, description, and deadline
- Milestones (amount + description per milestone); amounts must sum to `total_amount - platform_fee`
- Payment token (native XLM or whitelisted token)
- Optional: a specific beneficiary (direct contract) or leave open for applications
- Arbiters list and required confirmation count for dispute resolution

Funds are transferred from the client to the contract at creation time.

### 2. Application & Selection (open jobs)

Freelancers browse open jobs, submit a cover letter and proposed timeline. Applications are stored on-chain. The client reviews and calls `accept_freelancer`. Gasless application support means applicants do not need XLM for fees.

### 3. Work Start

The assigned freelancer calls `start_work`. The escrow status moves from `Pending` → `InProgress` and the fee portion is earmarked at this point.

### 4. Milestone Submission

For each milestone the freelancer submits via `submit_milestone` (or `resubmit_milestone` after rejection). The milestone status becomes `Submitted`.

### 5. Review (Approve / Reject / Dispute)

**Approve** → payment released immediately to freelancer, milestone marked `Approved`.

**Reject** → milestone reverts to allow resubmission; rejection reason stored on-chain.

**Dispute** → milestone marked `Disputed`. Either party can attach IPFS evidence via `submit_evidence`. Authorized arbiters then call `resolve_dispute`.

### 6. Dispute Resolution (per milestone)

Each arbiter calls `resolve_dispute(escrow_id, milestone_index, arbiter, freelancer_amount, client_amount, reason)`. Votes are tracked idempotently. When the vote count reaches `required_confirmations`, the contract:

1. Transfers `freelancer_amount` to the beneficiary
2. Transfers `client_amount` to the depositor
3. Marks the milestone `Resolved`
4. Resets the vote count to 0
5. Updates escrow status to `Released` or `InProgress` based on remaining balance

### 7. Cancellation

A depositor can cancel an unstarted (no freelancer assigned) job. The penalty scales with repeat cancellations and the number of applicants who invested time:

| Cancellations | Base penalty |
| ------------- | ------------ |
| 0 – 2         | 0%           |
| 3 – 5         | 5%           |
| 6 – 10        | 10%          |
| 11+           | 15%          |

An additional 0–15% may apply based on application count. Total penalty is capped at 30% and the penalty decays over ~30 days (518,400 ledgers) of inactivity.

### 8. Milestone Negotiation

If scope or budget changes after work starts, the freelancer can call `propose_milestone_change` with a new amount and description. The client then calls `approve_milestone_proposal` (applies the change) or `reject_milestone_proposal` (reverts).

---

## Architecture

### Smart Contract Modules

```
contracts/secureflow/src/
├── lib.rs                  Public contract interface — all entrypoints
├── storage_types.rs        Enums, structs, DataKey variants, error codes
├── escrow_core.rs          Storage helpers, token transfers, whitelist checks
├── escrow_management.rs    create_escrow, add/remove milestones, cancel, fund mgmt
├── work_lifecycle.rs       start_work, submit/approve/reject/dispute milestone,
│                           milestone negotiation, per-milestone resolve_dispute
├── refund_system.rs        refund_escrow, emergency refund, deadline extension,
│                           overdue disputes, arbiter award/refund
├── marketplace.rs          apply_to_job, accept_freelancer, paginated apps
├── ratings.rs              submit_rating, get_average_rating, badges, client ratings
├── evidence.rs             submit_evidence, get_evidence
└── admin.rs                owner controls, pause, blacklist, fee withdrawal, delete_escrow
```

### Escrow Lifecycle

```
Pending → InProgress → Released
                    ↘ Refunded
                    ↘ Disputed
                    ↘ Expired
                    ↘ Cancelled
```

### Milestone Lifecycle

```
NotStarted → Submitted → Approved
           ↘ Rejected  (freelancer resubmits)
           ↘ Disputed  → Resolved
ProposalPending (negotiation in progress)
```

### Frontend Architecture

```
React 19 + TypeScript
    └── Web3Context           wallet connection, high-level contract calls
         └── ContractService  simulate-readonly / sendOwnerTransaction helpers
              └── Stellar SDK  Transaction building, auth entry signing, RPC
                   └── Soroban RPC  Testnet / mainnet
```

---

## Smart Contract Details

### Deployed Contract (Testnet)

| Key                   | Value                                                              |
| --------------------- | ------------------------------------------------------------------ |
| Contract ID           | `CBWMVACS6BVU55SQOSU2YLE6PL4J6COXJAWZZLTVFRE4E7UYOW4DX5KQ`         |
| WASM hash             | `972dcf84f8a673d0063202ebc725cf16f1147ba9ff2c83de6541d1e1b4defb98` |
| Network               | Test SDF Network ; September 2015                                  |
| Platform fee          | 250 bp (2.5%)                                                      |
| Owner / fee-collector | `GBL5ZXODI2UVOTTLNJGCJ2N52MO4XEUQB6TMXOEZIAVPGLBPWOJ6HDEE`         |

> **Note:** Stellar testnet resets periodically wipe all contracts. After a reset, rebuild the WASM (`stellar contract build`), upload it, deploy, and call `initialize` once. Update `VITE_SECUREFLOW_CONTRACT_ID` in `.env` to the new contract ID.

### Fee Model

SecureFlow uses an **embedded fee** model. The `total_amount` deposited at creation already includes the platform fee:

```
platform_fee = total_amount × platform_fee_bp / 10_000
net_to_milestones = total_amount - platform_fee
sum(milestone.amounts) == net_to_milestones
```

The fee is earmarked (not transferred) at `start_work` and collected by the fee collector via `withdraw_fees`.

### Key Contract Functions

```rust
// Lifecycle
create_escrow(depositor, beneficiary?, arbiters, required_confirmations,
              milestones: Vec<(i128, String)>, token?, total_amount, duration,
              project_title, project_description) → u32  // returns escrow_id

start_work(escrow_id, beneficiary)
submit_milestone(escrow_id, milestone_index, description, beneficiary)
resubmit_milestone(escrow_id, milestone_index, description, beneficiary)
approve_milestone(escrow_id, milestone_index, depositor)
reject_milestone(escrow_id, milestone_index, reason, depositor)
dispute_milestone(escrow_id, milestone_index, reason, disputer)

// Cancellation & funds
cancel_job(escrow_id, depositor)
add_job_funds(escrow_id, depositor, additional_amount, milestone_index)
withdraw_job_funds(escrow_id, depositor, withdraw_amount, milestone_index)

// Milestone negotiation
propose_milestone_change(escrow_id, milestone_index, proposed_amount, proposed_description, freelancer)
approve_milestone_proposal(escrow_id, milestone_index, depositor)
reject_milestone_proposal(escrow_id, milestone_index, depositor)

// Dispute resolution
resolve_dispute(escrow_id, milestone_index, arbiter, freelancer_amount, client_amount, reason)
submit_evidence(escrow_id, milestone_index, submitter, cid)

// Marketplace
apply_to_job(escrow_id, cover_letter, proposed_timeline, freelancer)
accept_freelancer(escrow_id, freelancer, depositor)
get_applications_page(escrow_id, offset, limit)
get_application_count(escrow_id)

// Refunds
refund_escrow(escrow_id, depositor)
emergency_refund_after_deadline(escrow_id, depositor)
extend_deadline(escrow_id, extra_seconds, depositor)
raise_overdue_dispute(escrow_id, requester, reason)
arbiter_approve_refund(escrow_id, arbiter)
arbiter_award_freelancer(escrow_id, arbiter, freelancer_amount)

// Ratings
submit_rating(escrow_id, rating, review, client)
submit_client_rating(escrow_id, rating, review, freelancer)
get_average_rating(freelancer) → (total, count)
get_badge(freelancer) → Badge
get_average_client_rating(client) → (total, count)

// Admin
initialize(owner, fee_collector, platform_fee_bp, default_whitelisted_tokens)
pause_contract() / unpause_contract()
pause_job_creation() / unpause_job_creation()
blacklist_token(token) / unblacklist_token(token)
whitelist_token(token)
authorize_arbiter(arbiter) / remove_arbiter(arbiter)
set_platform_fee_bp(fee_bp)
set_fee_collector(fee_collector)
set_owner(new_owner)
get_withdrawable_fees(token?) → i128
withdraw_fees(token?, caller)
withdraw_stuck_funds(token, to, amount)
delete_escrow(escrow_id)
```

### Error Codes

| Code | Name                             | Meaning                                                |
| ---- | -------------------------------- | ------------------------------------------------------ |
| 1    | `AlreadyInitialized`             | `initialize` called twice                              |
| 100  | `EscrowNotFound`                 | Invalid escrow ID                                      |
| 200  | `Unauthorized`                   | Caller not authorized                                  |
| 300  | `InvalidAmount`                  | Amount ≤ 0 or exceeds bounds                           |
| 400  | `InvalidStatus`                  | Operation not valid for current status                 |
| 500  | `MilestoneNotFound`              | Invalid milestone index                                |
| 600  | `TokenNotWhitelisted`            | Token not allowed                                      |
| 700  | `InsufficientFunds`              | Contract balance too low                               |
| 800  | `FeeTooHigh`                     | Fee exceeds 10%                                        |
| 900  | `AlreadyApplied`                 | Freelancer already applied                             |
| 1000 | `NotApplied`                     | Freelancer hasn't applied                              |
| 1100 | `FreelancerAlreadyAssigned`      | Cannot reassign once started                           |
| 1200 | `DeadlineNotPassed`              | Too early for emergency refund                         |
| 1300 | `ContractIsPaused`               | Emergency pause active                                 |
| 1400 | `AlreadyBlacklisted`             | Token already blacklisted                              |
| 1500 | `NothingToRefund`                | Fee balance is zero                                    |
| 1600 | `InsufficientWithdrawable`       | Stuck-fund withdrawal exceeds excess                   |
| 1700 | `NotInitialized`                 | Contract not yet initialized                           |
| 1800 | `AlreadyVoted`                   | Arbiter already voted on this dispute                  |
| 1900 | `InvalidVoteSplit`               | `freelancer_amount + client_amount ≠ milestone.amount` |
| 2000 | `NoPendingProposal` (prev. 2400) | No proposal pending to approve/reject                  |
| 2100 | `FundsStillLocked`               | Escrow has remaining balance, cannot delete            |
| 2200 | `EscrowNotTerminal`              | Escrow not in a terminal state                         |
| 2300 | `CannotCancelAssignedJob`        | Freelancer already assigned                            |

---

## Tech Stack

### Smart Contracts

- **Language:** Rust (no_std)
- **SDK:** soroban-sdk 23.0.2
- **Target:** wasm32v1-none
- **Toolchain:** rust-toolchain.toml (stable channel pinned)

### Frontend

- **Framework:** React 19
- **Language:** TypeScript
- **Build:** Vite
- **UI:** Radix UI + Tailwind CSS
- **State:** Zustand
- **Routing:** React Router
- **Forms:** React Hook Form + Zod

### Blockchain Integration

- **SDK:** @stellar/stellar-sdk
- **Wallets:** @creit.tech/stellar-wallets-kit (Freighter, xBull, Lobstr, etc.)
- **Generated clients:** `src/contracts/generated/` (auto-generated from contract ABI)

### Backend (Gasless API)

- **Runtime:** Cloudflare Workers (Hono framework)
- **Purpose:** Wraps user-signed XDRs in Stellar fee-bump transactions so applicants pay zero gas

---

## Getting Started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) stable toolchain
- `wasm32v1-none` target: `rustup target add wasm32v1-none`
- [Node.js](https://nodejs.org/) v22+
- [Stellar CLI](https://github.com/stellar/stellar-cli) v25+
- [Scaffold Stellar](https://github.com/AhaLabs/scaffold-stellar) plugin

### Installation

```bash
git clone https://github.com/yourusername/secureflow.git
cd secureflow
npm install
```

### Environment Setup

```bash
cp .env.example .env
```

Edit `.env`:

```env
VITE_STELLAR_NETWORK=testnet
VITE_SECUREFLOW_CONTRACT_ID=CBWMVACS6BVU55SQOSU2YLE6PL4J6COXJAWZZLTVFRE4E7UYOW4DX5KQ

# API backend (local dev: http://localhost:8787)
VITE_API_URL=http://localhost:8787
# Shared secret — must match API_SECRET in backend/.env
VITE_API_SECRET=<your_shared_secret>

# Optional: USDC token contract address for the token dropdown
VITE_USDC_TOKEN_CONTRACT=
```

### Build & Run

```bash
# Start frontend dev server
npm run dev
# → http://localhost:5173

# Build for production
npm run build

# Run contract tests
cargo test --manifest-path contracts/secureflow/Cargo.toml
```

### Regenerate Contract Clients

After any contract change and re-deploy, regenerate the TypeScript bindings:

```bash
stellar scaffold build --build-clients
```

---

## Deployment

### Build WASM

```bash
stellar contract build
# Output: target/wasm32v1-none/release/secureflow.wasm  (~59 KB)
```

### Upload & Deploy (testnet)

```bash
# Upload WASM
stellar contract upload \
  --wasm target/wasm32v1-none/release/secureflow.wasm \
  --source me \
  --network testnet

# Deploy contract
stellar contract deploy \
  --wasm-hash <WASM_HASH> \
  --source me \
  --network testnet

# Initialize (replace CONTRACT_ID with output of deploy)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source me \
  --network testnet \
  -- initialize \
  --owner me \
  --fee-collector me \
  --platform-fee-bp 250
```

Update `VITE_SECUREFLOW_CONTRACT_ID` in `.env` and `environments.toml` with the new contract ID.

---

## Security

### What is secure

- **No secrets in git** — `.env` and `backend/.env` are gitignored. Verified via `git ls-files`.
- **Stellar identity** (`me.toml`) — stored at `~/.config/stellar/identity/`, outside the repo, matched by `.gitignore: **/identity/*.toml`.
- **On-chain auth** — all write operations call `address.require_auth()`. No off-chain bypass possible.
- **Pause guard** — `require_not_paused` wraps every state-changing entrypoint. Owner can halt everything instantly.
- **Fee protection** — fee is earmarked at `start_work`, not at creation, preventing early withdrawal griefing.
- **Re-dispute fix** — `DisputeVoteCount` is reset to 0 after each resolution, preventing stale vote counts from triggering a second execution.

### What to know

| Risk                                     | Status                                | Mitigation                                                                                                    |
| ---------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ADMIN_SECRET_KEY` in `backend/.env`     | Not in git                            | This key controls the gasless fee-bump wallet AND owns the contract. Rotate immediately if compromised.       |
| `VITE_API_SECRET` bundled in frontend JS | By design                             | Provides light authorization for the gasless API. Not a blockchain private key. Rotate via backend re-deploy. |
| `VITE_SECRET_KEY` in `.env`              | Not in git, not used in frontend code | Stale variable — safe to remove.                                                                              |
| Soroban testnet resets                   | Periodic                              | Redeploy WASM, call `initialize`, update `.env` and `environments.toml`.                                      |
| Contract instance TTL                    | Managed                               | All writes call `extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT)`.                              |

---

## Usage Guide

### For Clients

1. **Create a Job** — set title, description, deadline, milestones, and deposit funds.
2. **Review Applications** — freelancers apply; you see cover letters, timelines, badges, and ratings.
3. **Accept a Freelancer** — call `accept_freelancer`; contract is now `Pending` awaiting `start_work`.
4. **Review Milestones** — approve (payment released), reject (request revisions), or dispute (arbiter vote).
5. **Negotiate** — accept or reject a freelancer's milestone change proposal.

### For Freelancers

1. **Browse Jobs** — filter open jobs by budget, token, deadline.
2. **Apply** — cover letter + proposed timeline (gasless — no XLM required).
3. **Start Work** — call `start_work` once selected.
4. **Submit Milestones** — submit each milestone with a description when done.
5. **Dispute** — if a rejection is unfair, dispute and attach IPFS evidence.
6. **Propose Changes** — if scope changes, propose a milestone renegotiation.

### For Arbiters

1. **Authorized by owner** — must be added via `authorize_arbiter`.
2. **Review disputes** — examine on-chain evidence (IPFS CIDs).
3. **Vote** — call `resolve_dispute` with a precise `freelancer_amount` + `client_amount` split.
4. **Quorum executes** — when `required_confirmations` votes are reached, payout executes automatically.

### For Platform Admins

1. **Admin Panel** — requires owner wallet address.
2. **Pause** — `pause_contract` halts all write ops; `pause_job_creation` halts only new jobs.
3. **Fees** — set `platform_fee_bp`, update `fee_collector`, call `withdraw_fees` per token.
4. **Tokens** — whitelist or blacklist tokens; blacklisted tokens block new escrow creation.
5. **Arbiters** — authorize or revoke arbiter wallets.
6. **Cleanup** — call `delete_escrow` on terminal, zero-balance escrows to reclaim storage.

---

## Project Structure

```
secureflow/
├── contracts/
│   └── secureflow/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs                 Contract entrypoints
│           ├── storage_types.rs       Enums, structs, DataKey, error codes
│           ├── escrow_core.rs         Storage helpers, token transfers
│           ├── escrow_management.rs   create_escrow, cancel_job, fund management
│           ├── work_lifecycle.rs      Milestone workflow, negotiation, resolve_dispute
│           ├── refund_system.rs       Refunds, deadline, overdue disputes
│           ├── marketplace.rs         Applications, accept freelancer
│           ├── ratings.rs             Ratings, badges, reputation
│           ├── evidence.rs            IPFS evidence storage
│           └── admin.rs               Pause, blacklist, fee withdrawal, delete_escrow
├── src/
│   ├── components/
│   │   ├── admin/                     Admin panel components
│   │   ├── approvals/                 Milestone approval UI
│   │   ├── create/                    Job creation wizard
│   │   ├── dashboard/                 Stats, escrow cards
│   │   ├── freelancer/                Freelancer dashboard
│   │   ├── jobs/                      Job marketplace
│   │   ├── notification-center.tsx    On-chain event notifications
│   │   └── ui/                        Radix UI wrappers
│   ├── contexts/
│   │   ├── web3-context.tsx           Wallet + contract call context
│   │   └── notification-context.tsx  Notification state
│   ├── contracts/
│   │   └── generated/                 Auto-generated TS contract clients
│   ├── lib/
│   │   ├── web3/
│   │   │   ├── contract-service.ts    Full contract method bindings
│   │   │   ├── stellar-config.ts      Network config, contract IDs
│   │   │   └── wallet-signer.ts       Transaction signing helpers
│   │   └── api.ts                     Backend API client (gasless)
│   ├── pages/
│   │   ├── AdminPage.tsx
│   │   ├── ApprovalsPage.tsx
│   │   ├── CreatePage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── FreelancerPage.tsx
│   │   ├── JobsPage.tsx
│   │   └── HomePage.tsx
│   └── store/
│       └── wallet.store.ts            Zustand wallet state
├── backend/                           Gasless API (Cloudflare Workers)
│   ├── src/
│   └── .env.example
├── environments.toml                  Stellar scaffold env config
├── Cargo.toml                         Workspace manifest
├── package.json
└── README.md
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes with tests
4. Run `cargo test` and `node node_modules/typescript/bin/tsc --noEmit`
5. Commit and open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---

## License

MIT — see [LICENSE](LICENSE).

---

## Acknowledgments

- Built with [Scaffold Stellar](https://github.com/AhaLabs/scaffold-stellar)
- Powered by [Stellar](https://stellar.org) and [Soroban](https://soroban.stellar.org)
- UI components from [Radix UI](https://www.radix-ui.com/)

---

<div align="center">

Built on Stellar · [Soroban Docs](https://developers.stellar.org/docs/smart-contracts) · [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet/contract/CBWMVACS6BVU55SQOSU2YLE6PL4J6COXJAWZZLTVFRE4E7UYOW4DX5KQ)

</div>
