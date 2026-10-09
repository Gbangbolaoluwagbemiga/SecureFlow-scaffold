import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Clock,
  ListChecks,
  Loader2,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { contractService } from "@/lib/web3/contract-service";
import { translateContractError } from "@/lib/web3/contract-errors";
import {
  approveHandover,
  nudgeAutopilot,
  previewCriteria,
  type AutopilotInfo,
} from "@/lib/autopilot";

const WINDOWS = [
  { label: "15 min", minutes: 15 },
  { label: "1 hour", minutes: 60 },
  { label: "6 hours", minutes: 360 },
  { label: "1 day", minutes: 1440 },
  { label: "3 days", minutes: 4320 },
];

type Step = "idle" | "signing" | "appointing";

/**
 * One criterion, shown as the full sentence it is. It reads like text and
 * edits in place: the box wraps and grows with what's typed, so a long
 * criterion is never cut off mid-word the way a one-line input cut it.
 */
function CriterionRow({
  index,
  value,
  disabled,
  canRemove,
  autoFocus,
  onChange,
  onRemove,
}: {
  index: number;
  value: string;
  disabled: boolean;
  canRemove: boolean;
  autoFocus: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <div className="group flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 transition focus-within:border-amber-500/60 focus-within:bg-amber-500/[0.04] hover:border-border">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[11px] font-semibold text-amber-600 dark:text-amber-300">
        {index + 1}
      </span>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        disabled={disabled}
        placeholder="Something the delivered work must do or contain"
        aria-label={`Criterion ${index + 1}`}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60 disabled:opacity-70"
      />
      <button
        type="button"
        aria-label={`Remove criterion ${index + 1}`}
        disabled={disabled || !canRemove}
        onClick={onRemove}
        className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-60 transition hover:bg-muted hover:text-foreground group-hover:opacity-100 disabled:hidden"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function HandoverDialog({
  open,
  onOpenChange,
  escrowId,
  client,
  hasFreelancer,
  milestones,
  info,
  onHandedOver,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  escrowId: number;
  client: string;
  hasFreelancer: boolean;
  milestones: { description: string; amount: string }[];
  info: AutopilotInfo;
  onHandedOver: () => void;
}) {
  const { toast } = useToast();
  const [criteria, setCriteria] = useState<string[] | null>(null);
  const [conflict, setConflict] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [step, setStep] = useState<Step>("idle");

  useEffect(() => {
    if (!open || criteria) return;
    setLoadError(null);
    previewCriteria(escrowId)
      .then((p) => {
        setCriteria(p.criteria);
        setConflict(p.titleConflict);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [open, escrowId, criteria]);

  const busy = step !== "idle";
  const cleaned = (criteria ?? []).map((c) => c.trim()).filter(Boolean);

  const handOver = async () => {
    if (!info.agent || cleaned.length === 0) return;
    try {
      setStep("signing");
      await approveHandover({
        escrowId,
        windowMinutes,
        criteria: cleaned,
        client,
      });
      setStep("appointing");
      await contractService.setJobManager(escrowId, info.agent, client);
      nudgeAutopilot(escrowId);
      toast({
        title: "Autopilot is running this job",
        description: hasFreelancer
          ? "It will review each delivery against your criteria."
          : `Applications stay open for ${
              WINDOWS.find((w) => w.minutes === windowMinutes)?.label ??
              `${windowMinutes} min`
            }, then it hires the strongest applicant.`,
      });
      onOpenChange(false);
      onHandedOver();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        title: "Hand-over didn't finish",
        description: /reject|denied|cancel/i.test(msg)
          ? "You declined in your wallet. Nothing changed."
          : translateContractError(msg),
        variant: "destructive",
      });
    } finally {
      setStep("idle");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">
            Hand this job to Autopilot?
          </DialogTitle>
          <DialogDescription>
            {hasFreelancer
              ? "It reviews each delivery and releases payment against what is written below — the only thing it judges by."
              : "It picks the freelancer, reviews each delivery and releases payment against what is written below — the only thing it judges by."}{" "}
            You keep the money, the dispute right, and the ability to take the
            job back at any moment.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            It pays out in these stages
          </h4>
          <div className="flex flex-wrap gap-2">
            {milestones.map((m, i) => (
              <span
                key={i}
                title={m.description}
                className="rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-600 dark:text-amber-300"
              >
                {i + 1}. {(Number(m.amount) / 1e7).toFixed(2)} XLM
              </span>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            <ListChecks className="h-3.5 w-3.5" /> It approves or rejects
            against
          </h4>

          {conflict && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" /> Your title and description
                ask for different things
              </p>
              <p className="mt-1 text-muted-foreground">{conflict}</p>
              <p className="mt-1 text-muted-foreground">
                The criteria below follow your description. Edit them if that's
                the wrong way round.
              </p>
            </div>
          )}

          {!criteria && !loadError && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Autopilot is reading
              your job and writing its criteria…
            </div>
          )}
          {loadError && (
            <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
              {loadError}{" "}
              <button
                className="underline"
                onClick={() => {
                  setLoadError(null);
                  setCriteria(null);
                }}
              >
                Try again
              </button>
            </div>
          )}
          {criteria && (
            <div className="space-y-1.5">
              {criteria.map((c, i) => (
                <CriterionRow
                  key={i}
                  index={i}
                  value={c}
                  disabled={busy}
                  canRemove={criteria.length > 1}
                  autoFocus={c === "" && i === criteria.length - 1}
                  onChange={(v) =>
                    setCriteria(criteria.map((x, j) => (j === i ? v : x)))
                  }
                  onRemove={() =>
                    setCriteria(criteria.filter((_, j) => j !== i))
                  }
                />
              ))}
              {criteria.length < 10 && (
                <button
                  disabled={busy}
                  onClick={() => setCriteria([...criteria, ""])}
                  className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-border/70 py-2 text-xs text-muted-foreground transition hover:border-amber-500/50 hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" /> Add a criterion
                </button>
              )}
              <p className="text-xs text-muted-foreground">
                Click any criterion to edit it. Freelancers see these on the job
                before they apply.
              </p>
            </div>
          )}
        </section>

        {!hasFreelancer && (
          <section className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              <Clock className="h-3.5 w-3.5" /> Leave applications open for
            </h4>
            <div className="flex flex-wrap gap-2">
              {WINDOWS.map((w) => (
                <button
                  key={w.minutes}
                  disabled={busy}
                  onClick={() => setWindowMinutes(w.minutes)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    windowMinutes === w.minutes
                      ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-300"
                      : "hover:border-amber-500/50"
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              When the window closes it scores every applicant side by side and
              hires the strongest one scoring {info.hireThreshold}+ out of 100.
            </p>
          </section>
        )}

        <ul className="space-y-1.5 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          {!hasFreelancer && (
            <li className="flex gap-2">
              <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-500" />
              Identity-verified freelancers get a +{info.verifiedEdge} edge in
              the ranking.
            </li>
          )}
          <li className="flex gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-amber-500" />
            Work that misses the bar is sent back with exact feedback. After{" "}
            {info.maxRounds} failed attempts on a milestone it opens a dispute
            for a human arbiter.
          </li>
        </ul>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Not yet
          </Button>
          <Button
            disabled={busy || cleaned.length === 0}
            onClick={handOver}
            className="bg-amber-500 text-black hover:bg-amber-400"
          >
            {step === "signing" && (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sign in your
                wallet…
              </>
            )}
            {step === "appointing" && (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Appointing
                on-chain…
              </>
            )}
            {step === "idle" && "Hand it over"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
