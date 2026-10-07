/** Local SecureFlow API default when VITE_API_URL is omitted (dev only). */
const DEFAULT_DEV_API_URL = "http://localhost:8787";

function getApiBase(): string {
  const raw = import.meta.env.VITE_API_URL as string | undefined;
  const trimmed = raw?.trim().replace(/\/$/, "") ?? "";
  if (trimmed) return trimmed;
  if (import.meta.env.DEV) return DEFAULT_DEV_API_URL;
  return "";
}

const apiSecret = () =>
  (import.meta.env.VITE_API_SECRET as string | undefined) ?? "";

function authHeaders(): HeadersInit {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = apiSecret();
  if (secret) {
    h.Authorization = `Bearer ${secret}`;
  }
  return h;
}

export function isApiConfigured(): boolean {
  return Boolean(getApiBase());
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBase();
  if (!base) {
    throw new Error("VITE_API_URL is not set (required for production builds)");
  }
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const errBody = await res.text();
    let message = res.statusText;
    try {
      const j = JSON.parse(errBody) as { error?: string };
      if (j.error) message = j.error;
    } catch {
      if (errBody) message = errBody;
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function postMilestoneSuggestions(body: {
  projectTitle: string;
  projectDescription: string;
  totalBudget: string;
  durationDays: string;
  userPrompt: string;
  milestoneIndex: number | null;
}): Promise<{ suggestions: string[] }> {
  return apiFetch("/v1/ai/milestones", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function postCoverLetterDraft(body: {
  jobTitle: string;
  jobDescription: string;
  proposedTimelineDays?: string;
  tone?: string;
  /** If provided the AI will enhance this draft rather than write from scratch */
  userDraft?: string;
}): Promise<{ coverLetter: string }> {
  return apiFetch("/v1/ai/cover-letter", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function postRewriteText(body: { text: string }): Promise<{
  text: string;
}> {
  return apiFetch("/v1/ai/rewrite", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Submit a user-signed Soroban transaction XDR to the backend which wraps it
 * in a Stellar fee-bump transaction (admin wallet pays), then submits it.
 * Used for gasless operations such as job applications.
 */
export async function submitGaslessTransaction(body: {
  signedTxXdr: string;
}): Promise<{ txHash: string }> {
  return apiFetch("/v1/gasless/apply", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type RemoteNotificationRow = {
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
  read: boolean;
  timestamp: string;
  actionUrl?: string;
  data?: Record<string, unknown>;
};

export async function getNotifications(
  wallet: string,
): Promise<RemoteNotificationRow[]> {
  const q = new URLSearchParams({ wallet });
  const json = await apiFetch<{ notifications: RemoteNotificationRow[] }>(
    `/v1/notifications?${q.toString()}`,
    { method: "GET" },
  );
  return json.notifications ?? [];
}

export async function patchNotificationRead(
  wallet: string,
  id: string,
): Promise<void> {
  const q = new URLSearchParams({ wallet });
  await apiFetch(
    `/v1/notifications/${encodeURIComponent(id)}/read?${q.toString()}`,
    {
      method: "PATCH",
    },
  );
}

export async function postNotification(body: {
  wallet_address: string;
  type:
    | "milestone"
    | "dispute"
    | "escrow"
    | "application"
    | "message"
    | "rating";
  title: string;
  message: string;
  action_url?: string;
  data?: Record<string, unknown>;
}): Promise<{ id: string }> {
  return apiFetch("/v1/notifications", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─── Messaging ──────────────────────────────────────────────────────────────

export type ChatMessage = {
  id: string;
  sender_address: string;
  recipient_address: string;
  content: string;
  read_at: string | null;
  created_at: string;
};

export type Conversation = {
  conversation_id: string;
  other_address: string;
  latest_message: string;
  latest_at: string;
  unread: number;
};

export async function sendMessage(body: {
  sender_address: string;
  recipient_address: string;
  content: string;
}): Promise<{ id: string; created_at: string }> {
  return apiFetch("/v1/messages", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getConversation(
  a: string,
  b: string,
  since?: string,
): Promise<ChatMessage[]> {
  const q = new URLSearchParams({ a, b });
  if (since) q.set("since", since);
  const json = await apiFetch<{ messages: ChatMessage[] }>(
    `/v1/messages/conversation?${q.toString()}`,
    { method: "GET" },
  );
  return json.messages ?? [];
}

export async function getInbox(wallet: string): Promise<Conversation[]> {
  const q = new URLSearchParams({ wallet });
  const json = await apiFetch<{ conversations: Conversation[] }>(
    `/v1/messages/inbox?${q.toString()}`,
    { method: "GET" },
  );
  return json.conversations ?? [];
}

export async function getUnreadMessageCount(wallet: string): Promise<number> {
  const q = new URLSearchParams({ wallet });
  const json = await apiFetch<{ count: number }>(
    `/v1/messages/unread-count?${q.toString()}`,
    { method: "GET" },
  );
  return json.count ?? 0;
}

export async function markConversationRead(
  a: string,
  b: string,
  wallet: string,
): Promise<void> {
  const q = new URLSearchParams({ a, b, wallet });
  await apiFetch(`/v1/messages/conversation/read?${q.toString()}`, {
    method: "PATCH",
  });
}

export const notificationIdIsRemote = (id: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );

export type UploadedFile = {
  url: string;
  filename: string;
  size: number;
  mimeType: string;
};

export async function uploadMilestoneFile(
  file: File,
  escrowId: string | number,
  milestoneIndex: number,
): Promise<UploadedFile> {
  const base = getApiBase();
  if (!base) throw new Error("VITE_API_URL is not set");

  const form = new FormData();
  form.append("file", file);
  form.append("escrow_id", String(escrowId));
  form.append("milestone_index", String(milestoneIndex));

  const secret = apiSecret();
  const headers: Record<string, string> = {};
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const res = await fetch(`${base}/v1/upload/milestone`, {
    method: "POST",
    body: form,
    headers,
  });

  if (!res.ok) {
    const errBody = await res.text();
    let message = res.statusText;
    try {
      const j = JSON.parse(errBody) as { error?: string };
      if (j.error) message = j.error;
    } catch {
      if (errBody) message = errBody;
    }
    throw new Error(message);
  }

  return res.json() as Promise<UploadedFile>;
}

// ─── Identity verification (Didit) ──────────────────────────────────────────

export type VerificationState =
  | "pending"
  | "approved"
  | "declined"
  | "in_review"
  | "duplicate_identity"
  | "wallet_bound"
  | "error"
  | null;

/** Start (or resume) a Didit session for this wallet. */
export async function startIdentityVerification(wallet: string): Promise<{
  verified: boolean;
  url?: string;
  sessionId?: string;
}> {
  return apiFetch("/v1/verification/session", {
    method: "POST",
    body: JSON.stringify({ wallet }),
  });
}

export async function getIdentityVerificationStatus(
  wallet: string,
): Promise<{ verified: boolean; state: VerificationState }> {
  return apiFetch(
    `/v1/verification/status?wallet=${encodeURIComponent(wallet)}`,
  );
}
