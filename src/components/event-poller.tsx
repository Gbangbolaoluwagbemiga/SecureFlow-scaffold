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

import { useEffect, useRef } from "react";
import { useWeb3 } from "@/contexts/web3-context";
import {
  useNotifications,
  createEscrowNotification,
  createMilestoneNotification,
} from "@/contexts/notification-context";
import {
  syncEvents,
  IndexedEvent,
  EVENT_TYPES,
} from "@/lib/web3/event-indexer";

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000; // 60 seconds
const NOTIFIED_KEY = "secureflow_notified_event_ids";
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
]);

// ─── Dedup helpers ────────────────────────────────────────────────────────────

function getNotifiedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set<string>();
  }
}

function markNotified(ids: string[]): void {
  if (ids.length === 0) return;
  const existing = getNotifiedIds();
  ids.forEach((id) => existing.add(id));
  const arr = Array.from(existing).slice(-MAX_NOTIFIED_IDS);
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(arr));
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

function addressInTopics(address: string, topics: unknown[]): boolean {
  // Skip topics[0] (event name symbol) — check the rest
  return topics.slice(1).some((t) => t === address);
}

// ─── Notification builder ─────────────────────────────────────────────────────

function buildNotification(
  event: IndexedEvent
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

    default:
      return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EventPoller() {
  const { wallet } = useWeb3();
  const { addNotification } = useNotifications();
  const isFirstPollRef = useRef(true);

  useEffect(() => {
    if (!wallet.address) return;

    const dispatchRefresh = () =>
      window.dispatchEvent(new CustomEvent("escrowUpdated"));

    const poll = async () => {
      if (document.visibilityState === "hidden") return;

      let newEvents: IndexedEvent[];
      try {
        newEvents = await syncEvents();
      } catch {
        return;
      }

      if (newEvents.length === 0) return;

      // On first poll after connecting, don't spam notifications for old events —
      // just index them silently and dispatch a refresh.
      if (isFirstPollRef.current) {
        isFirstPollRef.current = false;
        // Still dispatch a refresh so dashboards pick up any missed state changes
        if (newEvents.some((e) => STATE_CHANGING_EVENTS.has(e.eventType as never))) {
          dispatchRefresh();
        }
        // Mark all as "already notified" so they don't fire on next poll either
        markNotified(newEvents.map((e) => e.id));
        return;
      }

      const notifiedIds = getNotifiedIds();
      const toNotify: string[] = [];
      let needsRefresh = false;

      for (const event of newEvents) {
        if (notifiedIds.has(event.id)) continue;

        // Only notify if the current user's address is involved
        if (!addressInTopics(wallet.address!, event.topics)) continue;

        const notification = buildNotification(event);
        if (notification) {
          addNotification(notification);
          toNotify.push(event.id);
        }

        if (STATE_CHANGING_EVENTS.has(event.eventType as never)) {
          needsRefresh = true;
        }
      }

      if (toNotify.length > 0) markNotified(toNotify);
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
