import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWeb3 } from "@/contexts/web3-context";
import {
  useNotifications,
  createMilestoneNotification,
} from "@/contexts/notification-context";
import { useToast } from "@/hooks/use-toast";
import { CONTRACTS } from "@/lib/web3/config";

import {
  CheckCircle2,
  Send,
  AlertTriangle,
  Gavel,
  Play,
  XCircle,
} from "lucide-react";
import type { Milestone } from "@/lib/web3/types";
import { ContractService } from "@/lib/web3/contract-service";
import {
  AutopilotReviewing,
  useAutopilotManaged,
} from "@/components/autopilot/autopilot-badge";

interface MilestoneActionsProps {
  escrowId: string;
  milestoneIndex: number;
  milestone: Milestone;
  isPayer: boolean;
  isBeneficiary: boolean;
  escrowStatus: string;
  onSuccess: () => void;
  allMilestones?: Milestone[]; // Add all milestones for sequential validation
  showSubmitButton?: boolean; // New prop to control submit button visibility
  payerAddress?: string; // Client address for notifications
  beneficiaryAddress?: string; // Freelancer address for notifications
  escrowReleasedAmount?: string; // Total amount released in escrow (to determine dispute winner)
  escrowTotalAmount?: string; // Total escrow amount
}

export function MilestoneActions({
  escrowId,
  milestoneIndex,
  milestone,
  isPayer,
  isBeneficiary,
  escrowStatus,
  onSuccess,
  payerAddress,
  beneficiaryAddress,
  escrowReleasedAmount,
  escrowTotalAmount,
}: MilestoneActionsProps) {
  const { wallet } = useWeb3();
  const { addNotification } = useNotifications();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionType, setActionType] = useState<
    | "start"
    | "submit"
    | "approve"
    | "reject"
    | "resubmit"
    | "dispute"
    | "resolve"
    | null
  >(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [resubmitMessage, setResubmitMessage] = useState("");

  // Helper functions
  // While Autopilot runs the job it approves and rejects; the client keeps
  // the dispute right and can take the job back to act by hand.
  const { active: autopilotActive } = useAutopilotManaged(escrowId);

  const canApproveMilestone = () => {
    const canApprove =
      milestone.status === "submitted" &&
      isPayer &&
      escrowStatus === "active" &&
      !autopilotActive;
    return canApprove;
  };

  const canResubmitMilestone = () => {
    return (
      milestone.status === "rejected" &&
      isBeneficiary &&
      escrowStatus === "active"
    );
  };

  const isProjectTerminated =
    milestone.status === "disputed" || escrowStatus === "disputed";

  const openDialog = (type: typeof actionType) => {
    setActionType(type);
    setDialogOpen(true);
  };

  const handleAction = async () => {
    if (!actionType) return;

    setIsLoading(true);
    const service = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);

    try {
      let txHash: string | undefined;

      switch (actionType) {
        // Named-argument calls through ContractService: the generic
        // contract.send passed these positionally, and the generated client
        // rejected them ("Missing field escrow_id").
        case "start":
          txHash = await service.startWork(
            Number(escrowId),
            wallet.address || "",
          );
          break;
        case "submit":
          txHash = await service.submitMilestone({
            escrow_id: Number(escrowId),
            milestone_index: milestoneIndex,
            description: milestone.description,
            beneficiary: wallet.address || "",
          });
          break;
        case "approve":
          // Use ContractService instead of contract.send - it handles the correct format
          const { ContractService } = await import(
            "@/lib/web3/contract-service"
          );
          const contractService = new ContractService(
            CONTRACTS.SECUREFLOW_ESCROW,
          );
          txHash = await contractService.approveMilestone({
            escrow_id: Number(escrowId),
            milestone_index: milestoneIndex,
            depositor: wallet.address || "",
          });
          break;
        case "reject":
          // Use ContractService instead of contract.send - it handles the correct format
          const { ContractService: RejectContractService } = await import(
            "@/lib/web3/contract-service"
          );
          const rejectContractService = new RejectContractService(
            CONTRACTS.SECUREFLOW_ESCROW,
          );
          txHash = await rejectContractService.rejectMilestone({
            escrow_id: Number(escrowId),
            milestone_index: milestoneIndex,
            reason: disputeReason,
            depositor: wallet.address || "",
          });
          break;
        case "dispute":
          // Use ContractService instead of contract.send - it handles the correct format
          // Determine who can dispute: either payer (client) or beneficiary (freelancer)
          const disputerAddress = wallet.address || "";
          if (!disputerAddress) {
            throw new Error("Wallet address is required to dispute milestone");
          }
          const { ContractService: DisputeContractService } = await import(
            "@/lib/web3/contract-service"
          );
          const disputeContractService = new DisputeContractService(
            CONTRACTS.SECUREFLOW_ESCROW,
          );
          txHash = await disputeContractService.disputeMilestone({
            escrow_id: Number(escrowId),
            milestone_index: milestoneIndex,
            reason: disputeReason,
            disputer: disputerAddress,
          });
          break;
        case "resubmit":
          txHash = await service.resubmitMilestone({
            escrow_id: Number(escrowId),
            milestone_index: milestoneIndex,
            description: resubmitMessage || milestone.description,
            beneficiary: wallet.address || "",
          });
          break;
      }

      if (txHash) {
        const successMessages: Record<
          string,
          { title: string; description: string }
        > = {
          start: {
            title: "Work Started",
            description: "You have successfully started work on this escrow",
          },
          submit: {
            title: "Milestone Submitted",
            description: "Your milestone has been submitted for review",
          },
          approve: {
            title: "Milestone Approved",
            description: "Payment has been released to the freelancer",
          },
          reject: {
            title: "Milestone Rejected",
            description:
              "The milestone has been rejected. The freelancer can resubmit",
          },
          dispute: {
            title: "Dispute Created",
            description:
              "A dispute has been created and will be reviewed by an arbiter",
          },
          resubmit: {
            title: "Milestone Resubmitted",
            description: "Your milestone has been resubmitted for review",
          },
        };

        const message = successMessages[actionType] || {
          title: "Transaction Successful",
          description: "Your transaction has been submitted successfully",
        };

        toast({
          title: message.title,
          description: message.description,
        });

        // Emit global events so pages can refresh immediately after on-chain actions.
        // This avoids stale UI (especially with long staleTimes / manual fetch pages).
        window.dispatchEvent(
          new CustomEvent("escrowUpdated", {
            detail: {
              escrowId: Number(escrowId),
              milestoneIndex,
              action: actionType,
            },
          }),
        );
        if (actionType === "start") {
          window.dispatchEvent(
            new CustomEvent("workStarted", {
              detail: { escrowId: Number(escrowId) },
            }),
          );
        }
        if (actionType === "submit" || actionType === "resubmit") {
          window.dispatchEvent(
            new CustomEvent("milestoneSubmitted", {
              detail: { escrowId: Number(escrowId), milestoneIndex },
            }),
          );
        }
        if (actionType === "approve") {
          window.dispatchEvent(
            new CustomEvent("milestoneApproved", {
              detail: { escrowId: Number(escrowId), milestoneIndex },
            }),
          );
        }
        if (actionType === "approve") {
          // Notify freelancer that the milestone was approved
          if (beneficiaryAddress) {
            addNotification(
              createMilestoneNotification(
                "approved",
                escrowId,
                milestoneIndex,
                {
                  clientName: wallet.address
                    ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
                    : "Client",
                },
              ),
              [beneficiaryAddress],
            );
          }
        }

        if (actionType === "reject") {
          window.dispatchEvent(
            new CustomEvent("milestoneRejected", {
              detail: { escrowId: Number(escrowId), milestoneIndex },
            }),
          );
          // Notify freelancer
          if (beneficiaryAddress) {
            addNotification(
              createMilestoneNotification(
                "rejected",
                escrowId,
                milestoneIndex,
                {
                  clientName: wallet.address
                    ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
                    : "Client",
                  reason: disputeReason,
                },
              ),
              [beneficiaryAddress],
            );
          }
        }

        if (actionType === "dispute") {
          // Notify the other party about the dispute
          const otherParty = isPayer ? beneficiaryAddress : payerAddress;
          if (otherParty) {
            addNotification(
              createMilestoneNotification(
                "disputed",
                escrowId,
                milestoneIndex,
                {
                  reason: disputeReason,
                },
              ),
              [otherParty],
            );
          }
        }

        setDialogOpen(false);
        onSuccess();
      }
    } catch (error: any) {
      toast({
        title: "Transaction failed",
        description: error.message || "Failed to submit transaction",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Dialog content based on action type
  const dialogContent = {
    start: {
      title: "Start Work",
      description: "Are you sure you want to start work on this escrow?",
      confirmText: "Start Work",
    },
    submit: {
      title: "Submit Milestone",
      description: "Submit this milestone for client review and approval.",
      confirmText: "Submit Milestone",
    },
    approve: {
      title: "Approve Milestone",
      description:
        "Approve this milestone and release payment to the freelancer.",
      confirmText: "Approve & Release",
    },
    reject: {
      title: "Reject Milestone",
      description:
        "Reject this milestone. The freelancer can resubmit with improvements.",
      confirmText: "Reject Milestone",
    },
    dispute: {
      title: "Dispute Milestone",
      description:
        "Dispute this milestone. An arbiter will review and resolve the dispute.",
      confirmText: "Create Dispute",
    },
    resubmit: {
      title: "Resubmit Milestone",
      description:
        "Resubmit this milestone with improvements based on client feedback.",
      confirmText: "Resubmit Milestone",
    },
    resolve: {
      title: "Resolve Dispute",
      description: "Resolve this dispute and finalize the milestone outcome.",
      confirmText: "Resolve Dispute",
    },
  }[actionType || "submit"] || {
    title: "Confirm Action",
    description: "Are you sure you want to proceed?",
    confirmText: "Confirm",
  };

  const Icon =
    {
      start: Play,
      submit: Send,
      approve: CheckCircle2,
      reject: XCircle,
      dispute: Gavel,
      resubmit: Send,
      resolve: CheckCircle2,
    }[actionType || "submit"] || Send;

  return (
    <>
      {milestone.status === "submitted" &&
        autopilotActive &&
        !isProjectTerminated && (
          <div className="mb-2 w-full">
            <AutopilotReviewing
              escrowId={escrowId}
              audience={isPayer ? "client" : "freelancer"}
            />
          </div>
        )}
      <div className="flex items-center gap-2">
        {/* Approve Milestone - Only payer for submitted milestones (disabled if terminated) */}
        {canApproveMilestone() && !isProjectTerminated && (
          <Button
            onClick={() => openDialog("approve")}
            size="sm"
            variant="default"
            className="gap-2 bg-green-600 hover:bg-green-700 text-white"
            disabled={isLoading}
          >
            <CheckCircle2 className="h-4 w-4" />
            {isLoading ? "Processing..." : "Approve"}
          </Button>
        )}

        {/* Reject Milestone - Only payer for submitted milestones (disabled if terminated) */}
        {canApproveMilestone() && !isProjectTerminated && (
          <Button
            onClick={() => openDialog("reject")}
            size="sm"
            variant="outline"
            className="gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
            disabled={isLoading}
          >
            <XCircle className="h-4 w-4" />
            {isLoading ? "Processing..." : "Reject"}
          </Button>
        )}

        {/* Dispute Milestone - Only payer for submitted milestones (disabled if terminated) */}
        {milestone.status === "submitted" &&
          isPayer &&
          !isProjectTerminated && (
            <Button
              onClick={() => openDialog("dispute")}
              size="sm"
              variant="destructive"
              className="gap-2"
              disabled={isLoading}
            >
              <Gavel className="h-4 w-4" />
              {isLoading ? "Processing..." : "Dispute"}
            </Button>
          )}

        {/* Approved Status - Show approved badge */}
        {milestone.status === "approved" && (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm font-medium">Approved</span>
          </div>
        )}

        {/* Rejected Status - Show rejected badge and resubmit button */}
        {milestone.status === "rejected" && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">Rejected</span>
            </div>
            {canResubmitMilestone() && (
              <Button
                onClick={() => openDialog("resubmit")}
                size="sm"
                variant="default"
                className="gap-2"
                disabled={isLoading}
                data-action="resubmit"
              >
                <Send className="h-4 w-4" />
                {isLoading ? "Processing..." : "Resubmit"}
              </Button>
            )}
          </div>
        )}

        {/* Disputed Status - Show disputed badge with reason */}
        {milestone.status === "disputed" && (
          <div className="flex flex-col gap-2 text-orange-600">
            <div className="flex items-center gap-2">
              <Gavel className="h-4 w-4" />
              <span className="text-sm font-medium">Disputed</span>
            </div>
            {milestone.disputeReason && (
              <div className="text-xs text-orange-700 bg-orange-50 p-2 rounded border">
                <strong>Reason:</strong> {milestone.disputeReason}
              </div>
            )}
          </div>
        )}

        {/* Resolved Status - Show resolved badge with winner info */}
        {milestone.status === "resolved" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-blue-600">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-sm font-medium">Resolved</span>
            </div>
            {/* Determine winner based on resolution amount or escrow state */}
            {(() => {
              // If we have resolution amount, use it directly
              if (milestone.resolutionAmount !== undefined) {
                const resolutionAmount = Number(milestone.resolutionAmount);
                return (
                  <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-900/20 p-2 rounded border">
                    {resolutionAmount > 0 ? (
                      <span className="text-green-600 dark:text-green-400">
                        <strong>Freelancer won:</strong>{" "}
                        {(resolutionAmount / 1e7).toFixed(2)} tokens awarded
                      </span>
                    ) : (
                      <span className="text-orange-600 dark:text-orange-400">
                        <strong>Client won:</strong> Full refund issued
                      </span>
                    )}
                  </div>
                );
              }
              // Otherwise, infer from escrow state
              if (escrowReleasedAmount && escrowTotalAmount) {
                const released = Number(escrowReleasedAmount);
                const milestoneAmount = Number(milestone.amount);
                // If released amount is close to milestone amount, freelancer likely won
                // If escrow was refunded (released < milestone), client won
                if (released >= milestoneAmount * 0.9) {
                  return (
                    <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-900/20 p-2 rounded border">
                      <span className="text-green-600 dark:text-green-400">
                        <strong>Freelancer won:</strong> Payment released
                      </span>
                    </div>
                  );
                } else {
                  return (
                    <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-900/20 p-2 rounded border">
                      <span className="text-orange-600 dark:text-orange-400">
                        <strong>Client won:</strong> Refund issued
                      </span>
                    </div>
                  );
                }
              }
              return null;
            })()}
          </div>
        )}

        {/* Terminated Project Status - Show terminated badge */}
        {isProjectTerminated && (
          <div className="flex items-center gap-2 text-gray-600">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">Project Terminated</span>
          </div>
        )}

        {/* Duplicate dispute button removed */}
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="glass max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
                <Icon className="h-6 w-6 text-primary" />
              </div>
              <DialogTitle className="text-2xl">
                {dialogContent.title}
              </DialogTitle>
            </div>
            <DialogDescription className="text-base leading-relaxed">
              {dialogContent.description}
            </DialogDescription>
          </DialogHeader>

          <div className="bg-muted/50 rounded-lg p-4 my-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Escrow ID:</span>
                <span className="font-mono font-semibold">#{escrowId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Milestone:</span>
                <span className="font-semibold">{milestoneIndex + 1}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount:</span>
                <span className="font-bold text-primary">
                  {(() => {
                    try {
                      const amount = Number.parseFloat(milestone.amount);
                      if (isNaN(amount)) return "0.00";
                      return (amount / 1e7).toFixed(2);
                    } catch (e) {
                      return "0.00";
                    }
                  })()}
                </span>
              </div>
            </div>
          </div>

          {/* Reason input for dispute or reject action */}
          {(actionType === "dispute" || actionType === "reject") && (
            <div className="my-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reason for {actionType === "dispute" ? "dispute" : "rejection"}{" "}
                (required)
              </label>
              <textarea
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder={`Please explain why you are ${
                  actionType === "dispute" ? "disputing" : "rejecting"
                } this milestone...`}
                className="w-full p-3 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                rows={3}
                required
              />
              {!disputeReason.trim() && (
                <p className="text-sm text-red-600 mt-1">
                  Please provide a reason for the{" "}
                  {actionType === "dispute" ? "dispute" : "rejection"}
                </p>
              )}
            </div>
          )}

          {/* Rejection reason display and resubmit message for resubmit action */}
          {actionType === "resubmit" && (
            <div className="my-4 space-y-4">
              {/* Show rejection reason if available */}
              {milestone.rejectionReason && (
                <div>
                  <label className="block text-sm font-medium text-red-600 mb-2">
                    Rejection Reason
                  </label>
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 whitespace-pre-line max-h-64 overflow-y-auto">
                    {milestone.rejectionReason}
                  </div>
                </div>
              )}

              {/* Update message field */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Update Message
                </label>
                <textarea
                  value={resubmitMessage}
                  onChange={(e) => setResubmitMessage(e.target.value)}
                  placeholder="Describe the improvements you've made to address the client's feedback..."
                  className="w-full p-3 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  rows={4}
                />
                <p className="text-xs text-gray-500 mt-1">
                  This message will be sent to the client along with your
                  resubmission.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button onClick={handleAction} disabled={isLoading}>
              {isLoading ? "Processing..." : dialogContent.confirmText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
