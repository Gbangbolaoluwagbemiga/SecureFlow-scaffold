/**
 * The Autopilot loop.
 *
 * A job moves through four phases, and the chain — never this file — decides
 * which one it is in:
 *
 *   awaiting_handover  the client approved criteria but has not yet signed
 *                      set_job_manager; nothing happens until they do
 *   hiring             applications stay open for the client's window, then
 *                      every applicant is scored together and the best hired
 *   working            each delivery is reviewed against the criteria;
 *                      approve pays, reject explains, the third failure on a
 *                      milestone escalates to a human arbiter
 *   disputed           out of the agent's hands until an arbiter rules
 *
 * The client can take the job back at any moment by revoking the manager; the
 * next pass notices and stops.
 */
import * as chain from "./chain.js";
import { enumName } from "./chain.js";
import {
  HIRE_THRESHOLD,
  VERIFIED_EDGE,
  pickWinner,
  reviewDelivery,
  scoreApplicants,
  writeCriteria,
  type Applicant,
} from "./brain.js";
import { LlmRateLimited } from "./llm.js";
import * as store from "./store.js";

/** Failed deliveries on one milestone before it goes to an arbiter. */
export const MAX_ROUNDS = 3;
const LEDGER_SECONDS = 5;
const POLL_MS = Number(process.env.AUTOPILOT_POLL_MS ?? 20_000);

const FINAL = new Set(["Refunded", "Expired", "Cancelled"]);

function fmtAmount(stroops: bigint): string {
  return `${(Number(stroops) / 1e7).toFixed(2)} XLM`;
}

/** Criteria for a job, generated once and cached so the client sees a stable list. */
export async function previewFor(escrowId: number): Promise<store.Preview> {
  const tracked = store.getJob(escrowId);
  if (tracked && tracked.criteria.length) {
    return {
      criteria: tracked.criteria,
      deliverableFormat: tracked.deliverableFormat,
      createdAt: tracked.approvedAt,
    };
  }
  const cached = store.getPreview(escrowId);
  if (cached) return cached;

  const escrow = await chain.getEscrow(escrowId);
  if (!escrow) throw new Error("Escrow not found");
  const milestones = await chain.getMilestones(escrowId);
  const c = await writeCriteria({
    title: escrow.project_title,
    description: escrow.project_description,
    milestones: milestones.map(
      (m) => `${m.requirements || m.description} (${fmtAmount(m.amount)})`,
    ),
    budget: fmtAmount(escrow.total_amount),
  });
  const preview: store.Preview = { ...c, createdAt: Date.now() };
  store.putPreview(escrowId, preview);
  return preview;
}

// ─── Phases ──────────────────────────────────────────────────────────────────

async function hire(
  job: store.JobState,
  escrow: chain.ChainEscrow,
): Promise<void> {
  const id = job.escrowId;
  const closesAt = (job.adoptedAt ?? Date.now()) + job.windowMinutes * 60_000;
  if (Date.now() < closesAt) return;

  const apps = await chain.getApplications(id);
  if (apps.length === 0 || apps.length <= (job.scoredCount ?? 0)) return;

  const applicants: Applicant[] = await Promise.all(
    apps.map(async (a) => {
      const [verified, completed, rating] = await Promise.all([
        chain.isVerified(a.freelancer).catch(() => false),
        chain.getCompletedEscrows(a.freelancer).catch(() => 0),
        chain
          .getAverageRating(a.freelancer)
          .catch(() => [0, 0] as [number, number]),
      ]);
      const [total, count] = rating.map(Number) as [number, number];
      return {
        freelancer: a.freelancer,
        coverLetter: a.cover_letter,
        proposedTimelineDays: Number(a.proposed_timeline),
        appliedAt: Number(a.applied_at),
        verified,
        completedJobs: Number(completed),
        // The contract keeps a running (total, count).
        rating: { average: count ? total / count : 0, count },
      };
    }),
  );

  const ledger = await chain.latestLedger();
  const daysLeft = Math.max(
    0,
    Math.round(((escrow.deadline - ledger) * LEDGER_SECONDS) / 86_400),
  );

  const scored = await scoreApplicants(
    {
      title: escrow.project_title,
      criteria: job.criteria,
      daysLeft,
      budget: fmtAmount(escrow.total_amount),
    },
    applicants,
  );

  for (const s of scored) {
    store.addDecision(id, {
      type: "applicant_scored",
      summary: `${s.freelancer.slice(0, 6)}…${s.freelancer.slice(-4)} scored ${s.score}/100${
        s.verified ? ` (verified, +${VERIFIED_EDGE})` : ""
      }${s.injection ? " — tried to manipulate the reviewer" : ""}`,
      detail: s.reasoning,
      target: s.freelancer,
      score: s.score,
      verified: s.verified,
    });
  }

  const winner = pickWinner(scored, applicants);
  if (!winner) {
    const best = Math.max(0, ...scored.map((s) => s.score));
    store.addDecision(id, {
      type: "no_suitable_applicant",
      summary: `Nobody reached ${HIRE_THRESHOLD}/100 (best was ${best}). The job stays open and new applicants are scored as they arrive.`,
    });
    store.updateJob(id, (j) => (j.scoredCount = apps.length));
    return;
  }

  const txHash = await chain.acceptFreelancer(id, winner.freelancer);
  store.updateJob(id, (j) => {
    j.scoredCount = apps.length;
    j.hired = winner.freelancer;
    j.phase = "working";
  });
  store.addDecision(id, {
    type: "hired",
    summary: `Hired ${winner.freelancer.slice(0, 6)}…${winner.freelancer.slice(-4)} with ${winner.score}/100 out of ${apps.length} applicant(s)${
      winner.verified ? " — verified identity" : ""
    }.`,
    detail: winner.reasoning,
    target: winner.freelancer,
    score: winner.score,
    verified: winner.verified,
    txHash,
  });
}

function revisionNote(
  review: Awaited<ReturnType<typeof reviewDelivery>>,
  roundsLeft: number,
): string {
  const failed = review.results.filter((r) => !r.passed);
  const met = review.results.filter((r) => r.passed);
  return [
    `Autopilot review: ${review.score}/100 — revision needed (${roundsLeft} attempt${roundsLeft === 1 ? "" : "s"} left before a human arbiter decides).`,
    review.feedback,
    failed.length
      ? `To fix:\n${failed.map((r) => `✗ ${r.criterion}${r.note ? ` — ${r.note}` : ""}`).join("\n")}`
      : "",
    met.length
      ? `Already met, keep these:\n${met.map((r) => `✓ ${r.criterion}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 1800);
}

async function review(job: store.JobState): Promise<void> {
  const id = job.escrowId;
  const milestones = await chain.getMilestones(id);

  for (const [index, m] of milestones.entries()) {
    if (enumName(m.status) !== "Submitted") continue;
    const key = String(index);
    const history = job.reviews[key] ?? [];
    const submittedAt = Number(m.submitted_at);
    if (history.some((h) => h.submittedAt === submittedAt)) continue;

    const evidence = await chain
      .getEvidence(id, index)
      .then((list) => list.map((e) => `https://ipfs.io/ipfs/${e.cid}`))
      .catch(() => [] as string[]);

    const result = await reviewDelivery({
      criteria: job.criteria,
      deliverableFormat: job.deliverableFormat,
      milestoneRequirement: m.requirements || "",
      milestoneNumber: index + 1,
      otherMilestones: milestones
        .map((o, j) => ({
          number: j + 1,
          requirement: o.requirements || o.description,
        }))
        .filter((o) => o.number !== index + 1),
      isFinal: index === milestones.length - 1,
      submission: m.description,
      evidence,
    });

    const failedBefore = history.filter((h) => !h.approved).length;
    const label = `milestone ${index + 1}`;

    if (result.approved) {
      const txHash = await chain.approveMilestone(id, index);
      store.updateJob(id, (j) => {
        (j.reviews[key] ??= []).push({
          submittedAt,
          approved: true,
          score: result.score,
        });
      });
      store.addDecision(id, {
        type: "work_approved",
        summary: `Approved ${label} at ${result.score}/100 and released ${fmtAmount(m.amount)}.`,
        detail: result.summary,
        milestone: index,
        score: result.score,
        txHash,
      });
      continue;
    }

    if (failedBefore + 1 >= MAX_ROUNDS) {
      const failed = result.results
        .filter((r) => !r.passed)
        .map((r) => r.criterion);
      const reason =
        `Autopilot: ${MAX_ROUNDS} attempts on ${label} did not meet the brief. Final delivery scored ${result.score}/100. Unmet: ${
          failed.join("; ") || result.summary
        }`.slice(0, 1500);
      const txHash = await chain.disputeMilestone(id, index, reason);
      store.updateJob(id, (j) => {
        (j.reviews[key] ??= []).push({
          submittedAt,
          approved: false,
          score: result.score,
        });
        j.phase = "disputed";
      });
      store.addDecision(id, {
        type: "escalated",
        summary: `${label} failed ${MAX_ROUNDS} times — escalated to a human arbiter. Funds stay locked until they rule.`,
        detail: reason,
        milestone: index,
        score: result.score,
        txHash,
      });
      return;
    }

    const roundsLeft = MAX_ROUNDS - (failedBefore + 1);
    const note = revisionNote(result, roundsLeft);
    const txHash = await chain.rejectMilestone(id, index, note);
    store.updateJob(id, (j) => {
      (j.reviews[key] ??= []).push({
        submittedAt,
        approved: false,
        score: result.score,
      });
    });
    store.addDecision(id, {
      type: "revision_requested",
      summary: `${label} scored ${result.score}/100 — sent back with feedback (${roundsLeft} attempt${roundsLeft === 1 ? "" : "s"} left).`,
      detail: note,
      milestone: index,
      score: result.score,
      txHash,
    });
  }

  const after = await chain.getMilestones(id);
  if (
    after.length > 0 &&
    after.every((m) => enumName(m.status) === "Approved")
  ) {
    store.updateJob(id, (j) => (j.phase = "completed"));
    store.addDecision(id, {
      type: "completed",
      summary: "Every milestone approved and paid. Job complete.",
    });
  }
}

// ─── One pass over every tracked job ─────────────────────────────────────────

async function step(job: store.JobState, agent: string): Promise<void> {
  const id = job.escrowId;
  const [escrow, manager] = await Promise.all([
    chain.getEscrow(id),
    chain.getJobManager(id),
  ]);
  if (!escrow) return;
  const status = enumName(escrow.status);
  const ours = manager === agent;

  if (job.phase === "awaiting_handover") {
    if (!ours) return; // the client has not signed set_job_manager yet
    const hasFreelancer = !!escrow.beneficiary;
    store.updateJob(id, (j) => {
      j.adoptedAt = Date.now();
      j.phase = hasFreelancer ? "working" : "hiring";
      if (hasFreelancer) j.hired = escrow.beneficiary ?? undefined;
    });
    store.addDecision(id, {
      type: "handed_over",
      summary: hasFreelancer
        ? "Autopilot took over. A freelancer is already on the job, so it goes straight to reviewing deliveries."
        : `Autopilot took over. Applications stay open for ${job.windowMinutes} minute(s), then every applicant is scored together.`,
    });
    return;
  }

  if (!ours) {
    store.updateJob(id, (j) => (j.phase = "released"));
    store.addDecision(id, {
      type: "taken_back",
      summary: "The client took this job back. Autopilot has stopped.",
    });
    return;
  }

  if (status === "Released") {
    store.updateJob(id, (j) => (j.phase = "completed"));
    return;
  }
  if (FINAL.has(status)) {
    store.updateJob(id, (j) => (j.phase = "released"));
    return;
  }
  if (status === "Disputed") {
    if (job.phase !== "disputed")
      store.updateJob(id, (j) => (j.phase = "disputed"));
    return;
  }
  // An arbiter ruled and the job carries on: back to reviewing.
  if (job.phase === "disputed") {
    store.updateJob(
      id,
      (j) => (j.phase = escrow.beneficiary ? "working" : "hiring"),
    );
    return;
  }

  if (job.phase === "hiring") {
    if (escrow.beneficiary) {
      store.updateJob(id, (j) => {
        j.phase = "working";
        j.hired = escrow.beneficiary ?? undefined;
      });
      return;
    }
    await hire(job, escrow);
    return;
  }

  if (job.phase === "working") {
    // The freelancer declined before starting: the job is open again.
    if (!escrow.beneficiary) {
      store.updateJob(id, (j) => {
        j.phase = "hiring";
        j.hired = undefined;
        j.scoredCount = 0;
        j.adoptedAt = Date.now();
      });
      return;
    }
    await review(job);
  }
}

let running = false;
let cooldownUntil = 0;

export async function tick(): Promise<void> {
  if (running || Date.now() < cooldownUntil) return;
  const agent = chain.agentAddress();
  if (!agent) return;
  running = true;
  try {
    const live = store
      .listJobs()
      .filter((j) => j.phase !== "completed" && j.phase !== "released");
    for (const job of live) {
      try {
        await step(job, agent);
      } catch (err) {
        if (err instanceof LlmRateLimited) {
          cooldownUntil = Date.now() + 60_000;
          console.warn("[autopilot] model rate limited; pausing a minute");
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[autopilot] escrow ${job.escrowId}:`, msg);
      }
    }
  } finally {
    running = false;
  }
}

export function startAutopilot(): void {
  if (!chain.isAutopilotConfigured()) {
    console.warn("[autopilot] AUTOPILOT_SECRET_KEY unset; Autopilot is off");
    return;
  }
  console.log(`[autopilot] running as ${chain.agentAddress()}`);
  setInterval(() => void tick(), POLL_MS);
  void tick();
}
