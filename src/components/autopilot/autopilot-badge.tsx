import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { contractService } from "@/lib/web3/contract-service";
import { getAutopilotInfo } from "@/lib/autopilot";

/** Is Autopilot the job manager on-chain right now? Re-checked on every escrow event. */
export function useAutopilotManaged(escrowId: number | string): {
  active: boolean;
  rounds: number;
} {
  const [active, setActive] = useState(false);
  const [rounds, setRounds] = useState(3);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const [info, manager] = await Promise.all([
        getAutopilotInfo(),
        contractService.getJobManager(Number(escrowId)).catch(() => null),
      ]);
      if (cancelled) return;
      setActive(!!info?.agent && manager === info.agent);
      if (info) setRounds(info.maxRounds);
    };
    void check();
    const onUpdate = () => void check();
    window.addEventListener("escrowUpdated", onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener("escrowUpdated", onUpdate);
    };
  }, [escrowId]);

  return { active, rounds };
}

/**
 * Shown on a delivered milestone while Autopilot is the one reviewing it, so
 * neither side stares at a static "submitted" and wonders if anything is
 * happening. Renders nothing on jobs Autopilot isn't running.
 */
export function AutopilotReviewing({
  escrowId,
  audience,
}: {
  escrowId: number | string;
  audience: "client" | "freelancer";
}) {
  const { active } = useAutopilotManaged(escrowId);
  if (!active) return null;
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2 text-sm">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-500" />
      <span>
        <span className="font-medium text-amber-600 dark:text-amber-300">
          Autopilot is reviewing {audience === "freelancer" ? "your" : "this"}{" "}
          delivery
        </span>
        <span className="text-muted-foreground">
          {" "}
          against the job&apos;s criteria — usually within a minute.
          {audience === "freelancer"
            ? " You'll get a notification with the result."
            : " It approves and pays, or sends it back with feedback."}
        </span>
      </span>
    </div>
  );
}

/**
 * Amber pill shown to the freelancer while Autopilot is managing their job.
 * Read from the chain (who the job manager is), so it is right even when the
 * Autopilot service is unreachable, and re-checked whenever an escrow event
 * lands — handing over and taking back both emit one.
 */
export function AutopilotBadge({ escrowId }: { escrowId: number | string }) {
  const { active, rounds } = useAutopilotManaged(escrowId);
  if (!active) return null;
  return (
    <span
      title={`The client handed this job to Autopilot. It reviews each delivery against the job's criteria, explains what to fix, and brings in a human arbiter after ${rounds} failed attempts.`}
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-300"
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
      </span>
      Autopilot in charge
    </span>
  );
}
