import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
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
import { contractService } from "@/lib/web3/contract-service";
import { translateContractError } from "@/lib/web3/contract-errors";

import { useNotifications } from "@/contexts/notification-context";
import { DisputeEvidence } from "./dispute-evidence";
import { AdminDisputeCommunication } from "./admin-dispute-communication";
import {
  AlertTriangle,
  Clock,
  User,
  DollarSign,
  Scale,
  CheckCircle,
} from "lucide-react";
import { motion } from "framer-motion";

interface Dispute {
  escrowId: string;
  milestoneIndex: number;
  disputedBy: string;
  disputeReason: string;
  disputedAt: number;
  milestoneAmount: number;
  /** Exact milestone amount in stroops, for an exact on-chain split. */
  milestoneAmountStroops: string;
  clientAddress: string;
  freelancerAddress: string;
  projectTitle: string;
  milestoneDescription: string;
}

const STROOPS_PER_TOKEN = 10_000_000;
/** Disputed, as numbered by contractService.getEscrow (not the contract enum). */
const ESCROW_STATUS_DISPUTED = 3;

/** Milestone status arrives as a number, a string, or `["Disputed"]`. */
function milestoneStatusName(status: unknown): string {
  const names = [
    "notstarted",
    "submitted",
    "approved",
    "disputed",
    "resolved",
    "rejected",
    "proposalpending",
  ];
  if (typeof status === "number") return names[status] ?? "";
  const raw = Array.isArray(status) ? status[0] : status;
  return String(raw ?? "").toLowerCase();
}

interface DisputeResolutionProps {
  onDisputeResolved: () => void;
}

export function DisputeResolution({
  onDisputeResolved,
}: DisputeResolutionProps) {
  const { wallet } = useWeb3();
  const { toast } = useToast();
  const { addCrossWalletNotification } = useNotifications();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastDisputeCount, setLastDisputeCount] = useState(0);
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [resolutionDialogOpen, setResolutionDialogOpen] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [beneficiaryAmount, setBeneficiaryAmount] = useState<number>(0);
  const [resolutionReason, setResolutionReason] = useState("");

  useEffect(() => {
    if (wallet.isConnected) {
      fetchDisputes();
    }
  }, [wallet.isConnected]);

  const fetchDisputes = async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }

      const disputes: Dispute[] = [];
      const totalEscrows = await contractService.getTotalEscrows();

      // Escrow ids start at 1. A disputed escrow always has its status set to
      // Disputed, so only those need their milestones read.
      for (let escrowId = 1; escrowId <= totalEscrows; escrowId++) {
        try {
          const escrow = await contractService.getEscrow(escrowId);
          if (!escrow || escrow.status !== ESCROW_STATUS_DISPUTED) continue;

          const milestones = await contractService.getMilestones(escrowId);
          milestones.forEach((milestone, milestoneIndex) => {
            if (milestoneStatusName(milestone.status) !== "disputed") return;
            const amountStroops = BigInt(milestone.amount ?? 0);
            disputes.push({
              escrowId: escrowId.toString(),
              milestoneIndex,
              disputedBy: String(milestone.disputed_by ?? ""),
              disputeReason: String(milestone.dispute_reason ?? ""),
              disputedAt: Number(milestone.disputed_at ?? 0),
              milestoneAmount: Number(amountStroops) / STROOPS_PER_TOKEN,
              milestoneAmountStroops: amountStroops.toString(),
              clientAddress: escrow.creator,
              freelancerAddress: escrow.freelancer ?? "Unknown",
              projectTitle: escrow.project_title || "Untitled Project",
              milestoneDescription: String(
                milestone.requirements || milestone.description || "",
              ),
            });
          });
        } catch {
          // One unreadable escrow must not hide every other dispute.
        }
      }

      setDisputes(disputes);

      // Show notification for new disputes
      if (disputes.length > lastDisputeCount && lastDisputeCount > 0) {
        const newDisputeCount = disputes.length - lastDisputeCount;
        toast({
          title: "New Disputes Detected",
          description: `${newDisputeCount} new dispute${newDisputeCount > 1 ? "s" : ""} require${newDisputeCount > 1 ? "" : "s"} your attention`,
          variant: "destructive",
        });
      }

      setLastDisputeCount(disputes.length);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch disputes",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const openResolutionDialog = (dispute: Dispute) => {
    setSelectedDispute(dispute);
    setBeneficiaryAmount(Math.floor(dispute.milestoneAmount / 2)); // Start with 50/50 split, ensure integer
    setResolutionReason("");
    setResolutionDialogOpen(true);
  };

  const resolveDispute = async () => {
    if (!selectedDispute || !wallet.address) return;
    if (!resolutionReason.trim()) {
      toast({
        title: "Reason required",
        description: "Explain the ruling; it is stored on-chain with it.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsResolving(true);

      // Split the milestone exactly: the contract requires
      // freelancer + client == milestone amount, in stroops.
      const total = BigInt(selectedDispute.milestoneAmountStroops);
      const requested = BigInt(
        Math.round(beneficiaryAmount * STROOPS_PER_TOKEN),
      );
      const freelancerStroops = requested > total ? total : requested;
      const clientStroops = total - freelancerStroops;

      const txHash = await contractService.resolveDispute(
        Number(selectedDispute.escrowId),
        selectedDispute.milestoneIndex,
        wallet.address,
        freelancerStroops.toString(),
        clientStroops.toString(),
        resolutionReason.trim(),
      );

      toast({
        title: "Dispute Resolved",
        description: `Resolution submitted. Transaction: ${txHash}`,
      });

      // Add cross-wallet notification with admin reason
      addCrossWalletNotification(
        {
          type: "dispute",
          title: "Dispute Resolved by Admin",
          message: `Dispute #${selectedDispute.escrowId} has been resolved. Admin reason: ${resolutionReason}`,
          actionUrl: `/dashboard?escrow=${selectedDispute.escrowId}`,
          data: {
            escrowId: selectedDispute.escrowId,
            milestoneIndex: selectedDispute.milestoneIndex,
            adminReason: resolutionReason,
            beneficiaryAmount: beneficiaryAmount,
          },
        },
        selectedDispute.clientAddress,
        selectedDispute.freelancerAddress,
      );

      setResolutionDialogOpen(false);
      setSelectedDispute(null);
      setResolutionReason(""); // Clear the reason
      await fetchDisputes(false); // Refresh disputes without showing loading
      onDisputeResolved();
    } catch (error: any) {
      toast({
        title: "Resolution Failed",
        description: translateContractError(
          error?.message || "Failed to resolve dispute",
        ),
        variant: "destructive",
      });
    } finally {
      setIsResolving(false);
    }
  };

  const getDisputeAge = (disputedAt: number) => {
    const now = Math.floor(Date.now() / 1000);
    const ageInSeconds = now - disputedAt;
    const ageInHours = Math.floor(ageInSeconds / 3600);
    const ageInDays = Math.floor(ageInHours / 24);

    if (ageInDays > 0) return `${ageInDays} day${ageInDays > 1 ? "s" : ""} ago`;
    if (ageInHours > 0)
      return `${ageInHours} hour${ageInHours > 1 ? "s" : ""} ago`;
    return "Just now";
  };

  const getResolutionSummary = () => {
    if (!selectedDispute) return { freelancer: 0, client: 0 };

    const freelancerAmount = beneficiaryAmount;
    const clientAmount = selectedDispute.milestoneAmount - beneficiaryAmount;

    return { freelancer: freelancerAmount, client: clientAmount };
  };

  if (loading) {
    return (
      <Card className="glass border-primary/20 p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <span className="ml-3">Loading disputes...</span>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="glass border-primary/20 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Scale className="h-6 w-6 text-primary" />
          <h2 className="text-2xl font-bold">Dispute Resolution</h2>
          <Badge variant="outline" className="ml-auto">
            {disputes.length} Active Disputes
          </Badge>
          <Button
            onClick={() => fetchDisputes(false)}
            variant="outline"
            size="sm"
            className="ml-2"
          >
            Refresh
          </Button>
        </div>

        {disputes.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
            <p className="text-lg">No active disputes</p>
            <p className="text-sm">All escrows are running smoothly</p>
          </div>
        ) : (
          <div className="space-y-4">
            {disputes.map((dispute, index) => (
              <motion.div
                key={`${dispute.escrowId}-${dispute.milestoneIndex}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="border-red-200 bg-red-100/80 p-4 shadow-lg">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                        <span className="font-semibold text-red-700">
                          Dispute #{dispute.escrowId}
                        </span>
                        <Badge variant="destructive">Disputed</Badge>
                      </div>

                      <p className="text-sm text-muted-foreground mb-2">
                        {dispute.projectTitle}
                      </p>

                      <p className="text-sm mb-2">
                        <strong>Milestone:</strong>{" "}
                        {dispute.milestoneDescription}
                      </p>

                      <p className="text-sm mb-2">
                        <strong>Dispute Reason:</strong> {dispute.disputeReason}
                      </p>

                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          <span>
                            Client: {dispute.clientAddress.slice(0, 6)}...
                            {dispute.clientAddress.slice(-4)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          <span>
                            Freelancer: {dispute.freelancerAddress.slice(0, 6)}
                            ...{dispute.freelancerAddress.slice(-4)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          <span>Amount: {dispute.milestoneAmount} tokens</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span>{getDisputeAge(dispute.disputedAt)}</span>
                        </div>
                      </div>
                    </div>

                    <Button
                      onClick={() => openResolutionDialog(dispute)}
                      className="ml-4"
                    >
                      Resolve Dispute
                    </Button>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </Card>

      {/* Resolution Dialog */}
      <Dialog
        open={resolutionDialogOpen}
        onOpenChange={setResolutionDialogOpen}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Resolve Dispute</DialogTitle>
            <DialogDescription>
              Review the dispute details and decide how to split the funds
              between the client and freelancer.
            </DialogDescription>
          </DialogHeader>

          {selectedDispute && (
            <div className="space-y-6">
              {/* Dispute Details */}
              <div className="bg-muted/50 p-4 rounded-lg">
                <h4 className="font-semibold mb-2">Dispute Details</h4>
                <div className="space-y-2 text-sm">
                  <p>
                    <strong>Project:</strong> {selectedDispute.projectTitle}
                  </p>
                  <p>
                    <strong>Milestone:</strong>{" "}
                    {selectedDispute.milestoneDescription}
                  </p>
                  <p>
                    <strong>Reason:</strong> {selectedDispute.disputeReason}
                  </p>
                  <p>
                    <strong>Amount:</strong> {selectedDispute.milestoneAmount}{" "}
                    tokens
                  </p>
                </div>
              </div>

              {/* Resolution Slider */}
              <div className="space-y-4">
                <Label className="text-base font-semibold">
                  Fund Distribution
                </Label>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>
                      Client gets: {getResolutionSummary().client.toFixed(2)}{" "}
                      tokens
                    </span>
                    <span>
                      Freelancer gets:{" "}
                      {getResolutionSummary().freelancer.toFixed(2)} tokens
                    </span>
                  </div>

                  <Slider
                    value={[beneficiaryAmount]}
                    onValueChange={(value) => setBeneficiaryAmount(value[0])}
                    max={selectedDispute.milestoneAmount}
                    step={0.01}
                    className="w-full"
                  />

                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>All to Client</span>
                    <span>All to Freelancer</span>
                  </div>
                </div>
              </div>

              {/* Resolution Options */}
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBeneficiaryAmount(0)}
                >
                  Client Wins (100%)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setBeneficiaryAmount(selectedDispute.milestoneAmount / 2)
                  }
                >
                  Split 50/50
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setBeneficiaryAmount(selectedDispute.milestoneAmount)
                  }
                >
                  Freelancer Wins (100%)
                </Button>
              </div>

              {/* Resolution Reason */}
              <div className="space-y-2">
                <Label htmlFor="resolution-reason">
                  Resolution Reason (required, stored on-chain)
                </Label>
                <Input
                  id="resolution-reason"
                  value={resolutionReason}
                  onChange={(e) => setResolutionReason(e.target.value)}
                  placeholder="Explain your decision..."
                />
              </div>

              {/* Evidence & Communication */}
              <DisputeEvidence
                escrowId={selectedDispute.escrowId}
                milestoneIndex={selectedDispute.milestoneIndex}
                clientAddress={selectedDispute.clientAddress}
                freelancerAddress={selectedDispute.freelancerAddress}
              />

              <AdminDisputeCommunication
                escrowId={selectedDispute.escrowId}
                milestoneIndex={selectedDispute.milestoneIndex}
                clientAddress={selectedDispute.clientAddress}
                freelancerAddress={selectedDispute.freelancerAddress}
                projectTitle={selectedDispute.projectTitle}
              />
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResolutionDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={resolveDispute}
              disabled={isResolving || !resolutionReason.trim()}
              className="bg-green-600 hover:bg-green-700"
            >
              {isResolving ? "Resolving..." : "Resolve Dispute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
