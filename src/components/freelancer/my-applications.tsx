import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { contractService, type EscrowData } from "@/lib/web3/contract-service";

type Outcome = "awaiting" | "hired" | "filled" | "closed";

const OUTCOME: Record<Outcome, { label: string; className: string }> = {
  awaiting: {
    label: "Awaiting client",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  hired: {
    label: "You're hired",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  filled: {
    label: "Filled by someone else",
    className: "bg-muted text-muted-foreground",
  },
  closed: {
    label: "Closed",
    className: "bg-muted text-muted-foreground",
  },
};

function outcomeFor(escrow: EscrowData, me: string): Outcome {
  if (escrow.freelancer === me) return "hired";
  if (escrow.freelancer) return "filled";
  // 5 refunded, 6 expired, 7 cancelled (see ESCROW_STATUS_NUMBER)
  if (escrow.status >= 5 || escrow.status === 2) return "closed";
  return "awaiting";
}

/**
 * Jobs this freelancer applied to and what became of each application.
 * Browse Jobs only lists jobs that are still open, so without this an
 * application vanishes from view as soon as the client hires or cancels.
 */
export function MyApplications({ wallet }: { wallet: string }) {
  const [items, setItems] = useState<EscrowData[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const ids = await contractService.getFreelancerApplicationIds(wallet);
        const escrows = await contractService.getEscrowsBatch(ids);
        if (!cancelled) setItems(escrows.reverse()); // newest first
      } catch {
        if (!cancelled) setItems((prev) => prev ?? []);
      }
    };
    void load();
    // The event poller fires this when a relevant on-chain event lands
    // (hired, filled by someone else, cancelled), so outcomes update live.
    window.addEventListener("escrowUpdated", load);
    return () => {
      cancelled = true;
      window.removeEventListener("escrowUpdated", load);
    };
  }, [wallet]);

  if (!items) return null;
  if (items.length === 0) {
    return (
      <Card className="glass border-primary/20 p-6 text-center text-sm text-muted-foreground">
        You haven't applied to any jobs yet.{" "}
        <Link to="/jobs" className="text-primary hover:underline">
          Browse open jobs
        </Link>
      </Card>
    );
  }

  return (
    <Card className="glass border-primary/20 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Send className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">My applications</h3>
        <span className="text-xs text-muted-foreground">({items.length})</span>
      </div>
      <div className="space-y-2">
        {items.map((escrow) => {
          const outcome = OUTCOME[outcomeFor(escrow, wallet)];
          return (
            <div
              key={escrow.escrow_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {escrow.project_title || `Job #${escrow.escrow_id}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(Number(escrow.amount) / 1e7).toFixed(2)} XLM · Job #
                  {escrow.escrow_id}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={outcome.className}>{outcome.label}</Badge>
                {outcomeFor(escrow, wallet) === "awaiting" && (
                  <Link
                    to="/jobs"
                    className="text-xs text-primary hover:underline"
                  >
                    View job
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
