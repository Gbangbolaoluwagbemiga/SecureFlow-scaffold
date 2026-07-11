/**
 * Soroban Event Indexer
 *
 * Stellar/Soroban equivalent of the Arc Goldsky subgraph.
 * Uses the Soroban RPC `getEvents` API to index contract events locally,
 * storing them in localStorage for fast querying by the analytics page,
 * notification system, and activity feed.
 *
 * Usage:
 *   await syncEvents()          — fetch new events since last cursor
 *   getStoredEvents()           — all indexed events
 *   getEscrowEvents(escrowId)   — events for a specific escrow
 *   getUserEvents(address)      — events involving a given Stellar address
 */

import { rpc, xdr, scValToNative } from "@stellar/stellar-sdk";
import { getCurrentNetwork, CONTRACTS } from "./stellar-config";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IndexedEvent {
  /** Unique event ID from the RPC (format: <ledger>-<txIndex>-<opIndex>-<eventIndex>) */
  id: string;
  /** Soroban ledger sequence */
  ledger: number;
  /** ISO 8601 timestamp from ledger close */
  timestamp: string;
  /** The Soroban contract ID that emitted this event */
  contractId: string;
  /**
   * Human-readable event type, decoded from topic[0].
   * Examples: "escrow_created", "work_started", "milestone_submitted", etc.
   */
  eventType: string;
  /** All topic values decoded via scValToNative */
  topics: unknown[];
  /** Event body (data payload) decoded via scValToNative */
  value: unknown;
  /** Only present for events that passed a successful contract call */
  inSuccessfulContractCall: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENTS_STORAGE_KEY = "secureflow_indexed_events";
const CURSOR_STORAGE_KEY = "secureflow_event_cursor";
/** How many ledgers to look back on first run (~25 minutes of Stellar history) */
const INITIAL_LOOKBACK = 1000;
/** Max events to keep in localStorage (oldest get pruned) */
const MAX_STORED_EVENTS = 1000;

// ─── Known event type names ───────────────────────────────────────────────────
// Soroban contracts emit events whose first topic is a Symbol.
// We normalise all casing/underscore variants to a canonical name.

export const EVENT_TYPES = {
  ESCROW_CREATED: "escrow_created",
  WORK_STARTED: "work_started",
  MILESTONE_SUBMITTED: "milestone_submitted",
  MILESTONE_APPROVED: "milestone_approved",
  MILESTONE_REJECTED: "milestone_rejected",
  MILESTONE_DISPUTED: "milestone_disputed",
  DISPUTE_RESOLVED: "dispute_resolved",
  APPLICATION_SUBMITTED: "application_submitted",
  FREELANCER_ACCEPTED: "freelancer_accepted",
  ESCROW_COMPLETED: "escrow_completed",
  ESCROW_REFUNDED: "escrow_refunded",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

// Mapping from raw contract symbol variants → canonical name
const EVENT_ALIAS: Record<string, string> = {
  // snake_case variants
  escrow_created: EVENT_TYPES.ESCROW_CREATED,
  work_started: EVENT_TYPES.WORK_STARTED,
  milestone_submitted: EVENT_TYPES.MILESTONE_SUBMITTED,
  milestone_approved: EVENT_TYPES.MILESTONE_APPROVED,
  milestone_rejected: EVENT_TYPES.MILESTONE_REJECTED,
  milestone_disputed: EVENT_TYPES.MILESTONE_DISPUTED,
  dispute_resolved: EVENT_TYPES.DISPUTE_RESOLVED,
  application_submitted: EVENT_TYPES.APPLICATION_SUBMITTED,
  freelancer_accepted: EVENT_TYPES.FREELANCER_ACCEPTED,
  escrow_completed: EVENT_TYPES.ESCROW_COMPLETED,
  escrow_refunded: EVENT_TYPES.ESCROW_REFUNDED,
  // PascalCase variants (some contracts use these)
  EscrowCreated: EVENT_TYPES.ESCROW_CREATED,
  WorkStarted: EVENT_TYPES.WORK_STARTED,
  MilestoneSubmitted: EVENT_TYPES.MILESTONE_SUBMITTED,
  MilestoneApproved: EVENT_TYPES.MILESTONE_APPROVED,
  MilestoneRejected: EVENT_TYPES.MILESTONE_REJECTED,
  MilestoneDisputed: EVENT_TYPES.MILESTONE_DISPUTED,
  DisputeResolved: EVENT_TYPES.DISPUTE_RESOLVED,
  ApplicationSubmitted: EVENT_TYPES.APPLICATION_SUBMITTED,
  FreelancerAccepted: EVENT_TYPES.FREELANCER_ACCEPTED,
  EscrowCompleted: EVENT_TYPES.ESCROW_COMPLETED,
  EscrowRefunded: EVENT_TYPES.ESCROW_REFUNDED,
};

function normaliseEventType(raw: string): string {
  return EVENT_ALIAS[raw] ?? raw.toLowerCase().replace(/\s+/g, "_");
}

// ─── ScVal decoder ─────────────────────────────────────────────────────────────

function decodeScVal(val: xdr.ScVal): unknown {
  try {
    const native = scValToNative(val);
    // BigInt → string so it survives JSON serialisation
    if (typeof native === "bigint") return native.toString();
    return native;
  } catch {
    return null;
  }
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

export function getStoredEvents(): IndexedEvent[] {
  try {
    const raw = localStorage.getItem(EVENTS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as IndexedEvent[]) : [];
  } catch {
    return [];
  }
}

function appendEvents(newEvents: IndexedEvent[]): void {
  if (newEvents.length === 0) return;
  const existing = getStoredEvents();
  const existingIds = new Set(existing.map((e) => e.id));
  const fresh = newEvents.filter((e) => !existingIds.has(e.id));
  if (fresh.length === 0) return;
  // Keep newest MAX_STORED_EVENTS events (prune oldest)
  const combined = [...existing, ...fresh].slice(-MAX_STORED_EVENTS);
  localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(combined));
}

function getStoredCursor(): string | null {
  return localStorage.getItem(CURSOR_STORAGE_KEY);
}

function setStoredCursor(cursor: string): void {
  localStorage.setItem(CURSOR_STORAGE_KEY, cursor);
}

/** Call this when you want to force a full re-index from scratch */
export function clearEventCache(): void {
  localStorage.removeItem(EVENTS_STORAGE_KEY);
  localStorage.removeItem(CURSOR_STORAGE_KEY);
}

// ─── Query helpers ─────────────────────────────────────────────────────────────

/** All indexed events for a specific escrow (by numeric or string ID) */
export function getEscrowEvents(escrowId: string | number): IndexedEvent[] {
  const numId = Number(escrowId);
  return getStoredEvents().filter((e) =>
    e.topics.some((t) => t === numId || t === String(numId)),
  );
}

/** All indexed events that involve a specific Stellar address in any topic */
export function getUserEvents(address: string): IndexedEvent[] {
  if (!address) return [];
  return getStoredEvents().filter((e) => e.topics.some((t) => t === address));
}

/** Events of a specific canonical type */
export function getEventsByType(type: string): IndexedEvent[] {
  return getStoredEvents().filter((e) => e.eventType === type);
}

/**
 * Events newer than a given ISO timestamp or ledger.
 * Useful for building activity feeds since a known point.
 */
export function getEventsSince(
  options: { since?: string; fromLedger?: number } = {},
): IndexedEvent[] {
  const all = getStoredEvents();
  if (options.fromLedger !== undefined) {
    return all.filter((e) => e.ledger >= options.fromLedger!);
  }
  if (options.since) {
    const ts = new Date(options.since).getTime();
    return all.filter((e) => new Date(e.timestamp).getTime() >= ts);
  }
  return all;
}

// ─── Core sync ────────────────────────────────────────────────────────────────

/**
 * Fetch new contract events from Soroban RPC and append them to localStorage.
 * Returns the newly fetched events so callers can fire notifications immediately.
 *
 * Uses a cursor for incremental updates after the first run.
 * On first run, looks back INITIAL_LOOKBACK ledgers from the current tip.
 */
export async function syncEvents(): Promise<IndexedEvent[]> {
  const network = getCurrentNetwork();
  const contractId = CONTRACTS.SECUREFLOW_ESCROW;

  // Don't attempt if the contract isn't configured
  if (!contractId || !/^C[A-Z2-7]{55}$/.test(contractId)) return [];

  const server = new rpc.Server(network.rpcUrl);
  const storedCursor = getStoredCursor();

  const request: rpc.Server.GetEventsRequest = {
    filters: [
      {
        type: "contract",
        contractIds: [contractId],
      },
    ],
    limit: 200,
  };

  if (storedCursor) {
    request.cursor = storedCursor;
  } else {
    // First run — fetch latest ledger and look back
    const latestLedger = await server.getLatestLedger();
    request.startLedger = Math.max(1, latestLedger.sequence - INITIAL_LOOKBACK);
  }

  let response: rpc.Api.GetEventsResponse;
  try {
    response = await server.getEvents(request);
  } catch {
    // RPC unavailable or contract has no events yet — fail silently
    return [];
  }

  if (!response.events || response.events.length === 0) {
    // Advance cursor even when no events so next poll starts from here
    if (response.cursor) setStoredCursor(response.cursor);
    return [];
  }

  const parsed: IndexedEvent[] = response.events
    .filter((e) => e.inSuccessfulContractCall)
    .map((e) => {
      const rawType = e.topic[0] ? String(decodeScVal(e.topic[0])) : "unknown";
      return {
        id: e.id,
        ledger: e.ledger,
        timestamp: e.ledgerClosedAt,
        contractId,
        eventType: normaliseEventType(rawType),
        topics: e.topic.map(decodeScVal),
        value: decodeScVal(e.value),
        inSuccessfulContractCall: e.inSuccessfulContractCall,
      };
    });

  appendEvents(parsed);

  if (response.cursor) setStoredCursor(response.cursor);

  return parsed;
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

export interface ActivityItem {
  id: string;
  timestamp: string;
  ledger: number;
  eventType: string;
  escrowId: number | null;
  milestoneIndex: number | null;
  actor: string | null;
  summary: string;
}

/** Build a human-readable activity feed entry from a raw event */
function eventToActivity(event: IndexedEvent): ActivityItem {
  const topics = event.topics;
  // Convention: topics[0] = event name, topics[1] = escrow_id, topics[2] = milestone_index or actor
  const escrowId =
    typeof topics[1] === "number"
      ? topics[1]
      : typeof topics[1] === "string" && !isNaN(Number(topics[1]))
        ? Number(topics[1])
        : null;

  let milestoneIndex: number | null = null;
  let actor: string | null = null;

  if (typeof topics[2] === "number") milestoneIndex = topics[2];
  else if (
    typeof topics[2] === "string" &&
    topics[2].startsWith("G") &&
    topics[2].length === 56
  )
    actor = topics[2];
  if (typeof topics[3] === "string" && topics[3].startsWith("G"))
    actor = topics[3];

  const escrowLabel = escrowId !== null ? `Escrow #${escrowId}` : "an escrow";
  const milestoneLabel =
    milestoneIndex !== null ? `milestone ${milestoneIndex + 1}` : "a milestone";
  const actorLabel = actor
    ? `${actor.slice(0, 4)}…${actor.slice(-4)}`
    : "someone";

  const summaries: Record<string, string> = {
    [EVENT_TYPES.ESCROW_CREATED]: `New escrow created: ${escrowLabel}`,
    [EVENT_TYPES.WORK_STARTED]: `${actorLabel} started work on ${escrowLabel}`,
    [EVENT_TYPES.MILESTONE_SUBMITTED]: `${actorLabel} submitted ${milestoneLabel} on ${escrowLabel}`,
    [EVENT_TYPES.MILESTONE_APPROVED]: `${milestoneLabel} approved on ${escrowLabel}`,
    [EVENT_TYPES.MILESTONE_REJECTED]: `${milestoneLabel} rejected on ${escrowLabel}`,
    [EVENT_TYPES.MILESTONE_DISPUTED]: `${milestoneLabel} disputed on ${escrowLabel}`,
    [EVENT_TYPES.DISPUTE_RESOLVED]: `Dispute resolved for ${milestoneLabel} on ${escrowLabel}`,
    [EVENT_TYPES.APPLICATION_SUBMITTED]: `${actorLabel} applied to ${escrowLabel}`,
    [EVENT_TYPES.FREELANCER_ACCEPTED]: `${actorLabel} accepted for ${escrowLabel}`,
    [EVENT_TYPES.ESCROW_COMPLETED]: `${escrowLabel} completed`,
    [EVENT_TYPES.ESCROW_REFUNDED]: `${escrowLabel} refunded`,
  };

  return {
    id: event.id,
    timestamp: event.timestamp,
    ledger: event.ledger,
    eventType: event.eventType,
    escrowId,
    milestoneIndex,
    actor,
    summary: summaries[event.eventType] ?? `Event: ${event.eventType}`,
  };
}

/**
 * Get a chronological activity feed optionally filtered by address or escrow.
 * Most-recent first.
 */
export function getActivityFeed(options?: {
  address?: string;
  escrowId?: string | number;
  limit?: number;
}): ActivityItem[] {
  let events = options?.address
    ? getUserEvents(options.address)
    : options?.escrowId !== undefined
      ? getEscrowEvents(options.escrowId)
      : getStoredEvents();

  // Sort newest first
  events = events.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  if (options?.limit) events = events.slice(0, options.limit);

  return events.map(eventToActivity);
}
