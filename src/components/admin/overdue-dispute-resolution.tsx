import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useWeb3 } from "@/contexts/web3-context";
import { useToast } from "@/hooks/use-toast";
import { useNotifications } from "@/contexts/notification-context";
import { CONTRACTS } from "@/lib/web3/config";
import { AlertTriangle, Scale, CheckCircle, Undo2, Clock } from "lucide-react";
import { motion } from "framer-motion";

interface OverdueCase {
  escrowId: string;
  projectTitle: string;
  clientAddress: string;
  freelancerAddress: string;
  requesterAddress: string;
  reason: string;
  requestedAt: number;
  totalAmount: number;
  paidAmount: number;
  unreleased: number;
}

interface Props {
  onResolved?: () => void;
}

export function OverdueDisputeResolution({ onResolved }: Props) {
  const { wallet } = useWeb3();
  const { toast } = useToast();
  const { addNotification } = useNotifications();
  const [cases, setCases] = useState<OverdueCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OverdueCase | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  /** 0 = full refund to client; 100 = full award to freelancer */
  const [freelancerPct, setFreelancerPct] = useState(0);
  const [freelancerPctInput, setFreelancerPctInput] = useState("0");

  const fetchCases = useCallback(async () => {
    if (!wallet.address) return;
    setLoading(true);
    try {
      const { ContractService } = await import("@/lib/web3/contract-service");
      const svc = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);
      const nextId = await svc.getNextEscrowId();
      const ids = Array.from(
        { length: Math.max(0, nextId - 1) },
        (_, i) => i + 1,
      );

      // An overdue request always leaves its escrow Disputed, so read every
      // escrow in batches and only ask the disputed ones, all at once.
      const escrows = (await svc.getEscrowsBatch(ids)).filter(
        (e) => e.status === 3,
      );
      const requests = await Promise.all(
        escrows.map((e) => svc.getOverdueRequest(e.escrow_id)),
      );
      const found: OverdueCase[] = [];
      escrows.forEach((escrow, k) => {
        const req = requests[k];
        if (!req) return;
        const i = escrow.escrow_id;
        const totalNum = Number(escrow.amount ?? 0);
        const paidNum = Number(escrow.paid_amount ?? 0);
        found.push({
          escrowId: i.toString(),
          projectTitle: escrow.project_title || `Project #${i}`,
          clientAddress: escrow.creator || "",
          freelancerAddress: escrow.freelancer || "",
          requesterAddress: req.requester || "",
          reason: req.reason || "",
          requestedAt: req.requested_at || 0,
          totalAmount: totalNum / 1e7,
          paidAmount: paidNum / 1e7,
          unreleased: (totalNum - paidNum) / 1e7,
        });
      });
      setCases(found);
    } catch (err) {
    } finally {
      setLoading(false);
    }
  }, [wallet.address]);

  useEffect(() => {
    void fetchCases();
  }, [fetchCases]);

  const openDialog = (c: OverdueCase) => {
    setSelected(c);
    setFreelancerPct(0);
    setFreelancerPctInput("0");
    setDialogOpen(true);
  };

  const handleResolve = async (fullRefundToClient: boolean) => {
    if (!selected || !wallet.address) return;
    setResolving(true);
    try {
      const { ContractService } = await import("@/lib/web3/contract-service");
      const svc = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);
      const unreleasedStroops = BigInt(Math.round(selected.unreleased * 1e7));

      if (fullRefundToClient) {
        await svc.arbiterApproveRefund({
          escrow_id: Number(selected.escrowId),
          arbiter: wallet.address,
        });
        toast({
          title: "Refund approved",
          description: `Full refund of ${selected.unreleased.toFixed(2)} USDC sent to client`,
        });
        // Notify client
        addNotification(
          {
            type: "escrow",
            title: "Arbitration: Full Refund",
            message: `An arbiter approved a full refund for "${selected.projectTitle}"`,
            actionUrl: `/dashboard?escrow=${selected.escrowId}`,
            data: { escrowId: selected.escrowId },
          },
          [selected.clientAddress],
        );
        // Notify freelancer
        addNotification(
          {
            type: "escrow",
            title: "Arbitration Decision",
            message: `An arbiter ruled in favour of the client on "${selected.projectTitle}"`,
            actionUrl: `/freelancer?escrow=${selected.escrowId}`,
            data: { escrowId: selected.escrowId },
          },
          [selected.freelancerAddress],
        );
      } else {
        const pct = Math.min(Math.max(freelancerPct, 0), 100);
        const freelancerStroops =
          (unreleasedStroops * BigInt(pct)) / BigInt(100);
        await svc.arbiterAwardFreelancer({
          escrow_id: Number(selected.escrowId),
          arbiter: wallet.address,
          freelancer_amount: freelancerStroops,
        });
        const freelancerAmt = (Number(freelancerStroops) / 1e7).toFixed(2);
        const clientAmt = (
          selected.unreleased -
          Number(freelancerStroops) / 1e7
        ).toFixed(2);
        toast({
          title: "Award applied",
          description: `${freelancerAmt} USDC to freelancer, ${clientAmt} USDC returned to client`,
        });
        addNotification(
          {
            type: "escrow",
            title: "Arbitration: Award",
            message: `Arbiter awarded ${freelancerAmt} USDC to you for "${selected.projectTitle}"`,
            actionUrl: `/freelancer?escrow=${selected.escrowId}`,
            data: { escrowId: selected.escrowId },
          },
          [selected.freelancerAddress],
        );
        addNotification(
          {
            type: "escrow",
            title: "Arbitration Decision",
            message: `${clientAmt} USDC returned to you, ${freelancerAmt} USDC awarded to freelancer`,
            actionUrl: `/dashboard?escrow=${selected.escrowId}`,
            data: { escrowId: selected.escrowId },
          },
          [selected.clientAddress],
        );
      }

      setDialogOpen(false);
      setSelected(null);
      await fetchCases();
      onResolved?.();
    } catch (err: any) {
      toast({
        title: "Resolution failed",
        description: err.message || "Transaction failed",
        variant: "destructive",
      });
    } finally {
      setResolving(false);
    }
  };

  if (loading) {
    return (
      <Card className="glass border-primary/20 p-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="h-4 w-4 animate-spin" />
          <span>Loading overdue disputes…</span>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-orange-500" />
          <h3 className="text-lg font-semibold">Overdue Disputes</h3>
          {cases.length > 0 && (
            <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
              {cases.length}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void fetchCases()}>
          Refresh
        </Button>
      </div>

      {cases.length === 0 ? (
        <Card className="glass border-primary/20 p-8 text-center">
          <CheckCircle className="h-10 w-10 mx-auto mb-3 text-green-500 opacity-60" />
          <p className="text-muted-foreground">No overdue disputes pending</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {cases.map((c, i) => (
            <motion.div
              key={c.escrowId}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className="glass border-orange-300/40 dark:border-orange-700/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{c.projectTitle}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Escrow #{c.escrowId} · Raised by{" "}
                        <span className="font-mono">
                          {c.requesterAddress.slice(0, 6)}…
                          {c.requesterAddress.slice(-4)}
                        </span>
                      </p>
                      {c.reason && (
                        <p className="text-xs mt-1 text-gray-600 dark:text-gray-400 line-clamp-2">
                          "{c.reason}"
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span>
                          Unreleased:{" "}
                          <strong className="text-foreground">
                            {c.unreleased.toFixed(2)} USDC
                          </strong>
                        </span>
                        <span>
                          Paid: {c.paidAmount.toFixed(2)} /{" "}
                          {c.totalAmount.toFixed(2)} USDC
                        </span>
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400"
                    onClick={() => openDialog(c)}
                  >
                    Resolve
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Resolution dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="glass-thick max-w-lg">
          <DialogHeader>
            <DialogTitle>Resolve Overdue Dispute</DialogTitle>
            <DialogDescription>
              {selected?.projectTitle} — {selected?.unreleased.toFixed(2)} USDC
              unreleased
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-5 py-2">
              <div className="rounded-lg bg-muted/30 p-3 text-sm space-y-1">
                <p>
                  <span className="text-muted-foreground">Client: </span>
                  <span className="font-mono text-xs">
                    {selected.clientAddress.slice(0, 8)}…
                    {selected.clientAddress.slice(-6)}
                  </span>
                </p>
                <p>
                  <span className="text-muted-foreground">Freelancer: </span>
                  <span className="font-mono text-xs">
                    {selected.freelancerAddress.slice(0, 8)}…
                    {selected.freelancerAddress.slice(-6)}
                  </span>
                </p>
                <p className="mt-1 text-gray-600 dark:text-gray-400">
                  "{selected.reason}"
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Freelancer's share (%){" "}
                  <span className="font-normal text-muted-foreground">
                    — remainder goes to client
                  </span>
                </Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={freelancerPctInput}
                    onChange={(e) => {
                      setFreelancerPctInput(e.target.value);
                      const n = Math.min(
                        Math.max(parseInt(e.target.value) || 0, 0),
                        100,
                      );
                      setFreelancerPct(n);
                    }}
                    className="w-24"
                  />
                  <div className="flex-1 text-sm text-muted-foreground">
                    ≈{" "}
                    <strong className="text-foreground">
                      {((selected.unreleased * freelancerPct) / 100).toFixed(2)}{" "}
                      USDC
                    </strong>{" "}
                    to freelancer ·{" "}
                    <strong className="text-foreground">
                      {(
                        selected.unreleased -
                        (selected.unreleased * freelancerPct) / 100
                      ).toFixed(2)}{" "}
                      USDC
                    </strong>{" "}
                    to client
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={resolving}
            >
              Cancel
            </Button>
            {/* Full refund to client */}
            <Button
              variant="outline"
              className="border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400"
              disabled={resolving}
              onClick={() => void handleResolve(true)}
            >
              <Undo2 className="h-4 w-4 mr-1.5" />
              Full Refund to Client
            </Button>
            {/* Split / award to freelancer */}
            <Button
              variant="destructive"
              disabled={resolving}
              onClick={() => void handleResolve(false)}
            >
              <Scale className="h-4 w-4 mr-1.5" />
              {resolving ? "Processing…" : "Apply Award"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
