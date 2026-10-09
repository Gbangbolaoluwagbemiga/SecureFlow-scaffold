/**
 * Autopilot's memory: what each client approved, what the agent decided, and
 * how many revision rounds each milestone has used.
 *
 * A JSON file, because the agent must keep working while Supabase is down and
 * the state is small. Writes go to a temp file and are renamed into place, so a
 * crash mid-write leaves the previous version rather than half a file.
 *
 * On a host with an ephemeral disk, point AUTOPILOT_DATA_DIR at a mounted
 * volume. Losing this file is survivable — criteria are regenerated and the
 * chain still says who manages what — but it would reset revision counts.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type DecisionType =
  | "handed_over"
  | "window_open"
  | "applicant_scored"
  | "no_suitable_applicant"
  | "hired"
  | "work_approved"
  | "revision_requested"
  | "escalated"
  | "taken_back"
  | "completed"
  | "error";

export interface Decision {
  id: string;
  at: number;
  type: DecisionType;
  summary: string;
  detail?: string;
  target?: string;
  score?: number;
  verified?: boolean;
  milestone?: number;
  txHash?: string;
}

export interface ReviewRecord {
  submittedAt: number;
  approved: boolean;
  score: number;
}

export type JobPhase =
  | "awaiting_handover"
  | "hiring"
  | "working"
  | "disputed"
  | "completed"
  | "released";

export interface JobState {
  escrowId: number;
  client: string;
  criteria: string[];
  deliverableFormat: string;
  windowMinutes: number;
  approvedAt: number;
  /** When the agent first saw itself named as manager: the window starts here. */
  adoptedAt?: number;
  phase: JobPhase;
  /** Application count at the last successful scoring pass. */
  scoredCount?: number;
  hired?: string;
  reviews: Record<string, ReviewRecord[]>;
  decisions: Decision[];
}

export interface Preview {
  criteria: string[];
  deliverableFormat: string;
  titleConflict?: string;
  createdAt: number;
}

interface Db {
  jobs: Record<string, JobState>;
  previews: Record<string, Preview>;
}

const dir = path.resolve(process.env.AUTOPILOT_DATA_DIR ?? "data");
const file = path.join(dir, "autopilot.json");

let db: Db | null = null;

function load(): Db {
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(file, "utf8")) as Db;
    db.jobs ??= {};
    db.previews ??= {};
  } catch {
    db = { jobs: {}, previews: {} };
  }
  return db;
}

function save(): void {
  if (!db) return;
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, file);
}

export function getJob(id: number): JobState | undefined {
  return load().jobs[String(id)];
}

export function listJobs(): JobState[] {
  return Object.values(load().jobs);
}

export function putJob(job: JobState): void {
  load().jobs[String(job.escrowId)] = job;
  save();
}

export function updateJob(
  id: number,
  patch: (job: JobState) => void,
): JobState | undefined {
  const job = getJob(id);
  if (!job) return undefined;
  patch(job);
  save();
  return job;
}

/** Decisions are capped per job so a long-running one cannot grow unbounded. */
export function addDecision(id: number, d: Omit<Decision, "id" | "at">): void {
  updateJob(id, (job) => {
    job.decisions.push({ id: crypto.randomUUID(), at: Date.now(), ...d });
    if (job.decisions.length > 200) job.decisions = job.decisions.slice(-200);
  });
}

export function getPreview(id: number): Preview | undefined {
  return load().previews[String(id)];
}

export function putPreview(id: number, p: Preview): void {
  load().previews[String(id)] = p;
  save();
}
