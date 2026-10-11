import { useCallback, useEffect, useState } from "react";
import { Gift, Loader2, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useWeb3 } from "@/contexts/web3-context";
import { contractService, type YieldInfo } from "@/lib/web3/contract-service";
import { translateContractError } from "@/lib/web3/contract-errors";

const ACTIVE = new Set(["pending", "active", "disputed"]);
const FINISHED = new Set(["completed", "refunded", "cancelled", "expired"]);

/** XLM with enough decimals that a few stroops of interest still show. */
function xlm(stroops: bigint): string {
  const n = Number(stroops) / 1e7;
  if (n === 0) return "0";
  if (Math.abs(n) < 0.01) return n.toFixed(7).replace(/0+$/, "");
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/**
 * Idle funds earning in Blend, Stellar's lending market.
 *
 * The client opts in per job; unpaid budget is supplied to the pool and comes
 * back to cash before any payment, so payouts never wait on interest. When the
 * job is finished, the yield is claimed: the freelancer's share on a completed
 * job, the rest to the client.
 */
export function YieldPanel({
  escrowId,
  status,
  isClient,
  isFreelancer,
}: {
  escrowId: number;
  status: string;
  isClient: boolean;
  isFreelancer: boolean;
}) {
  const { wallet } = useWeb3();
  const { toast } = useToast();
  const [info, setInfo] = useState<YieldInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setInfo(await contractService.getYieldInfo(escrowId));
  }, [escrowId]);

  useEffect(() => {
    void refresh();
    const onUpdate = () => void refresh();
    window.addEventListener("escrowUpdated", onUpdate);
    return () => window.removeEventListener("escrowUpdated", onUpdate);
  }, [refresh]);

  // While money is earning, let the number move.
  useEffect(() => {
    if (!info?.optedIn) return;
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [info?.optedIn, refresh]);

  if (!info) return null;
  const active = ACTIVE.has(status);
  const finished = FINISHED.has(status);
  const accrued =
    info.value > info.principal ? info.value - info.principal : 0n;
  const soFar = info.earned + accrued;
  const freelancerPct = info.freelancerShareBp / 100;

  const act = async (
    label: string,
    run: () => Promise<string>,
    done: { title: string; description: string },
  ) => {
    setBusy(true);
    try {
      await run();
      toast(done);
      await refresh();
      window.dispatchEvent(new CustomEvent("escrowUpdated"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        title: `${label} didn't go through`,
        description: /reject|denied|cancel/i.test(msg)
          ? "You declined in your wallet. Nothing changed."
          : translateContractError(msg),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  // Finished with yield waiting: either party can pay it out.
  if (finished && info.earned > 0n && (isClient || isFreelancer)) {
    const toFreelancer =
      status === "completed"
        ? (info.earned * BigInt(info.freelancerShareBp)) / 10_000n
        : 0n;
    const toClient = info.earned - toFreelancer;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.07] p-4">
        <div className="flex items-start gap-3">
          <Gift className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
          <div className="text-sm">
            <p className="font-semibold text-emerald-600 dark:text-emerald-400">
              {xlm(info.earned)} XLM of yield is ready
            </p>
            <p className="text-muted-foreground">
              Client {xlm(toClient)} XLM
              {toFreelancer > 0n &&
                ` · Freelancer ${xlm(toFreelancer)} XLM (${freelancerPct}% bonus)`}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          disabled={busy}
          className="bg-emerald-600 text-white hover:bg-emerald-500"
          onClick={() =>
            act(
              "Claim",
              () => contractService.claimYield(escrowId, wallet.address!),
              {
                title: "Yield paid out",
                description: "It's been sent to the client and freelancer.",
              },
            )
          }
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Claim yield
        </Button>
      </div>
    );
  }

  // Earning now.
  if (info.optedIn && active) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.07] p-4">
        <div className="flex items-start gap-3">
          <span className="relative mt-1.5 flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <div className="text-sm">
            <p className="font-semibold text-emerald-600 dark:text-emerald-400">
              {info.principal > 0n
                ? `${xlm(info.principal)} XLM earning in Blend`
                : "Earning paused for a moment"}
              <span className="font-normal text-muted-foreground">
                {" "}
                · +{xlm(soFar)} XLM so far
              </span>
            </p>
            <p className="text-muted-foreground">
              {info.principal > 0n
                ? "Funds come back to cash before any payment, so payouts are never held up by interest. Yield is paid out when the job is finished."
                : "A payment just went out; the rest of the budget is reinvested shortly."}
            </p>
          </div>
        </div>
        {isClient && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              act(
                "Stopping",
                () =>
                  contractService.setYieldOptIn(
                    escrowId,
                    false,
                    wallet.address!,
                  ),
                {
                  title: "Funds back in escrow",
                  description:
                    "The budget is held in cash again. Yield earned so far is kept for the job.",
                },
              )
            }
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Stop earning
          </Button>
        )}
      </div>
    );
  }

  // The offer, to the client of a live job.
  if (isClient && active && info.available && !info.optedIn) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-4">
        <div className="flex items-start gap-3">
          <Sprout className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
          <div className="text-sm">
            <p className="font-semibold">Earn on idle funds</p>
            <p className="text-muted-foreground">
              While the budget waits for milestones it can earn interest in
              Blend, Stellar's lending market. It always comes back to cash
              before any payment. You keep {100 - freelancerPct}% of the
              interest; the freelancer gets {freelancerPct}% when the job is
              completed.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          disabled={busy}
          className="bg-emerald-600 text-white hover:bg-emerald-500"
          onClick={() =>
            act(
              "Starting",
              () =>
                contractService.setYieldOptIn(escrowId, true, wallet.address!),
              {
                title: "Your budget is earning",
                description:
                  "Unpaid funds are now in Blend and come back before every payment.",
              },
            )
          }
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sprout className="mr-2 h-4 w-4" />
          )}
          Start earning
        </Button>
      </div>
    );
  }

  return null;
}
