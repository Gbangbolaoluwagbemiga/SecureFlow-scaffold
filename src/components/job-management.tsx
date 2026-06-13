import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useWeb3 } from "@/contexts/web3-context";
import { contractService } from "@/lib/web3/contract-service";
import { PlusCircle, MinusCircle, XCircle, AlertTriangle, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface MilestoneSummary {
  index: number;
  description: string;
  amount: string; // stroops string
}

interface JobManagementProps {
  escrowId: string;
  isOpenJob: boolean;
  isClient: boolean;
  totalAmount: string; // stroops string
  milestones?: MilestoneSummary[];
  onUpdate?: () => void;
}

const STROOPS = 1e7;

function stroopsToXlm(stroops: string | number): number {
  return parseFloat(String(stroops)) / STROOPS;
}

function xlmToStroops(xlm: number): string {
  return String(Math.round(xlm * STROOPS));
}

const PENALTY_TIERS = [
  { threshold: 2, pct: 0, label: "No penalty" },
  { threshold: 5, pct: 5, label: "5% penalty" },
  { threshold: 10, pct: 10, label: "10% penalty" },
  { threshold: Infinity, pct: 15, label: "15% penalty" },
];

function getPenaltyInfo(cancellations: number): { pct: number; label: string; next?: string } {
  for (const tier of PENALTY_TIERS) {
    if (cancellations <= tier.threshold) {
      const idx = PENALTY_TIERS.indexOf(tier);
      const next = PENALTY_TIERS[idx + 1];
      return {
        pct: tier.pct,
        label: tier.label,
        next: next ? `After ${tier.threshold + 1} cancellations: ${next.label}` : undefined,
      };
    }
  }
  return { pct: 15, label: "15% penalty" };
}

export function JobManagement({
  escrowId,
  isOpenJob,
  isClient,
  totalAmount,
  milestones = [],
  onUpdate,
}: JobManagementProps) {
  const { toast } = useToast();
  const { wallet, refreshBalance } = useWeb3();

  const [cancellations, setCancellations] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [addXlm, setAddXlm] = useState("");
  const [selectedAddMilestone, setSelectedAddMilestone] = useState<number | null>(
    milestones.length === 1 ? 0 : null,
  );

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawXlm, setWithdrawXlm] = useState("");
  const [selectedWithdrawMilestone, setSelectedWithdrawMilestone] = useState<number | null>(
    milestones.length === 1 ? 0 : null,
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isClient && wallet.address) {
      contractService.getUserCancellations(wallet.address).then(setCancellations).catch(() => {});
    }
  }, [isClient, wallet.address]);

  if (!isOpenJob || !isClient) return null;

  const currentXlm = stroopsToXlm(totalAmount);
  const addXlmNum = parseFloat(addXlm || "0");
  const withdrawXlmNum = parseFloat(withdrawXlm || "0");
  const penalty = getPenaltyInfo(cancellations);

  const handleAddFunds = async () => {
    if (addXlmNum <= 0) {
      toast({ title: "Invalid amount", description: "Enter a positive XLM amount.", variant: "destructive" });
      return;
    }
    if (milestones.length > 0 && selectedAddMilestone === null) {
      toast({ title: "Select a milestone", description: "Choose which milestone these funds go to.", variant: "destructive" });
      return;
    }
    if (!wallet.address) {
      toast({ title: "Wallet not connected", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      toast({ title: "Adding funds…", description: "Confirm in your wallet." });
      await contractService.addJobFunds(
        Number(escrowId),
        wallet.address,
        xlmToStroops(addXlmNum),
        selectedAddMilestone ?? 0,
      );
      toast({
        title: "Funds added",
        description:
          selectedAddMilestone !== null
            ? `${addXlmNum.toFixed(2)} XLM added to Milestone ${selectedAddMilestone + 1}.`
            : `${addXlmNum.toFixed(2)} XLM added.`,
      });
      setAddOpen(false);
      setAddXlm("");
      setSelectedAddMilestone(milestones.length === 1 ? 0 : null);
      refreshBalance().catch(() => {});
      onUpdate?.();
    } catch (error: any) {
      toast({ title: "Failed to add funds", description: friendlyError(error), variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWithdrawFunds = async () => {
    if (withdrawXlmNum <= 0) {
      toast({ title: "Invalid amount", description: "Enter a positive XLM amount.", variant: "destructive" });
      return;
    }
    if (withdrawXlmNum > currentXlm) {
      toast({ title: "Exceeds balance", description: `Cannot withdraw more than ${currentXlm.toFixed(2)} XLM.`, variant: "destructive" });
      return;
    }
    if (milestones.length > 0 && selectedWithdrawMilestone === null) {
      toast({ title: "Select a milestone", description: "Choose which milestone to reduce.", variant: "destructive" });
      return;
    }
    if (
      selectedWithdrawMilestone !== null &&
      milestones[selectedWithdrawMilestone] &&
      withdrawXlmNum > stroopsToXlm(milestones[selectedWithdrawMilestone].amount)
    ) {
      toast({
        title: "Amount too large",
        description: `Milestone ${selectedWithdrawMilestone + 1} only has ${stroopsToXlm(milestones[selectedWithdrawMilestone].amount).toFixed(2)} XLM.`,
        variant: "destructive",
      });
      return;
    }
    if (!wallet.address) {
      toast({ title: "Wallet not connected", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      toast({ title: "Withdrawing funds…", description: "Confirm in your wallet." });
      await contractService.withdrawJobFunds(
        Number(escrowId),
        wallet.address,
        xlmToStroops(withdrawXlmNum),
        selectedWithdrawMilestone ?? 0,
      );
      toast({
        title: "Funds withdrawn",
        description:
          selectedWithdrawMilestone !== null
            ? `${withdrawXlmNum.toFixed(2)} XLM removed from Milestone ${selectedWithdrawMilestone + 1}.`
            : `${withdrawXlmNum.toFixed(2)} XLM returned to your wallet.`,
      });
      setWithdrawOpen(false);
      setWithdrawXlm("");
      setSelectedWithdrawMilestone(milestones.length === 1 ? 0 : null);
      refreshBalance().catch(() => {});
      onUpdate?.();
    } catch (error: any) {
      toast({ title: "Failed to withdraw", description: friendlyError(error), variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelJob = async () => {
    if (!wallet.address) {
      toast({ title: "Wallet not connected", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      toast({ title: "Cancelling job…", description: "Confirm in your wallet." });
      await contractService.cancelJob(Number(escrowId), wallet.address);
      const penaltyXlm = (currentXlm * penalty.pct) / 100;
      toast({
        title: "Job cancelled",
        description:
          penalty.pct > 0
            ? `${(currentXlm - penaltyXlm).toFixed(2)} XLM refunded (${penalty.pct}% penalty applied).`
            : "All funds have been refunded to your wallet.",
      });
      refreshBalance().catch(() => {});
      onUpdate?.();
    } catch (error: any) {
      toast({ title: "Failed to cancel job", description: friendlyError(error), variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="glass border-primary/20 p-4 mt-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Job Management</h3>
        <span className="text-sm text-muted-foreground">
          Budget: {currentXlm.toFixed(2)} XLM
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Add Funds */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <PlusCircle className="h-4 w-4" />
              Add Funds
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[min(480px,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Funds &amp; Allocate to Milestone</DialogTitle>
              <DialogDescription>
                Choose how much to add and which milestone should receive the new funds.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="add-xlm">Amount to Add (XLM)</Label>
                <Input
                  id="add-xlm"
                  type="number"
                  step="0.0000001"
                  min="0"
                  placeholder="e.g. 100"
                  value={addXlm}
                  onChange={(e) => setAddXlm(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  New total: {(currentXlm + addXlmNum).toFixed(2)} XLM
                </p>
              </div>
              {milestones.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Allocate to Milestone</Label>
                  <div className="space-y-2 max-h-48 overflow-y-auto overflow-x-hidden pr-1">
                    {milestones.map((m) => {
                      const amt = stroopsToXlm(m.amount);
                      const selected = selectedAddMilestone === m.index;
                      return (
                        <button
                          key={m.index}
                          type="button"
                          onClick={() => setSelectedAddMilestone(m.index)}
                          className={`w-full text-left flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                            selected
                              ? "border-primary bg-primary/10 ring-1 ring-primary"
                              : "border-muted hover:border-primary/50"
                          }`}
                        >
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <div className="text-xs font-medium text-muted-foreground">Milestone {m.index + 1}</div>
                            <div className="text-sm truncate max-w-[260px]">{m.description || "—"}</div>
                          </div>
                          <div className="text-xs font-semibold whitespace-nowrap shrink-0 text-right">
                            {amt.toFixed(2)} XLM
                            {selected && addXlmNum > 0 && (
                              <span className="block text-green-600 dark:text-green-400">
                                → {(amt + addXlmNum).toFixed(2)}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex gap-2 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>Funds and the milestone amount are updated on-chain in the same transaction.</span>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={handleAddFunds} disabled={isSubmitting || addXlmNum <= 0}>
                {isSubmitting ? "Adding…" : "Add Funds"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Withdraw Funds */}
        <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <MinusCircle className="h-4 w-4" />
              Withdraw Funds
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[min(480px,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Withdraw Funds from Milestone</DialogTitle>
              <DialogDescription>
                Choose which milestone to reduce and how much to withdraw. Funds return to your wallet immediately.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {milestones.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Reduce from Milestone</Label>
                  <div className="space-y-2 max-h-48 overflow-y-auto overflow-x-hidden pr-1">
                    {milestones.map((m) => {
                      const amt = stroopsToXlm(m.amount);
                      const selected = selectedWithdrawMilestone === m.index;
                      return (
                        <button
                          key={m.index}
                          type="button"
                          onClick={() => setSelectedWithdrawMilestone(m.index)}
                          className={`w-full text-left flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                            selected
                              ? "border-primary bg-primary/10 ring-1 ring-primary"
                              : "border-muted hover:border-primary/50"
                          }`}
                        >
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <div className="text-xs font-medium text-muted-foreground">Milestone {m.index + 1}</div>
                            <div className="text-sm truncate max-w-[260px]">{m.description || "—"}</div>
                          </div>
                          <div className="text-xs font-semibold whitespace-nowrap shrink-0 text-right">
                            {amt.toFixed(2)} XLM
                            {selected && withdrawXlmNum > 0 && (
                              <span className={`block ${withdrawXlmNum > amt ? "text-red-500" : "text-amber-600 dark:text-amber-400"}`}>
                                → {Math.max(0, amt - withdrawXlmNum).toFixed(2)}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="withdraw-xlm">Amount to Withdraw (XLM)</Label>
                <Input
                  id="withdraw-xlm"
                  type="number"
                  step="0.0000001"
                  min="0"
                  max={
                    selectedWithdrawMilestone !== null && milestones[selectedWithdrawMilestone]
                      ? stroopsToXlm(milestones[selectedWithdrawMilestone].amount)
                      : currentXlm
                  }
                  placeholder="e.g. 50"
                  value={withdrawXlm}
                  onChange={(e) => setWithdrawXlm(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Remaining in escrow: {Math.max(0, currentXlm - withdrawXlmNum).toFixed(2)} XLM
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setWithdrawOpen(false)}>Cancel</Button>
              <Button
                onClick={handleWithdrawFunds}
                disabled={isSubmitting || withdrawXlmNum <= 0 || withdrawXlmNum > currentXlm}
              >
                {isSubmitting ? "Withdrawing…" : "Withdraw Funds"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Cancel Job */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="gap-2">
              <XCircle className="h-4 w-4" />
              Cancel Job
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Cancel This Job?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm">
                  <p>
                    This cancels the job and refunds your deposit to your wallet. This action cannot be undone.
                    You can only cancel before a freelancer is assigned.
                  </p>

                  {/* Penalty info */}
                  <div className={`rounded-md border px-3 py-2 ${penalty.pct > 0 ? "border-amber-400/60 bg-amber-50 dark:bg-amber-900/20" : "border-green-400/60 bg-green-50 dark:bg-green-900/20"}`}>
                    <p className={`font-medium text-xs ${penalty.pct > 0 ? "text-amber-700 dark:text-amber-300" : "text-green-700 dark:text-green-300"}`}>
                      {penalty.pct > 0
                        ? `Cancellation penalty: ${penalty.pct}% (${((currentXlm * penalty.pct) / 100).toFixed(2)} XLM forfeited)`
                        : "No penalty — full refund of funds deposited"}
                    </p>
                    {penalty.pct > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                        You will receive {(currentXlm * (1 - penalty.pct / 100)).toFixed(2)} XLM back.
                      </p>
                    )}
                    {penalty.next && (
                      <p className="text-xs text-muted-foreground mt-1">{penalty.next}</p>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    This is your {cancellations + 1}{cancellations === 0 ? "st" : cancellations === 1 ? "nd" : "rd"} cancellation.
                    Repeated cancellations increase the penalty to discourage abuse.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep Job</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleCancelJob}
                disabled={isSubmitting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isSubmitting ? "Cancelling…" : "Cancel Job"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <p className="text-xs text-muted-foreground mt-4">
        Fund management is available until a freelancer is assigned to this job.
      </p>
    </Card>
  );
}

function friendlyError(error: any): string {
  const msg: string = error?.message || String(error);
  return translateContractError(msg);
}

export function translateContractError(raw: string): string {
  const CODE_MAP: Record<number, string> = {
    1000: "Contract is already initialized.",
    1001: "Platform fee is too high (max 10%).",
    1002: "Only the contract owner can perform this action.",
    1003: "Contract is not initialized yet.",
    1100: "Escrow not found.",
    1101: "This escrow is not active.",
    1102: "Invalid escrow status for this action.",
    1103: "Work has already been started on this escrow.",
    1104: "Work has not been started yet.",
    1200: "Job creation is currently paused.",
    1201: "Invalid duration specified.",
    1202: "Milestone count does not match.",
    1203: "Too many milestones (max 10).",
    1204: "Too many arbiters specified.",
    1205: "Invalid number of required confirmations.",
    1206: "This token is not whitelisted.",
    1300: "This job is not an open job.",
    1301: "This job is closed to new applications.",
    1302: "You cannot apply to your own job.",
    1303: "Too many applications on this job.",
    1304: "Only the job creator can perform this action.",
    1305: "This freelancer has not applied to this job.",
    1306: "You have already applied to this job.",
    1400: "Invalid milestone index.",
    1401: "This milestone has already been submitted.",
    1402: "This milestone has not been submitted yet.",
    1403: "This milestone has already been processed.",
    1500: "Nothing to refund.",
    1501: "The deadline has not passed yet.",
    1502: "The emergency refund period has not been reached.",
    1503: "Cannot refund — funds are still locked.",
    1504: "Invalid deadline extension.",
    1505: "Cannot extend the deadline.",
    1600: "Only the assigned freelancer can perform this action.",
    1601: "You are not authorized to perform this action.",
    1700: "The amount entered is invalid (must be greater than zero).",
    1701: "Invalid address provided.",
    1702: "Invalid parameter.",
    1703: "Insufficient withdrawable balance for this milestone.",
    1704: "No overdue dispute request found.",
    1705: "No arbiters are available for this escrow.",
    1800: "This escrow is not completed yet.",
    1801: "A rating has already been submitted.",
    1802: "Invalid rating value (must be 1–5).",
    1803: "Only the client can submit a rating.",
    1804: "Only the freelancer can submit a rating.",
    1805: "Client rating already submitted.",
    1900: "You are not a party to this escrow.",
    1901: "Evidence CID cannot be empty.",
    2000: "The contract is currently paused. Please try again later.",
    2100: "This token is blacklisted.",
    2101: "This token is already blacklisted.",
    2200: "This milestone has already been started.",
    2201: "Milestone index is out of bounds.",
    2202: "Cannot modify a started escrow.",
    2300: "Cannot cancel a job that already has a freelancer assigned.",
    2400: "No pending proposal found for this milestone.",
    2500: "Funds are still locked in this escrow.",
    2501: "This escrow has not reached a terminal state.",
  };

  // Extract error code from "Error(Contract, #NNNN)" or "HostError: Error(Contract, #NNNN)"
  const match = raw.match(/Error\(Contract,\s*#(\d+)\)/);
  if (match) {
    const code = parseInt(match[1], 10);
    return CODE_MAP[code] ?? `Contract error #${code}. Please try again or contact support.`;
  }

  // Strip raw simulation prefix noise
  if (raw.startsWith("Simulation error: HostError:")) {
    return raw.replace("Simulation error: HostError: ", "");
  }
  if (raw.startsWith("Simulation failed:")) {
    const inner = raw.replace("Simulation failed:", "").trim();
    const m2 = inner.match(/Error\(Contract,\s*#(\d+)\)/);
    if (m2) {
      const code = parseInt(m2[1], 10);
      return CODE_MAP[code] ?? `Contract error #${code}.`;
    }
  }

  return raw || "Something went wrong. Please try again.";
}
