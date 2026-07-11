import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useWeb3 } from "@/contexts/web3-context";
import { contractService } from "@/lib/web3/contract-service";
import { Check, X, Edit, MessageSquare } from "lucide-react";
import { translateContractError } from "@/components/job-management";

interface MilestoneNegotiationProps {
  escrowId: string;
  milestoneIndex: number;
  milestone: {
    description: string;
    amount: string;
    status: string;
    proposedAmount?: string;
    proposedDescription?: string;
  };
  isFreelancer: boolean;
  isClient: boolean;
  totalBudget?: string; // stroops
  onUpdate?: () => void;
}

const STROOPS = 1e7;

export function MilestoneNegotiation({
  escrowId,
  milestoneIndex,
  milestone,
  isFreelancer,
  isClient,
  totalBudget,
  onUpdate,
}: MilestoneNegotiationProps) {
  const { toast } = useToast();
  const { wallet } = useWeb3();

  const [isProposing, setIsProposing] = useState(false);
  const [proposedXlm, setProposedXlm] = useState("");
  const [proposedDescription, setProposedDescription] = useState(
    milestone.description,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const hasProposal = milestone.status === "proposal_pending";

  const handleProposeChange = async () => {
    const xlm = parseFloat(proposedXlm);
    if (!xlm || xlm <= 0) {
      toast({
        title: "Invalid amount",
        description: "Enter a valid XLM amount greater than 0.",
        variant: "destructive",
      });
      return;
    }
    if (totalBudget) {
      const budgetXlm = parseFloat(totalBudget) / STROOPS;
      if (xlm > budgetXlm) {
        toast({
          title: "Amount too high",
          description: `Proposed amount (${xlm.toFixed(2)} XLM) cannot exceed the total project budget (${budgetXlm.toFixed(2)} XLM).`,
          variant: "destructive",
        });
        return;
      }
    }
    if (!wallet.address) return;
    setIsSubmitting(true);
    try {
      toast({
        title: "Submitting proposal…",
        description: "Confirm in your wallet.",
      });
      await contractService.proposeMilestoneChange(
        Number(escrowId),
        milestoneIndex,
        String(Math.round(xlm * STROOPS)),
        proposedDescription || null,
        wallet.address,
      );
      toast({
        title: "Proposal submitted",
        description: "The client will review your proposed changes.",
      });
      window.dispatchEvent(new CustomEvent("escrowUpdated"));
      setIsProposing(false);
      setProposedXlm("");
      onUpdate?.();
    } catch (error: any) {
      toast({
        title: "Proposal failed",
        description: translateContractError(error?.message ?? ""),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApproveProposal = async () => {
    if (!wallet.address) return;
    setIsSubmitting(true);
    try {
      toast({
        title: "Approving proposal…",
        description: "Confirm in your wallet.",
      });
      await contractService.approveMilestoneProposal(
        Number(escrowId),
        milestoneIndex,
        wallet.address,
      );
      const newXlm = milestone.proposedAmount
        ? (parseFloat(milestone.proposedAmount) / STROOPS).toFixed(2)
        : "—";
      toast({
        title: "Proposal approved",
        description: `Milestone updated to ${newXlm} XLM.`,
      });
      window.dispatchEvent(new CustomEvent("escrowUpdated"));
      onUpdate?.();
    } catch (error: any) {
      toast({
        title: "Approval failed",
        description: translateContractError(error?.message ?? ""),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectProposal = async () => {
    if (!wallet.address) return;
    setIsSubmitting(true);
    try {
      toast({
        title: "Rejecting proposal…",
        description: "Confirm in your wallet.",
      });
      await contractService.rejectMilestoneProposal(
        Number(escrowId),
        milestoneIndex,
        wallet.address,
      );
      toast({
        title: "Proposal rejected",
        description: "The freelancer can submit a revised proposal.",
      });
      window.dispatchEvent(new CustomEvent("escrowUpdated"));
      onUpdate?.();
    } catch (error: any) {
      toast({
        title: "Rejection failed",
        description: translateContractError(error?.message ?? ""),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Client: pending proposal to review
  if (isClient && hasProposal && milestone.proposedAmount) {
    const currentXlm = (parseFloat(milestone.amount) / STROOPS).toFixed(2);
    const proposedXlmVal = (
      parseFloat(milestone.proposedAmount) / STROOPS
    ).toFixed(2);
    return (
      <Card className="glass border-yellow-500/50 p-4 mt-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Edit className="h-4 w-4 text-yellow-500" />
              <h4 className="font-semibold text-yellow-500 text-sm">
                Freelancer Proposed a Change
              </h4>
            </div>
            <div className="space-y-1.5 text-sm">
              <div>
                <span className="text-muted-foreground">Proposed amount: </span>
                <span className="font-semibold">{proposedXlmVal} XLM</span>
                <span className="text-muted-foreground ml-2">
                  (current: {currentXlm} XLM)
                </span>
              </div>
              {milestone.proposedDescription &&
                milestone.proposedDescription !== milestone.description && (
                  <div>
                    <span className="text-muted-foreground">
                      Proposed description:{" "}
                    </span>
                    <p className="mt-1 text-foreground">
                      {milestone.proposedDescription}
                    </p>
                  </div>
                )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              onClick={handleApproveProposal}
              disabled={isSubmitting}
              className="gap-1"
            >
              <Check className="h-4 w-4" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleRejectProposal}
              disabled={isSubmitting}
              className="gap-1"
            >
              <X className="h-4 w-4" />
              Reject
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // Freelancer: awaiting review
  if (isFreelancer && hasProposal) {
    return (
      <Card className="glass border-yellow-500/50 p-3 mt-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-yellow-500" />
          <span className="text-sm text-yellow-500 font-medium">
            Your proposal is pending client review.
          </span>
        </div>
      </Card>
    );
  }

  // Freelancer: propose a change on active (not-yet-submitted) milestone
  if (
    isFreelancer &&
    !hasProposal &&
    (milestone.status === "pending" || milestone.status === "not_started")
  ) {
    return (
      <div className="mt-2">
        {!isProposing ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
            onClick={() => setIsProposing(true)}
          >
            <Edit className="h-3.5 w-3.5" />
            Propose Milestone Change
          </Button>
        ) : (
          <Card className="glass border-blue-500/50 p-4 mt-1">
            <h4 className="font-semibold text-sm mb-3">Propose a Change</h4>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label
                  htmlFor={`proposed-xlm-${milestoneIndex}`}
                  className="text-xs"
                >
                  New Amount (XLM) — current:{" "}
                  {(parseFloat(milestone.amount) / STROOPS).toFixed(2)} XLM
                </Label>
                <Input
                  id={`proposed-xlm-${milestoneIndex}`}
                  type="number"
                  step="0.0000001"
                  min="0"
                  placeholder="e.g. 200"
                  value={proposedXlm}
                  onChange={(e) => setProposedXlm(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor={`proposed-desc-${milestoneIndex}`}
                  className="text-xs"
                >
                  Updated Description (optional)
                </Label>
                <Textarea
                  id={`proposed-desc-${milestoneIndex}`}
                  rows={2}
                  value={proposedDescription}
                  onChange={(e) => setProposedDescription(e.target.value)}
                  className="text-sm"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsProposing(false);
                    setProposedXlm("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={isSubmitting || !proposedXlm}
                  onClick={handleProposeChange}
                >
                  {isSubmitting ? "Submitting…" : "Submit Proposal"}
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    );
  }

  return null;
}
