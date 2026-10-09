/**
 * EventPoller — Soroban event indexer + notification dispatcher.
 *
 * Invisible background component, mounted once inside AppLayout.
 * Every POLL_INTERVAL_MS it:
 *   1. Calls syncEvents() to fetch new contract events from Soroban RPC
 *      and append them to localStorage (the Stellar-native subgraph).
 *   2. For each new event that involves the current wallet address,
 *      fires an in-app notification (cross-wallet / missed-event coverage).
 *   3. Dispatches `escrowUpdated` to trigger silent UI refreshes whenever
 *      state-changing events appear.
 *
 * Duplicate-notification guard: tracks notified event IDs in localStorage so
 * the same event is never toasted twice, even across page reloads.
 */

import { useEffect } from "react";
import { useWeb3 } from "@/contexts/web3-context";
import {
  useNotifications,
  createEscrowNotification,
  createMilestoneNotification,
} from "@/contexts/notification-context";
import { contractService } from "@/lib/web3/contract-service";
import {
  syncEvents,
  getStoredEvents,
  IndexedEvent,
  EVENT_TYPES,
} from "@/lib/web3/event-indexer";
import { getAutopilotInfo } from "@/lib/autopilot";

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const NOTIFIED_KEY = "secureflow_notified_event_ids";
const SINCE_KEY = "secureflow_notify_since_ledger";
const MAX_NOTIFIED_IDS = 2000;

/** Event types that should trigger an `escrowUpdated` DOM event */
const STATE_CHANGING_EVENTS = new Set([
  EVENT_TYPES.WORK_STARTED,
  EVENT_TYPES.MILESTONE_SUBMITTED,
  EVENT_TYPES.MILESTONE_APPROVED,
  EVENT_TYPES.MILESTONE_REJECTED,
  EVENT_TYPES.MILESTONE_DISPUTED,
  EVENT_TYPES.DISPUTE_RESOLVED,
  EVENT_TYPES.FREELANCER_ACCEPTED,
  EVENT_TYPES.ESCROW_COMPLETED,
  EVENT_TYPES.ESCROW_REFUNDED,
  EVENT_TYPES.ESCROW_CANCELLED,
  EVENT_TYPES.ASSIGNMENT_DECLINED,
  EVENT_TYPES.JOB_REOPENED,
  EVENT_TYPES.DEADLINE_EXTENDED,
  EVENT_TYPES.OVERDUE_DISPUTE_RAISED,
  EVENT_TYPES.OVERDUE_RESOLVED,
  EVENT_TYPES.MILESTONE_PROPOSAL_SUBMITTED,
  EVENT_TYPES.MILESTONE_PROPOSAL_APPROVED,
  EVENT_TYPES.MILESTONE_PROPOSAL_REJECTED,
  EVENT_TYPES.JOB_FUNDS_UPDATED,
  EVENT_TYPES.JOB_MANAGER_SET,
  EVENT_TYPES.JOB_MANAGER_REVOKED,
]);

// ─── Dedup helpers ────────────────────────────────────────────────────────────

// All bookkeeping is PER WALLET. It used to be shared by every wallet in the
// browser: an event seen while one wallet was connected counted as "already
// notified" for every other wallet, so switching wallets lost notifications.

function getNotifiedIds(wallet: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${NOTIFIED_KEY}_${wallet}`);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set<string>();
  }
}

function markNotified(wallet: string, ids: string[]): void {
  if (ids.length === 0) return;
  const existing = getNotifiedIds(wallet);
  ids.forEach((id) => existing.add(id));
  const arr = Array.from(existing).slice(-MAX_NOTIFIED_IDS);
  try {
    localStorage.setItem(`${NOTIFIED_KEY}_${wallet}`, JSON.stringify(arr));
  } catch {
    // storage full or blocked: worst case a notification repeats
  }
}

/**
 * The ledger after which this wallet should hear about events. Set the first
 * time the wallet is seen in this browser, so its old history isn't replayed —
 * but anything that happens after that is delivered, even if it happened
 * while a different wallet was connected.
 */
function getNotifySince(wallet: string, fallback: number): number {
  const key = `${SINCE_KEY}_${wallet}`;
  try {
    const stored = localStorage.getItem(key);
    if (stored) return Number(stored);
    localStorage.setItem(key, String(fallback));
  } catch {
    // no storage: notify from now
  }
  return fallback;
}

// ─── Topic helpers ────────────────────────────────────────────────────────────

function getEscrowIdFromTopics(topics: unknown[]): string | null {
  // Convention: topics[1] is typically the escrow ID (number)
  const raw = topics[1];
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "string" && !isNaN(Number(raw))) return raw;
  return null;
}

function getMilestoneIndexFromTopics(topics: unknown[]): number | null {
  const raw = topics[2];
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && !isNaN(Number(raw))) return Number(raw);
  return null;
}

/**
 * Is this wallet someone the event is addressed to?
 *
 * The contract puts the party to notify in the topics (never the actor, so
 * nobody is notified of their own action). Events that concern both parties,
 * such as `escrow_completed` or `dispute_resolved`, carry the second one in
 * the data map under one of these keys.
 */
const SECOND_PARTY_KEYS = ["depositor", "beneficiary"] as const;

function isAddressedTo(address: string, event: IndexedEvent): boolean {
  // Skip topics[0] (event name symbol) — check the rest
  if (event.topics.slice(1).some((t) => t === address)) return true;
  const value = event.value;
  if (value && typeof value === "object") {
    const data = value as Record<string, unknown>;
    return SECOND_PARTY_KEYS.some((key) => data[key] === address);
  }
  return false;
}

// ─── Notification builder ─────────────────────────────────────────────────────

function buildNotification(
  event: IndexedEvent,
): ReturnType<typeof createEscrowNotification> | null {
  const escrowId = getEscrowIdFromTopics(event.topics) ?? "?";
  const milestoneIdx = getMilestoneIndexFromTopics(event.topics);

  switch (event.eventType) {
    case EVENT_TYPES.ESCROW_CREATED:
      return createEscrowNotification("created", escrowId);

    case EVENT_TYPES.WORK_STARTED:
      return createEscrowNotification("work_started", escrowId);

    case EVENT_TYPES.ESCROW_COMPLETED:
      return createEscrowNotification("completed", escrowId);

    case EVENT_TYPES.ESCROW_REFUNDED:
      return createEscrowNotification("refunded", escrowId);

    case EVENT_TYPES.MILESTONE_SUBMITTED:
      if (milestoneIdx === null) return null;
      return createMilestoneNotification("submitted", escrowId, milestoneIdx);

    case EVENT_TYPES.MILESTONE_APPROVED:
      if (milestoneIdx === null) return null;
      return createMilestoneNotification("approved", escrowId, milestoneIdx);

    case EVENT_TYPES.MILESTONE_REJECTED:
      if (milestoneIdx === null) return null;
      return createMilestoneNotification("rejected", escrowId, milestoneIdx);

    case EVENT_TYPES.MILESTONE_DISPUTED:
      if (milestoneIdx === null) return null;
      return createMilestoneNotification("disputed", escrowId, milestoneIdx);

    case EVENT_TYPES.DISPUTE_RESOLVED:
      if (milestoneIdx !== null) {
        return {
          type: "dispute",
          title: "Dispute Resolved",
          message: `The dispute for milestone ${milestoneIdx + 1} on escrow #${escrowId} has been resolved`,
          actionUrl: `/dashboard?escrow=${escrowId}`,
          data: { escrowId, milestoneIndex: milestoneIdx },
        };
      }
      return null;

    case EVENT_TYPES.APPLICATION_SUBMITTED:
      return {
        type: "application",
        title: "New Application",
        message: `Someone applied to escrow #${escrowId}`,
        actionUrl: `/dashboard?escrow=${escrowId}`,
        data: { escrowId },
      };

    case EVENT_TYPES.FREELANCER_ACCEPTED:
      return {
        type: "application",
        title: "Application Accepted!",
        message: `You have been accepted for escrow #${escrowId}`,
        actionUrl: `/freelancer?escrow=${escrowId}`,
        data: { escrowId },
      };

    case EVENT_TYPES.ESCROW_CANCELLED:
      return {
        type: "escrow",
        title: "Job Cancelled",
        message: `The client cancelled escrow #${escrowId} before work started`,
        actionUrl: `/freelancer?escrow=${escrowId}`,
        data: { escrowId },
      };

    case EVENT_TYPES.ASSIGNMENT_DECLINED:
      return {
        type: "application",
        title: "Assignment Declined",
        message: `The freelancer declined escrow #${escrowId}. You can name someone else, reopen it, or cancel.`,
        actionUrl: `/dashboard?escrow=${escrowId}`,
        data: { escrowId },
      };

    case EVENT_TYPES.DEADLINE_EXTENDED:
      return {
        type: "escrow",
        title: "Deadline Extended",
        message: `The client extended the deadline on escrow #${escrowId}`,
        actionUrl: `/freelancer?escrow=${escrowId}`,
        data: { escrowId },
      };

    case EVENT_TYPES.OVERDUE_DISPUTE_RAISED:
      return {
        type: "dispute",
        title: "Overdue Dispute Raised",
        message: `Escrow #${escrowId} passed its deadline and was sent to an arbiter`,
        actionUrl: `/dashboard?escrow=${escrowId}`,
        data: { escrowId },
      };

    case EVENT_TYPES.OVERDUE_RESOLVED:
      return {
        type: "dispute",
        title: "Overdue Dispute Resolved",
        message: `An arbiter settled escrow #${escrowId}`,
        actionUrl: `/dashboard?escrow=${escrowId}`,
        data: { escrowId },
      };

    case EVENT_TYPES.MILESTONE_PROPOSAL_SUBMITTED:
      if (milestoneIdx === null) return null;
      return {
        type: "milestone",
        title: "Milestone Change Proposed",
        message: `The freelancer proposed a change to milestone ${milestoneIdx + 1} on escrow #${escrowId}`,
        actionUrl: `/dashboard?escrow=${escrowId}`,
        data: { escrowId, milestoneIndex: milestoneIdx },
      };

    case EVENT_TYPES.MILESTONE_PROPOSAL_APPROVED:
    case EVENT_TYPES.MILESTONE_PROPOSAL_REJECTED: {
      if (milestoneIdx === null) return null;
      const accepted =
        event.eventType === EVENT_TYPES.MILESTONE_PROPOSAL_APPROVED;
      return {
        type: "milestone",
        title: accepted ? "Proposal Accepted" : "Proposal Declined",
        message: `The client ${accepted ? "accepted" : "declined"} your change to milestone ${milestoneIdx + 1} on escrow #${escrowId}`,
        actionUrl: `/freelancer?escrow=${escrowId}`,
        data: { escrowId, milestoneIndex: milestoneIdx },
      };
    }

    case EVENT_TYPES.JOB_MANAGER_SET:
      return {
        type: "escrow",
        title: "You're Managing a Job",
        message: `You were appointed to manage escrow #${escrowId}`,
        actionUrl: `/dashboard?escrow=${escrowId}`,
        data: { escrowId },
      };

    default:
      return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EventPoller() {
  const { wallet } = useWeb3();
  const { addNotification } = useNotifications();

  useEffect(() => {
    if (!wallet.address) return;

    const dispatchRefresh = () =>
      window.dispatchEvent(new CustomEvent("escrowUpdated"));

    const poll = async () => {
      if (document.visibilityState === "hidden") return;

      const me = wallet.address!;
      let newEvents: IndexedEvent[];
      try {
        newEvents = await syncEvents();
      } catch {
        return;
      }

      // Judge against everything indexed, not just this poll's batch: events
      // fetched while another wallet was connected still count for this one.
      const stored = getStoredEvents();
      const newestLedger = stored.reduce((m, e) => Math.max(m, e.ledger), 0);
      // A wallet seen for the first time catches up on its last day, so a
      // job application that landed while it wasn't connected still shows.
      const ONE_DAY_LEDGERS = 17_280;
      const since = getNotifySince(
        me,
        Math.max(0, newestLedger - ONE_DAY_LEDGERS),
      );
      const notifiedIds = getNotifiedIds(me);
      const toNotify: string[] = [];
      let needsRefresh = newEvents.some((e) =>
        STATE_CHANGING_EVENTS.has(e.eventType as never),
      );

      // Applicants who weren't picked: the contract addresses
      // freelancer_accepted to the hired freelancer only, and escrow_cancelled
      // to nobody on an open job. Anyone else who applied learns from their
      // applications index, read lazily — only when such an event is pending.
      let myApplications: Set<number> | null = null;
      const appliedTo = async (escrowId: string | null) => {
        if (escrowId === null) return false;
        if (!myApplications) {
          myApplications = new Set(
            await contractService
              .getFreelancerApplicationIds(me)
              .catch(() => [] as number[]),
          );
        }
        return myApplications.has(Number(escrowId));
      };

      for (const event of stored) {
        if (event.ledger <= since || notifiedIds.has(event.id)) continue;

        if (
          (event.eventType === EVENT_TYPES.FREELANCER_ACCEPTED ||
            event.eventType === EVENT_TYPES.ESCROW_CANCELLED) &&
          !isAddressedTo(me, event) &&
          (await appliedTo(getEscrowIdFromTopics(event.topics)))
        ) {
          const escrowId = getEscrowIdFromTopics(event.topics);
          const filled = event.eventType === EVENT_TYPES.FREELANCER_ACCEPTED;
          addNotification({
            type: "application",
            title: filled ? "Position Filled" : "Job Cancelled",
            message: filled
              ? `The client hired another freelancer for job #${escrowId}. Thanks for applying!`
              : `The client cancelled job #${escrowId}, which you applied to.`,
            actionUrl: "/freelancer?tab=applications",
            data: { escrowId },
          });
          toNotify.push(event.id);
          needsRefresh = true;
          continue;
        }

        // A change of manager is addressed to the manager, but the freelancer
        // on the job is the one whose work will now be judged by someone
        // else — so they hear about it too, and in plain terms when the new
        // manager is Autopilot.
        if (
          (event.eventType === EVENT_TYPES.JOB_MANAGER_SET ||
            event.eventType === EVENT_TYPES.JOB_MANAGER_REVOKED) &&
          event.topics[2] !== me
        ) {
          const escrowId = getEscrowIdFromTopics(event.topics);
          const escrow =
            escrowId === null
              ? null
              : await contractService
                  .getEscrow(Number(escrowId))
                  .catch(() => null);
          if (escrow?.freelancer === me) {
            const info = await getAutopilotInfo();
            const isAutopilot = !!info?.agent && event.topics[2] === info.agent;
            const set = event.eventType === EVENT_TYPES.JOB_MANAGER_SET;
            addNotification({
              type: "escrow",
              title: set
                ? isAutopilot
                  ? "Autopilot is now in charge"
                  : "Your job has a new manager"
                : isAutopilot
                  ? "Autopilot handed back"
                  : "Your client is back in charge",
              message: set
                ? isAutopilot
                  ? `The client handed job #${escrowId} to Autopilot. It reviews each delivery against the job's published criteria, explains anything to fix, and brings in a human arbiter after ${info?.maxRounds ?? 3} failed attempts.`
                  : `The client appointed a manager for job #${escrowId}. They now review and approve your deliveries.`
                : `The client took job #${escrowId} back and reviews your deliveries themselves again.`,
              actionUrl: `/freelancer?escrow=${escrowId}`,
              data: { escrowId },
            });
          }
          toNotify.push(event.id);
          needsRefresh = true;
          continue;
        }

        if (!isAddressedTo(me, event)) continue;
        // escrow_created lists the creator too (topics[2]); they already got
        // a local notification when they created it.
        if (
          event.eventType === EVENT_TYPES.ESCROW_CREATED &&
          event.topics[2] === me
        ) {
          toNotify.push(event.id);
          continue;
        }

        const notification = buildNotification(event);
        if (notification) addNotification(notification);
        toNotify.push(event.id);
        if (STATE_CHANGING_EVENTS.has(event.eventType as never)) {
          needsRefresh = true;
        }
      }

      if (toNotify.length > 0) markNotified(me, toNotify);
      if (needsRefresh) dispatchRefresh();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void poll();
    };

    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [wallet.address, addNotification]);

  return null;
}
