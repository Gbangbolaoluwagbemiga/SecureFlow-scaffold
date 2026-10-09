import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  Bot,
  ChevronDown,
  ExternalLink,
  Gavel,
  Hand,
  Loader2,
  ThumbsDown,
  ThumbsUp,
  UserCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useWeb3 } from "@/contexts/web3-context";
import { contractService } from "@/lib/web3/contract-service";
import { translateContractError } from "@/lib/web3/contract-errors";
import {
  getAutopilotInfo,
  getAutopilotJob,
  type AutopilotDecision,
  type AutopilotInfo,
  type AutopilotJob,
} from "@/lib/autopilot";
import { HandoverDialog } from "./handover-dialog";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function useCountdown(until: number | null | undefined): string | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until || until <= now) return null;
  const s = Math.floor((until - now) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

const ICON: Partial<Record<AutopilotDecision["type"], typeof Bot>> = {
  applicant_scored: Users,
  hired: UserCheck,
  work_approved: ThumbsUp,
  revision_requested: ThumbsDown,
  escalated: Gavel,
  taken_back: Hand,
};

function DecisionRow({ d }: { d: AutopilotDecision }) {
  const [open, setOpen] = useState(false);
  const Icon = ICON[d.type] ?? Bot;
  const tone =
    d.type === "escalated" || d.type === "revision_requested"
      ? "text-rose-500"
      : d.type === "work_approved" || d.type === "hired"
        ? "text-emerald-500"
        : "text-amber-500";
  return (
    <li className="relative pl-7">
      <span
        className={`absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-background ring-1 ring-border ${tone}`}
      >
        <Icon className="h-3 w-3" />
      </span>
      <button
        className="w-full text-left"
        onClick={() => d.detail && setOpen(!open)}
      >
        <p className="text-sm leading-snug">
          {d.summary}
          {d.verified && (
            <BadgeCheck className="ml-1 inline h-3.5 w-3.5 text-emerald-500" />
          )}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {new Date(d.at).toLocaleString()}
          {d.detail && (
            <span className="inline-flex items-center gap-0.5">
              reasoning
              <ChevronDown
                className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`}
              />
            </span>
          )}
          {d.txHash && (
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${d.txHash}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-0.5 hover:text-foreground"
            >
              tx <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </p>
      </button>
      {open && d.detail && (
        <p className="mt-1.5 whitespace-pre-line rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
          {d.detail}
        </p>
      )}
    </li>
  );
}

/**
 * Who is running this job — the client or Autopilot — and, when it's
 * Autopilot, everything it has decided and why. Amber marks the agent's
 * actions, teal the client's own.
 */
export function AutopilotPanel({
  escrowId,
  status,
  hasFreelancer,
  milestones,
}: {
  escrowId: number;
  status: string;
  hasFreelancer: boolean;
  milestones: { description: string; amount: string }[];
}) {
  const { wallet } = useWeb3();
  const { toast } = useToast();
  const [info, setInfo] = useState<AutopilotInfo | null>(null);
  const [manager, setManager] = useState<string | null | undefined>(undefined);
  const [job, setJob] = useState<AutopilotJob | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const live =
    status === "pending" || status === "active" || status === "disputed";

  const refresh = useCallback(async () => {
    const [i, m] = await Promise.all([
      getAutopilotInfo(),
      contractService.getJobManager(escrowId).catch(() => null),
    ]);
    setInfo(i);
    setManager(m);
    if (i?.agent && m === i.agent) {
      setJob(await getAutopilotJob(escrowId).catch(() => null));
    }
  }, [escrowId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isAgent = !!info?.agent && manager === info.agent;

  // While Autopilot is working, keep the log current.
  useEffect(() => {
    if (!isAgent) return;
    const t = setInterval(() => void refresh(), 15_000);
    const onUpdate = () => void refresh();
    window.addEventListener("escrowUpdated", onUpdate);
    return () => {
      clearInterval(t);
      window.removeEventListener("escrowUpdated", onUpdate);
    };
  }, [isAgent, refresh]);

  const countdown = useCountdown(job?.phase === "hiring" ? job.closesAt : null);

  if (!live || manager === undefined) return null;

  const takeBack = async () => {
    setRevoking(true);
    try {
      await contractService.revokeJobManager(escrowId, wallet.address!);
      toast({
        title: "You're running this job again",
        description: "Autopilot has stopped. Nothing it already did is undone.",
      });
      await refresh();
      window.dispatchEvent(new CustomEvent("escrowUpdated"));
    } catch (e) {
      toast({
        title: "Couldn't take the job back",
        description: translateContractError(
          e instanceof Error ? e.message : String(e),
        ),
        variant: "destructive",
      });
    } finally {
      setRevoking(false);
    }
  };

  // A person the client appointed by address, not the agent.
  if (manager && !isAgent) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <p className="text-sm">
          <span className="font-semibold">{short(manager)}</span> is managing
          this job for you.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={revoking}
          onClick={takeBack}
        >
          {revoking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Take it back
        </Button>
      </div>
    );
  }

  if (!isAgent) {
    return (
      <>
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> YOU
            </span>
            <h4 className="mt-2 text-lg font-semibold text-primary">
              You are running this job
            </h4>
            <p className="text-sm text-muted-foreground">
              {hasFreelancer
                ? "You review and approve each milestone yourself."
                : "You choose the freelancer and approve each milestone yourself."}
            </p>
          </div>
          {info?.enabled && info.agent ? (
            <Button
              onClick={() => setDialogOpen(true)}
              className="bg-amber-500/90 text-black hover:bg-amber-400"
            >
              <Bot className="mr-2 h-4 w-4" /> Hand to Autopilot
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Autopilot is offline right now.
            </span>
          )}
        </div>
        {info?.agent && dialogOpen && (
          <HandoverDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            escrowId={escrowId}
            client={wallet.address!}
            hasFreelancer={hasFreelancer}
            milestones={milestones}
            info={info}
            onHandedOver={() => {
              void refresh();
              window.dispatchEvent(new CustomEvent("escrowUpdated"));
            }}
          />
        )}
      </>
    );
  }

  const phase = job?.phase;
  const headline =
    phase === "hiring"
      ? countdown
        ? `Taking applications — judging them in ${countdown}`
        : "Scoring applicants as they arrive"
      : phase === "working"
        ? "Freelancer hired — reviewing each delivery"
        : phase === "disputed"
          ? "Escalated — a human arbiter now decides"
          : phase === "completed"
            ? "Every milestone approved and paid"
            : "Starting up…";
  const decisions = job?.decisions ?? [];
  const shown = showAll ? decisions : decisions.slice(0, 5);

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/50 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-amber-600 dark:text-amber-300">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
            </span>
            AUTOPILOT
          </span>
          <h4 className="mt-2 text-lg font-semibold text-amber-600 dark:text-amber-300">
            Autopilot is running this job
          </h4>
          <p className="text-sm text-muted-foreground">{headline}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={revoking}
          onClick={takeBack}
        >
          {revoking ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Hand className="mr-2 h-4 w-4" />
          )}
          Take it back
        </Button>
      </div>

      {job?.criteria && job.criteria.length > 0 && (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Judging against {job.criteria.length} criteria
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            {job.criteria.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        </details>
      )}

      {decisions.length > 0 && (
        <div className="mt-4">
          <h5 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Decision log
          </h5>
          <ol className="space-y-3 border-l border-border/60 pl-0 [&>li]:-ml-px">
            {shown.map((d) => (
              <DecisionRow key={d.id} d={d} />
            ))}
          </ol>
          {decisions.length > 5 && (
            <button
              className="mt-2 text-xs text-primary hover:underline"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? "Show less" : `Show all ${decisions.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
