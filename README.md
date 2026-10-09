<div align="center">

<img src="public/secureflow-mark.svg" alt="SecureFlow" height="72" />

# SecureFlow

**Milestone escrow for freelance work on Stellar, with an AI job manager and verified freelancers.**

Clients lock the budget in a Soroban contract before work starts. Freelancers are paid per milestone the moment it's approved. Disputes go to arbiters who split the money on-chain. A client can hand the whole job to **Autopilot**, which hires, reviews and escalates for them.

[![Build and Test](https://github.com/Gbangbolaoluwagbemiga/SecureFlow-scaffold/actions/workflows/node.yml/badge.svg)](https://github.com/Gbangbolaoluwagbemiga/SecureFlow-scaffold/actions/workflows/node.yml)
[![Stellar Soroban](https://img.shields.io/badge/Stellar-Soroban-7D00FF?style=flat-square&logo=stellar)](https://developers.stellar.org/docs/build/smart-contracts/overview)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)](LICENSE)

**[Live app (testnet)](https://secureflow-stellar.vercel.app/)** · **[Contract on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CAJAUKTFKRYZCIFCQOGNZJMCJITC574Z5DUFRINMXXR7VIYKRBEFPS7H)**

🏆 Winner, Scaffold Stellar Hackathon 2025

</div>

---

## Contents

- [What it does](#what-it-does)
- [Autopilot: the AI job manager](#autopilot-the-ai-job-manager)
- [Verified freelancers](#verified-freelancers)
- [Architecture](#architecture)
- [Deployed contract](#deployed-contract)
- [Run it locally](#run-it-locally)
- [Configuration](#configuration)
- [Deploying to production](#deploying-to-production)
- [Contract reference](#contract-reference)
- [Backend API](#backend-api)
- [Testing](#testing)
- [Security model](#security-model)
- [Project structure](#project-structure)
- [Contributing](#contributing)

---

## What it does

### For clients

- **Post a job, funded up front.** The budget and up to 20 milestones are locked in the contract when the job is posted. A platform fee (currently 1%, capped at 10% by the contract) is charged on top and held until the job settles.
- **Hire from applicants, or name a freelancer directly.** Applicants show their cover letter, timeline, rating, badge and a **Verified** tag if they've confirmed their identity.
- **Approve, reject with a reason, or dispute** each milestone. Approving pays the freelancer immediately.
- **Change your mind before work starts:** add or withdraw funds per milestone, edit milestones, or cancel. Cancelling refunds the budget and the whole held fee, minus a small penalty only if people applied (5% for 1–5 applicants, 10% for 6–10, 15% above), which compensates for their wasted time.
- **Hand the job to Autopilot** and let it run hiring and reviews (see below).

### For freelancers

- **Browse open jobs and apply without holding XLM.** Applications are fee-bumped by the platform.
- **Track every application** and what became of it, in a dedicated tab, with live updates.
- **Get notified** when you're hired, when a job you applied to is filled or cancelled, and on every milestone decision.
- **Submit and resubmit work** with attachments; rejected work comes back with the reason.
- **Propose a scope change** to a milestone; the client accepts or rejects it.
- **Decline an assignment** before starting, so the client can reopen the job.
- **Verify your identity** once with Didit to earn the Verified tag and an edge with Autopilot.

### Disputes and safety nets

- **Arbiter panels.** A job can carry its own panel of up to 5 arbiters and a quorum; otherwise the protocol's authorised arbiters rule. Arbiters vote on a split per disputed milestone (freelancer amount + client amount), and the payout executes once quorum is reached.
- **Evidence on record.** Either party can attach IPFS evidence to a milestone before an arbiter rules.
- **Deadlines.** Clients can extend a deadline; either side can raise an overdue dispute; after the deadline plus a 30-day grace period, an emergency refund path opens.
- **Reopen after arbitration.** Paid work stays paid; untouched milestones can be withdrawn, or the job reopened for someone else.

### Reputation

Ratings in both directions (client rates freelancer, freelancer rates client), completed-job counts, reputation scores and badge tiers, all on-chain.

---

## Autopilot: the AI job manager

A client can hand any open or in-progress job to Autopilot. It's an ordinary Stellar account appointed with `set_job_manager`, and the contract restricts what it can do: it may **hire, approve, reject and dispute** on that one job, and it can **never cancel, move funds or be paid**. The client can take the job back at any moment with `revoke_job_manager`.

**How a hand-over works**

1. Autopilot reads the job and writes **4–7 checkable acceptance criteria**. The client sees them, can edit them, and picks how long applications stay open (15 minutes to 3 days). If the title and description ask for different things, the dialog says so.
2. The client **signs** the criteria and window with their wallet (SEP-53 signed message). The server checks the signature against the job's depositor, so nobody else (least of all a freelancer hoping for an easy bar) can set the criteria for someone else's job.
3. The client appoints Autopilot on-chain.

**What it does next**

- **Hiring.** When the window closes it scores every applicant side by side out of 100: capability (50, from their portfolio link or the letter's specifics), brief fit (30), timeline (15) and history (5, never a penalty for newcomers). **Identity-verified freelancers get a fixed +10 edge**, and win ties. It hires the best applicant scoring 60 or more; if nobody does, the job stays open and new applicants are scored as they arrive.
- **Reviewing.** Each delivery is judged against the criteria that apply to _that_ milestone. Autopilot opens the delivered link or attachment and judges what is actually there, not what the freelancer says about it. A delivery with nothing attached is rejected at 0. Approving pays out; rejecting sends back exactly what to fix and what to keep.
- **Escalating.** After **3 failed attempts on a milestone**, it opens a dispute and a human arbiter decides.

Every decision is logged with its reasoning and transaction link, visible to the client as it happens. The freelancer is notified when Autopilot takes over, sees an **Autopilot in charge** badge, and sees the criteria on the job before applying.

Autopilot runs on xAI **Grok** when `XAI_API_KEY` is set and falls back to **Groq**. Anything a stranger wrote (job text, cover letters, portfolio pages, submissions) is passed to the model as untrusted data, and links are fetched with a guard that refuses private and loopback addresses.

---

## Verified freelancers

Freelancers can verify their identity once with [Didit](https://didit.me) (ID document + liveness). On approval, the backend's verifier key attests the wallet on-chain:

- **No personal data on-chain.** The contract stores only a salted HMAC of the person's normalised identity, which cannot be reversed.
- **Sybil-resistant.** One person can verify one wallet. The same identity on a second wallet is refused by the contract (`DuplicateIdentity`).
- **Visible to clients.** A Verified tag appears on applications, job cards and the dashboard, and Autopilot ranks verified applicants higher.

Results arrive by signed webhook (`X-Signature-V2`, timestamp checked within 5 minutes), with a fallback that polls Didit's decision API if no webhook arrives.

---

## Architecture

```
┌──────────────────────────┐      wallet-signed txs       ┌────────────────────────────┐
│  Frontend (React + Vite) │ ───────────────────────────▶ │  SecureFlow contract       │
│  Vercel                  │ ◀─── reads, events (RPC) ─── │  Soroban, Stellar testnet  │
└────────────┬─────────────┘                              └─────────────▲──────────────┘
             │ REST                                                     │ fee-bump, attest,
             ▼                                                          │ Autopilot actions
┌──────────────────────────┐                                            │
│  Backend (Express)       │ ───────────────────────────────────────────┘
│  Railway                 │ ──▶ Supabase (notifications, messages, applications, files)
│                          │ ──▶ Didit (identity)      ──▶ Grok / Groq (AI)
│                          │ ──▶ Pinata (IPFS evidence)
└──────────────────────────┘
```

| Layer    | Stack                                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------- |
| Contract | Rust, soroban-sdk 23, custom error codes (no panics), checked arithmetic, upgradeable in place                          |
| Frontend | React 19, Vite, TypeScript, Tailwind, Radix UI, Stellar Wallets Kit (Freighter, xBull, Lobstr, Albedo, Hana and others) |
| Backend  | Node 22, Express, @stellar/stellar-sdk, Supabase, Didit v3, Grok/Groq                                                   |
| Data     | Contract indexes for open jobs and per-freelancer applications, batch reads of up to 50 escrows per call                |

Notifications come from contract events: the frontend indexes them from RPC and notifies each wallet of what concerns it, with per-wallet de-duplication.

---

## Deployed contract

| Network         | Contract ID                                                | Version         |
| --------------- | ---------------------------------------------------------- | --------------- |
| Stellar testnet | `CAJAUKTFKRYZCIFCQOGNZJMCJITC574Z5DUFRINMXXR7VIYKRBEFPS7H` | `2.2.0-indexes` |

Call `version()` to check what's deployed. The contract is upgradeable by its owner (`upgrade(new_wasm_hash)`), so the ID stays stable across releases.

---

## Run it locally

### Prerequisites

- Node.js 22+ and npm
- Rust (the version in `rust-toolchain.toml`) with the `wasm32v1-none` target: `rustup target add wasm32v1-none`
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli/install-cli)
- A Stellar wallet extension (e.g. Freighter) set to **Testnet**

### 1. Frontend

```bash
git clone https://github.com/Gbangbolaoluwagbemiga/SecureFlow-scaffold.git
cd SecureFlow-scaffold
npm install
npm run install:contracts      # builds the generated contract client
cp .env.example .env           # then fill it in (see Configuration)
npm run dev                    # http://localhost:5173
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env           # then fill it in (see Configuration)
npm run dev                    # http://localhost:8787, /health to check
```

Point the frontend at it with `VITE_API_URL=http://localhost:8787`.

### 3. Database (Supabase)

Create a Supabase project, open **SQL Editor**, and run the files in `supabase/migrations/` in order (they're timestamped). Choose **Run and enable RLS** if asked: the backend uses the service-role key, which bypasses row-level security, and nothing else should touch these tables. Then put the project URL and **service-role** (or `sb_secret_…`) key in `backend/.env`.

### 4. Contract (optional, to deploy your own)

```bash
cargo test -p secureflow
stellar contract build
stellar contract deploy --wasm target/wasm32v1-none/release/secureflow.wasm \
  --source-account <identity> --network testnet
stellar contract invoke --id <CONTRACT_ID> --source-account <identity> --network testnet -- \
  initialize --owner <identity> --fee-collector <identity> --platform-fee-bp 100
```

Then set the new ID in `VITE_SECUREFLOW_CONTRACT_ID` and `SECUREFLOW_CONTRACT_ID`, and appoint the verifier with `set_verifier`.

---

## Configuration

### Frontend (`.env`, and Vercel environment variables)

| Variable                      | Required | Purpose                                                       |
| ----------------------------- | -------- | ------------------------------------------------------------- |
| `VITE_STELLAR_NETWORK`        | yes      | `testnet` or `mainnet`                                        |
| `VITE_SECUREFLOW_CONTRACT_ID` | yes      | Deployed contract ID                                          |
| `VITE_API_URL`                | yes      | Backend base URL (defaults to `http://localhost:8787` in dev) |
| `VITE_API_SECRET`             | if set   | Must match the backend's `API_SECRET`                         |
| `VITE_USDC_TOKEN_CONTRACT`    | no       | USDC token contract offered when creating a job               |
| `VITE_OWNER_ADDRESS`          | no       | Contract owner, to show the Admin panel to that wallet        |

### Backend (`backend/.env`, and Railway variables)

| Variable                                                                                      | Required         | Purpose                                                                                |
| --------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| `PORT`                                                                                        | no               | Defaults to 8787                                                                       |
| `API_SECRET`                                                                                  | in production    | Bearer token the frontend sends; leaves `/v1` open if unset                            |
| `FRONTEND_URL` / `FRONTEND_URL_PATTERN`                                                       | in production    | CORS: comma-separated origins / a regex for preview deployments                        |
| `SECUREFLOW_CONTRACT_ID`                                                                      | yes              | Contract the backend acts on                                                           |
| `STELLAR_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE`                                               | no               | Default to testnet                                                                     |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                                                   | yes              | Notifications, messages, applications, uploads                                         |
| `ADMIN_SECRET_KEY`                                                                            | for gasless      | Account that fee-bumps freelancers' applications                                       |
| `GROQ_API_KEY`                                                                                | for AI           | AI writers, and Autopilot's fallback model                                             |
| `XAI_API_KEY`                                                                                 | no               | Runs Autopilot on Grok                                                                 |
| `AUTOPILOT_SECRET_KEY`                                                                        | for Autopilot    | The agent's own account. Use a dedicated key, never the owner's                        |
| `AUTOPILOT_DATA_DIR`                                                                          | in production    | Where Autopilot keeps its state; mount a persistent volume here                        |
| `AUTOPILOT_MODEL`, `AUTOPILOT_VERIFIED_EDGE`, `AUTOPILOT_HIRE_THRESHOLD`, `AUTOPILOT_POLL_MS` | no               | Overrides (defaults: provider default model, 10, 60, 20000 ms)                         |
| `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET`                                  | for verification | From the Didit console; give the API key only Sessions-write and Decisions-read access |
| `DIDIT_CALLBACK_URL`                                                                          | no               | Where Didit returns the user after verifying                                           |
| `IDENTITY_HASH_SALT`                                                                          | for verification | Long random secret. Never change it once live: it would let people verify twice        |
| `VERIFIER_SECRET_KEY`                                                                         | for verification | Account appointed with `set_verifier` to attest verifications                          |
| `PINATA_JWT`                                                                                  | for evidence     | IPFS uploads for dispute evidence                                                      |

Generate dedicated keys with the Stellar CLI (`stellar keys generate <name> --network testnet --fund`) and copy secrets with `stellar keys show <name>` straight into your host's variables. Never commit them.

---

## Deploying to production

**Frontend → Vercel.** Import the repo, framework preset **Vite**, build command `npm run build`, output `dist`. Add the frontend variables above. Every push to `main` deploys; pull requests get preview URLs.

**Backend → Railway.** Create a service from the repo with root directory `backend` (`railway.json` sets the build, start command and `/health` check). Add the backend variables, then:

1. Add a **volume** and set `AUTOPILOT_DATA_DIR` to its mount path, so Autopilot keeps its review history across deploys.
2. Set `FRONTEND_URL` to your Vercel domain and `API_SECRET` to a long random value (and the same value in Vercel's `VITE_API_SECRET`).
3. In the Didit console, point the webhook at `https://<your-backend>/webhooks/didit`.

**Contract.** Build, upload and upgrade in place (owner only):

```bash
stellar contract build
HASH=$(stellar contract upload --wasm target/wasm32v1-none/release/secureflow.wasm \
  --source-account <owner> --network testnet)
stellar contract invoke --id <CONTRACT_ID> --source-account <owner> --network testnet -- \
  upgrade --new_wasm_hash $HASH
```

After an upgrade that adds indexes, backfill them with `rebuild_indexes --from_id 1 --to_id <n>`.

**Go-live checklist**

- [ ] `/health` returns `{"ok":true,"supabase":"ok"}`
- [ ] `API_SECRET` / `VITE_API_SECRET` set; `FRONTEND_URL` restricts CORS
- [ ] Autopilot volume mounted; `GET /v1/autopilot/info` shows `"enabled": true`
- [ ] Gasless, verifier and Autopilot accounts funded, and separate from the owner key
- [ ] Didit webhook reaches the backend; a test verification shows the Verified tag
- [ ] Supabase tables have RLS enabled

---

## Contract reference

Every failure returns a specific error code, which the app translates into plain language (`src/lib/web3/contract-errors.ts`). Codes are grouped: 1000s admin, 1100s escrow state, 1200s creation, 1300s marketplace, 1400s milestones, 1500s refunds and deadlines, 1600s authorisation, 1700s validation, 1800s ratings, 1900s evidence, 2000s+ pause, tokens, editing, cancellation, negotiation, job manager, transfers and verification.

| Area         | Entry points                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Escrow       | `create_escrow`, `quote_deposit`, `start_work`, `cancel_job`, `refund_escrow`, `extend_deadline`, `emergency_refund_after_deadline`                           |
| Milestones   | `submit_milestone`, `resubmit_milestone`, `approve_milestone`, `reject_milestone`, `dispute_milestone`, `add_milestone`, `remove_milestone`, `set_milestones` |
| Funds        | `add_job_funds`, `withdraw_job_funds`                                                                                                                         |
| Marketplace  | `apply_to_job`, `accept_freelancer`, `decline_assignment`, `reopen_job`                                                                                       |
| Negotiation  | `propose_milestone_change`, `approve_milestone_proposal`, `reject_milestone_proposal`                                                                         |
| Job manager  | `set_job_manager`, `revoke_job_manager`, `get_job_manager`, `is_job_manager`                                                                                  |
| Disputes     | `resolve_dispute`, `raise_overdue_dispute`, `arbiter_approve_refund`, `arbiter_award_freelancer`, `submit_evidence`                                           |
| Reputation   | `submit_rating`, `submit_client_rating`, `get_average_rating`, `get_badge`, `get_reputation`                                                                  |
| Verification | `set_verifier`, `attest_verification`, `revoke_verification`, `is_verified`                                                                                   |
| Reads        | `get_escrow`, `get_escrows` (batch ≤ 50), `get_open_jobs`, `get_freelancer_applications`, `get_milestones`, `get_applications_page`                           |
| Admin        | pause/unpause, fees and fee collector, token whitelist/blacklist, arbiters, `withdraw_fees`, `delete_escrow`, `upgrade`, `rebuild_indexes`                    |

Limits: 20 milestones, 5 arbiters, 50 applications per job, durations of 1 hour to 365 days, platform fee ≤ 10%.

---

## Backend API

All `/v1` routes expect `Authorization: Bearer <API_SECRET>` when it's set.

| Route                                            | Purpose                                                |
| ------------------------------------------------ | ------------------------------------------------------ |
| `GET /health`                                    | Liveness, plus whether Supabase actually answers       |
| `POST /v1/gasless/apply`                         | Fee-bump and submit a freelancer's signed application  |
| `POST /v1/verification/session`, `GET /status`   | Start a Didit check, read a wallet's status            |
| `POST /webhooks/didit`                           | Didit results (HMAC-signed, no API secret)             |
| `GET /v1/autopilot/info`, `/jobs`, `/jobs/:id`   | Agent address and settings, managed jobs, decision log |
| `POST /v1/autopilot/preview`, `/handover`        | Draft criteria; record the client's signed hand-over   |
| `/v1/notifications`, `/v1/messages`              | Notifications and client–freelancer chat               |
| `/v1/applications`, `/v1/upload`, `/v1/evidence` | Application records, attachments, IPFS evidence        |
| `/v1/ai/*`                                       | AI help writing milestones, cover letters and rewrites |
| `/v1/analytics/*`                                | Platform and per-user statistics                       |

---

## Testing

```bash
cargo test -p secureflow                                   # 20 contract tests
cargo clippy -p secureflow --all-targets -- -D warnings    # lint the contract
npm run lint && npx prettier . --check && npm run build    # frontend
(cd backend && npx tsc --noEmit -p .)                      # backend
```

CI runs these as independent jobs on every push and pull request, plus a smoke test that deploys the contract to a local Stellar network.

---

## Security model

- **Funds only move by contract rules.** Nobody, including the platform, can withdraw a client's escrow; the owner can only collect earned fees and recover tokens that were never part of an escrow.
- **Least privilege for every server key.** The gasless key only pays fees; the verifier key can only attest identities; the Autopilot key can only act on jobs a client explicitly handed it, and can never move money to itself.
- **Client consent is signed.** Autopilot's criteria are bound to the client's wallet signature.
- **Untrusted text stays data.** LLM prompts wrap user content and detect injection attempts; fetched links are SSRF-guarded.
- **No personal data on-chain.** Identity verification stores only a salted, irreversible hash.

Found a vulnerability? Please follow [SECURITY.md](SECURITY.md) rather than opening a public issue.

---

## Project structure

```
contracts/secureflow/src/
  lib.rs                 entry points
  storage_types.rs       types, storage keys, error codes, limits
  escrow_core.rs         storage, TTLs, indexes, token transfers
  escrow_management.rs   create, cancel, funds, job manager, reopen
  work_lifecycle.rs      milestones, negotiation, dispute resolution
  refund_system.rs       refunds, deadlines, overdue disputes
  marketplace.rs         applications, hiring
  verification.rs        identity attestations
  ratings.rs  evidence.rs  admin.rs  events.rs  test.rs

src/                     React app
  pages/                 Home, Jobs, Create, Dashboard, Freelancer, Approvals, Admin, Analytics
  components/autopilot/  hand-over dialog, panel and decision log, badges
  components/verification/  Verified badge, identity card
  lib/web3/              contract service, error messages, event indexer, wallet signing
  lib/autopilot.ts       Autopilot API client
  contracts/generated/   generated contract client

backend/src/
  index.ts               server, CORS, rate limits
  routes/                gasless, verification, autopilot, notifications, messages, uploads, AI, analytics
  lib/autopilot/         chain actions, model client, scorer and reviewer, runner, store
  lib/didit.ts           Didit sessions, webhook verification, on-chain attestation

supabase/migrations/     database schema
```

---

## Contributing

1. Fork the repo and create a branch: `git checkout -b feat/your-change`
2. Make the change, with tests where it touches the contract
3. Run the checks under [Testing](#testing)
4. Open a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

[Apache-2.0](LICENSE). Built with [Scaffold Stellar](https://github.com/theahaco/scaffold-stellar).
