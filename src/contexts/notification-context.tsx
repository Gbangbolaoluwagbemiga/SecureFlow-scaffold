import {
  createContext,
  use,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useWeb3 } from "./web3-context";
import { useToast } from "@/hooks/use-toast";
import {
  getNotifications,
  isApiConfigured,
  patchNotificationRead,
  postNotification,
  notificationIdIsRemote,
  type RemoteNotificationRow,
} from "@/lib/api";

/**
 * One notification per happening. An on-chain action reaches the other party
 * twice: the actor's app posts it through the API, and the recipient's own
 * event poller turns the contract event into a notification. Both say the
 * same thing about the same escrow and milestone within moments of each
 * other, so they collapse into one; the API copy wins because its read state
 * syncs across devices.
 */
const DUPLICATE_WINDOW_MS = 5 * 60_000;

function notificationKey(n: Notification): string {
  const d = (n.data ?? {}) as Record<string, unknown>;
  return [n.title, d.escrowId ?? "", d.milestoneIndex ?? ""]
    .map(String)
    .join("|");
}

function collapseDuplicates(list: Notification[]): Notification[] {
  const isLocal = (n: Notification) => n.id.startsWith("notification_");
  // Remote first, so it is the copy that survives.
  const ordered = [...list].sort(
    (a, b) => Number(isLocal(a)) - Number(isLocal(b)),
  );
  const kept: Notification[] = [];
  const seen = new Map<string, number[]>();
  for (const n of ordered) {
    const key = notificationKey(n);
    const t = n.timestamp.getTime();
    const times = seen.get(key) ?? [];
    if (times.some((other) => Math.abs(other - t) <= DUPLICATE_WINDOW_MS)) {
      continue;
    }
    times.push(t);
    seen.set(key, times);
    kept.push(n);
  }
  return kept.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

function mergeRemoteNotifications(
  remote: RemoteNotificationRow[],
  localState: Notification[],
): Notification[] {
  const fromRemote: Notification[] = remote.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    message: r.message,
    read: r.read,
    timestamp: new Date(r.timestamp),
    actionUrl: r.actionUrl,
    data: r.data as Record<string, unknown> | undefined,
  }));
  const legacy = localState.filter((n) => n.id.startsWith("notification_"));
  const byId = new Map<string, Notification>();
  for (const n of fromRemote) byId.set(n.id, n);
  for (const n of legacy) {
    if (!byId.has(n.id)) byId.set(n.id, n);
  }
  return collapseDuplicates(Array.from(byId.values()));
}

export interface Notification {
  id: string;
  type:
    | "milestone"
    | "dispute"
    | "escrow"
    | "application"
    | "message"
    | "rating";
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  actionUrl?: string;
  data?: Record<string, any>;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (
    notification: Omit<Notification, "id" | "timestamp" | "read">,
    targetAddresses?: string[],
    options?: { timestamp?: Date },
  ) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearNotifications: () => void;
  removeNotification: (id: string) => void;
  addCrossWalletNotification: (
    notification: Omit<Notification, "id" | "timestamp" | "read">,
    clientAddress?: string,
    freelancerAddress?: string,
  ) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(
  undefined,
);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { wallet } = useWeb3();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const lastRemoteFingerprintRef = useRef<string>("");
  const lastRemoteIdsRef = useRef<Set<string>>(new Set());

  const isCrossPartyRemoteNotification = useCallback(
    (row: RemoteNotificationRow): boolean => {
      const current = wallet.address?.toLowerCase();
      if (!current) return false;

      const source =
        (row.data?.sourceAddress as string | undefined) ||
        (row.data?.actorAddress as string | undefined) ||
        (row.data?.fromAddress as string | undefined);

      if (source && source.toLowerCase() === current) return false;

      // These types indicate escrow lifecycle changes relevant to opposite party updates.
      return (
        row.type === "milestone" ||
        row.type === "application" ||
        row.type === "escrow" ||
        row.type === "dispute"
      );
    },
    [wallet.address],
  );

  // Load notifications from localStorage on mount and when wallet changes
  useEffect(() => {
    if (wallet.isConnected && wallet.address) {
      const saved = localStorage.getItem(`notifications_${wallet.address}`);
      if (saved) {
        const parsedNotifications = JSON.parse(saved);
        // Convert timestamp strings back to Date objects
        const notificationsWithDates = parsedNotifications.map(
          (notif: any) => ({
            ...notif,
            timestamp: new Date(notif.timestamp),
          }),
        );
        setNotifications(notificationsWithDates);
      } else {
        // If no saved notifications, start with empty array
        setNotifications([]);
      }
    } else {
      // If wallet not connected, clear notifications
      setNotifications([]);
    }
  }, [wallet.isConnected, wallet.address]);

  // Persist only locally-generated rows; server-backed rows load from the API
  useEffect(() => {
    if (wallet.isConnected && wallet.address) {
      const legacy = notifications.filter((n) =>
        n.id.startsWith("notification_"),
      );
      localStorage.setItem(
        `notifications_${wallet.address}`,
        JSON.stringify(legacy),
      );
    }
  }, [notifications, wallet.isConnected, wallet.address]);

  const syncRemoteNotifications = useCallback(async () => {
    if (!wallet.address || !isApiConfigured()) return;
    try {
      const remote = await getNotifications(wallet.address);
      const prevIds = lastRemoteIdsRef.current;
      const nextIds = new Set(remote.map((r) => r.id));
      const newRows = remote.filter((r) => !prevIds.has(r.id));
      lastRemoteIdsRef.current = nextIds;

      const fingerprint = remote
        .slice(0, 8)
        .map((r) => `${r.id}:${r.read ? "1" : "0"}`)
        .join("|");
      const hasNewRemoteState =
        lastRemoteFingerprintRef.current &&
        lastRemoteFingerprintRef.current !== fingerprint;
      lastRemoteFingerprintRef.current = fingerprint;
      setNotifications((prev) => mergeRemoteNotifications(remote, prev));

      if (
        hasNewRemoteState &&
        newRows.some((row) => isCrossPartyRemoteNotification(row))
      ) {
        // Only refresh for opposite-party updates (plus slow safety poll elsewhere).
        const sourceAddress =
          (newRows[0]?.data?.sourceAddress as string | undefined) ??
          (newRows[0]?.data?.actorAddress as string | undefined);
        window.dispatchEvent(
          new CustomEvent("escrowUpdated", { detail: { sourceAddress } }),
        );
      }
    } catch {
      /* offline or API down — keep local state */
    }
  }, [wallet.address, isCrossPartyRemoteNotification]);

  useEffect(() => {
    if (!wallet.address || !isApiConfigured()) return;
    lastRemoteFingerprintRef.current = "";
    lastRemoteIdsRef.current = new Set();
    void syncRemoteNotifications();
    const t = window.setInterval(() => void syncRemoteNotifications(), 4_000);
    return () => window.clearInterval(t);
  }, [wallet.address, syncRemoteNotifications]);

  const addNotification = (
    notification: Omit<Notification, "id" | "timestamp" | "read">,
    targetAddresses?: string[], // Optional: specific addresses to notify
    // When it happened, if not now: a contract event caught up on later
    // should say "3 hours ago", not "just now".
    options?: { timestamp?: Date },
  ) => {
    const newNotification: Notification = {
      ...notification,
      id: `notification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: options?.timestamp ?? new Date(),
      read: false,
    };

    // Keep original addresses for API calls; use lowercase only for comparisons
    const targets = (targetAddresses ?? []).filter(Boolean);
    const current = wallet.address?.toLowerCase();
    const shouldNotifyCurrent =
      targets.length === 0 ||
      (current ? targets.some((a) => a.toLowerCase() === current) : false);

    if (shouldNotifyCurrent) {
      setNotifications((prev) =>
        collapseDuplicates([newNotification, ...prev]),
      );
    }

    // Send cross-wallet notifications via backend API (Supabase) so the
    // other party actually receives them regardless of browser / device.
    if (targets.length > 0) {
      targets.forEach((address) => {
        if (address && address.toLowerCase() !== current) {
          if (isApiConfigured()) {
            const outboundData = {
              ...(notification.data ?? {}),
              sourceAddress: wallet.address,
            };
            postNotification({
              wallet_address: address, // original case preserved — backend requires G-prefix
              type: notification.type,
              title: notification.title,
              message: notification.message,
              action_url: notification.actionUrl,
              data: outboundData,
            }).catch(() => {
              // Fallback: write to localStorage so the other party at least
              // sees it if they happen to share the same browser profile.
              const existing = JSON.parse(
                localStorage.getItem(`notifications_${address}`) || "[]",
              );
              localStorage.setItem(
                `notifications_${address}`,
                JSON.stringify([newNotification, ...existing]),
              );
            });
          } else {
            const existing = JSON.parse(
              localStorage.getItem(`notifications_${address}`) || "[]",
            );
            localStorage.setItem(
              `notifications_${address}`,
              JSON.stringify([newNotification, ...existing]),
            );
          }
        }
      });
    }

    // Pop a toast only for what just happened; events caught up on later
    // go quietly into the bell.
    const isFresh = Date.now() - newNotification.timestamp.getTime() < 120_000;
    if (
      shouldNotifyCurrent &&
      isFresh &&
      (notification.type === "milestone" || notification.type === "dispute")
    ) {
      toast({
        title: notification.title,
        description: notification.message,
      });
    }
  };

  const markAsRead = (id: string) => {
    if (wallet.address && notificationIdIsRemote(id)) {
      void patchNotificationRead(wallet.address, id).catch(() => {});
    }
    setNotifications((prev) =>
      prev.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification,
      ),
    );
  };

  const markAllAsRead = () => {
    setNotifications((prev) => {
      if (wallet.address && isApiConfigured()) {
        for (const n of prev) {
          if (!n.read && notificationIdIsRemote(n.id)) {
            void patchNotificationRead(wallet.address, n.id).catch(() => {});
          }
        }
      }
      return prev.map((notification) => ({ ...notification, read: true }));
    });
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  const removeNotification = (id: string) => {
    setNotifications((prev) =>
      prev.filter((notification) => notification.id !== id),
    );
  };

  const addCrossWalletNotification = (
    notification: Omit<Notification, "id" | "timestamp" | "read">,
    clientAddress?: string,
    freelancerAddress?: string,
  ) => {
    const newNotification: Notification = {
      ...notification,
      id: `notification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      read: false,
    };

    const current = wallet.address?.toLowerCase();

    // Collect all target addresses (both client and freelancer)
    const targetAddresses = [];
    if (
      clientAddress &&
      clientAddress.toLowerCase() !== wallet.address?.toLowerCase()
    ) {
      targetAddresses.push(clientAddress.toLowerCase());
    }
    if (
      freelancerAddress &&
      freelancerAddress.toLowerCase() !== wallet.address?.toLowerCase()
    ) {
      targetAddresses.push(freelancerAddress.toLowerCase());
    }

    // Only add to current wallet if it was explicitly provided as a target.
    if (
      current &&
      ((clientAddress && clientAddress.toLowerCase() === current) ||
        (freelancerAddress && freelancerAddress.toLowerCase() === current))
    ) {
      setNotifications((prev) => [newNotification, ...prev]);
    }

    // Send cross-wallet notifications via backend API (Supabase).
    targetAddresses.forEach((address) => {
      if (isApiConfigured()) {
        const outboundData = {
          ...(newNotification.data ?? {}),
          sourceAddress: wallet.address,
        };
        postNotification({
          wallet_address: address,
          type: newNotification.type,
          title: newNotification.title,
          message: newNotification.message,
          action_url: newNotification.actionUrl,
          data: outboundData,
        }).catch(() => {
          const existing = JSON.parse(
            localStorage.getItem(`notifications_${address}`) || "[]",
          );
          localStorage.setItem(
            `notifications_${address}`,
            JSON.stringify([newNotification, ...existing]),
          );
        });
      } else {
        const existing = JSON.parse(
          localStorage.getItem(`notifications_${address}`) || "[]",
        );
        localStorage.setItem(
          `notifications_${address}`,
          JSON.stringify([newNotification, ...existing]),
        );
      }
    });

    // Show toast for important notifications
    if (
      current &&
      ((clientAddress && clientAddress.toLowerCase() === current) ||
        (freelancerAddress && freelancerAddress.toLowerCase() === current)) &&
      (notification.type === "milestone" || notification.type === "dispute")
    ) {
      toast({
        title: notification.title,
        description: notification.message,
      });
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext
      value={{
        notifications,
        unreadCount,
        addNotification,
        markAsRead,
        markAllAsRead,
        clearNotifications,
        removeNotification,
        addCrossWalletNotification,
      }}
    >
      {children}
    </NotificationContext>
  );
}

export function useNotifications() {
  const context = use(NotificationContext);
  if (context === undefined) {
    throw new Error(
      "useNotifications must be used within a NotificationProvider",
    );
  }
  return context;
}

// Helper functions for common notification types
export const createMilestoneNotification = (
  action: "submitted" | "approved" | "rejected" | "disputed",
  escrowId: string,
  milestoneIndex: number,
  additionalData?: Record<string, any>,
): Omit<Notification, "id" | "timestamp" | "read"> => {
  const baseData = {
    escrowId,
    milestoneIndex,
    ...additionalData,
  };

  switch (action) {
    case "submitted":
      return {
        type: "milestone",
        title: "New Milestone Submitted",
        message: `Milestone ${milestoneIndex + 1} has been submitted for review`,
        actionUrl: `/dashboard?escrow=${escrowId}`,
        data: baseData,
      };
    case "approved":
      return {
        type: "milestone",
        title: "Milestone Approved!",
        message: `Milestone ${milestoneIndex + 1} has been approved and payment released`,
        actionUrl: `/freelancer?escrow=${escrowId}`,
        data: baseData,
      };
    case "rejected":
      return {
        type: "milestone",
        title: "Milestone Rejected",
        message: `Milestone ${milestoneIndex + 1} has been rejected. Please review and resubmit`,
        actionUrl: `/freelancer?escrow=${escrowId}`,
        data: baseData,
      };
    case "disputed":
      return {
        type: "dispute",
        title: "Milestone Disputed",
        message: `Milestone ${milestoneIndex + 1} is under dispute and requires admin review`,
        actionUrl: `/admin?escrow=${escrowId}`,
        data: baseData,
      };
    default:
      return {
        type: "milestone",
        title: "Milestone Update",
        message: `Milestone ${milestoneIndex + 1} status updated`,
        actionUrl: `/dashboard?escrow=${escrowId}`,
        data: baseData,
      };
  }
};

export const createEscrowNotification = (
  action: "created" | "completed" | "refunded" | "work_started",
  escrowId: string,
  additionalData?: Record<string, any>,
): Omit<Notification, "id" | "timestamp" | "read"> => {
  const baseData = {
    escrowId,
    ...additionalData,
  };

  switch (action) {
    case "created":
      return {
        type: "escrow",
        title: "New Escrow Created",
        message: "A new escrow has been created and is ready for work",
        actionUrl: `/dashboard?escrow=${escrowId}`,
        data: baseData,
      };
    case "completed":
      return {
        type: "escrow",
        title: "Escrow Completed!",
        message: "All milestones have been completed and payments released",
        actionUrl: `/dashboard?escrow=${escrowId}`,
        data: baseData,
      };
    case "refunded":
      return {
        type: "escrow",
        title: "Escrow Refunded",
        message: "The escrow has been refunded due to project cancellation",
        actionUrl: `/dashboard?escrow=${escrowId}`,
        data: baseData,
      };
    case "work_started":
      return {
        type: "escrow",
        title: "Work Started!",
        message: `${additionalData?.freelancerName || "Freelancer"} has started work on ${additionalData?.projectTitle || `Project #${escrowId}`}`,
        actionUrl: `/dashboard?escrow=${escrowId}`,
        data: baseData,
      };
    default:
      return {
        type: "escrow",
        title: "Escrow Update",
        message: "Escrow status has been updated",
        actionUrl: `/dashboard?escrow=${escrowId}`,
        data: baseData,
      };
  }
};

export const createApplicationNotification = (
  action: "submitted" | "approved" | "rejected",
  jobId: number,
  freelancerAddress: string,
  additionalData?: Record<string, any>,
): Omit<Notification, "id" | "timestamp" | "read"> => {
  const baseData = {
    jobId,
    freelancerAddress,
    ...additionalData,
  };

  switch (action) {
    case "submitted":
      return {
        type: "application",
        title: "New Job Application",
        message: `Someone applied to your job: ${additionalData?.jobTitle || `Job #${jobId}`}`,
        actionUrl: `/approvals?job=${jobId}`,
        data: baseData,
      };
    case "approved":
      return {
        type: "application",
        title: "Application Approved!",
        message: `Your application for ${additionalData?.jobTitle || `Job #${jobId}`} has been approved`,
        actionUrl: `/freelancer?job=${jobId}`,
        data: baseData,
      };
    case "rejected":
      return {
        type: "application",
        title: "Application Rejected",
        message: `Your application for ${additionalData?.jobTitle || `Job #${jobId}`} was not selected`,
        actionUrl: `/freelancer?job=${jobId}`,
        data: baseData,
      };
    default:
      return {
        type: "application",
        title: "Application Update",
        message: `Application status updated for ${additionalData?.jobTitle || `Job #${jobId}`}`,
        actionUrl: `/approvals?job=${jobId}`,
        data: baseData,
      };
  }
};

export const createRatingNotification = (
  action: "received",
  escrowId: number,
  additionalData?: Record<string, any>,
): Omit<Notification, "id" | "timestamp" | "read"> => {
  switch (action) {
    case "received":
    default:
      return {
        type: "rating",
        title: "New Rating Received",
        message: `You received a ${additionalData?.rating ?? "new"} star rating${
          additionalData?.review ? " with a review" : ""
        }.`,
        actionUrl: `/dashboard?escrow=${escrowId}`,
        data: {
          escrowId,
          ...additionalData,
        },
      };
  }
};
