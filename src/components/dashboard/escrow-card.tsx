import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { motion } from "framer-motion";
import {
  Clock,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Star,
  AlertTriangle,
  CalendarPlus,
  Scale,
  Paperclip,
  MessageCircle,
} from "lucide-react";
import { MilestoneActions } from "@/components/milestone-actions";
import { MilestoneNegotiation } from "@/components/milestone-negotiation";
import { JobManagement } from "@/components/job-management";
import { EvidenceSubmissionButton } from "@/components/evidence-submission-button";
import { ViewEvidenceButton } from "@/components/view-evidence-button";
import { parseAttachment } from "@/lib/utils";
import { RatingDialog } from "@/components/rating/rating-dialog";
import { ChatDialog } from "@/components/chat/chat-dialog";
import { useState, useEffect } from "react";
import { contractService } from "@/lib/web3/contract-service";
import { useWeb3 } from "@/contexts/web3-context";
import { useToast } from "@/hooks/use-toast";
import { isApiConfigured } from "@/lib/api";
import type { Escrow } from "@/lib/web3/types";

const STROOPS = 1e7;

function fmtXlm(stroops: string | number): string {
  return `${(parseFloat(String(stroops)) / STROOPS).toFixed(2)} XLM`;
}

interface EscrowCardProps {
  escrow: Escrow;
  index: number;
  expandedEscrow: string | null;
  submittingMilestone: string | null;
  onToggleExpanded: (escrowId: string) => void;
  onApproveMilestone: (escrowId: string, milestoneIndex: number) => void;
  onRejectMilestone: (escrowId: string, milestoneIndex: number) => void;
  onDisputeMilestone: (escrowId: string, milestoneIndex: number) => void;
  onStartWork: (escrowId: string) => void;
  onDispute: (escrowId: string) => void;
  calculateDaysLeft: (createdAt: number, duration: number) => number;
  getDaysLeftMessage: (daysLeft: number) => {
    text: string;
    color: string;
    bgColor: string;
  };
  onRaiseOverdueDispute?: (escrowId: string, reason: string) => void;
  onExtendDeadline?: (escrowId: string, extraDays: number) => void;
}

export function EscrowCard({
  escrow,
  index,
  expandedEscrow,
  onToggleExpanded,
  calculateDaysLeft,
  getDaysLeftMessage,
  onRaiseOverdueDispute,
  onExtendDeadline,
}: EscrowCardProps) {
  const { toast } = useToast();
  const [showRatingDialog, setShowRatingDialog] = useState(false);
  const [hasRating, setHasRating] = useState(false);
  const [existingRating, setExistingRating] = useState<{
    rating: number;
    review: string;
  } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [customDays, setCustomDays] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [showDisputeForm, setShowDisputeForm] = useState(false);

  const { wallet } = useWeb3();

  const now = Date.now();
  const deadlineAt = escrow.deadlineAt ?? 0;
  const isOverdue = deadlineAt > 0 && now > deadlineAt;
  const isActive = escrow.status === "active" || escrow.status === "pending";
  const isSettled =
    escrow.status === "completed" ||
    (escrow as any).status === "refunded" ||
    (escrow as any).status === "expired";

  // Determine if this is an open job (no freelancer assigned)
  const isOpenJob =
    !escrow.beneficiary ||
    escrow.beneficiary === "" ||
    escrow.beneficiary ===
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  useEffect(() => {
    if (escrow.status === "completed" && escrow.isClient) {
      contractService
        .getRating(Number.parseInt(escrow.id, 10))
        .then((rating) => {
          if (rating) {
            setHasRating(true);
            setExistingRating({ rating: rating.rating, review: rating.review });
          }
        })
        .catch(() => {});
    }
  }, [escrow.id, escrow.status, escrow.isClient]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "active":
        return "bg-blue-100 text-blue-800";
      case "completed":
        return "bg-green-100 text-green-800";
      case "disputed":
        return "bg-orange-100 text-orange-800";
      case "rejected":
        return "bg-red-100 text-red-800";
      case "resolved":
        return "bg-purple-100 text-purple-800";
      case "Dispute Resolved":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
      case "cancelled":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const hasResolvedDispute = escrow.milestones.some(
    (m) => m.status === "resolved",
  );

  const getDisplayStatus = () => {
    if (escrow.milestones.some((m) => m.status === "disputed"))
      return "disputed";
    if (escrow.milestones.some((m) => m.status === "rejected"))
      return "rejected";
    if (hasResolvedDispute) return "Dispute Resolved";
    return escrow.status;
  };

  const displayStatus = getDisplayStatus();

  const getMilestoneStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "submitted":
        return "bg-blue-100 text-blue-800";
      case "approved":
        return "bg-green-100 text-green-800";
      case "disputed":
        return "bg-red-100 text-red-800";
      case "resolved":
        return "bg-purple-100 text-purple-800";
      case "rejected":
        return "bg-orange-100 text-orange-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const progressPercentage =
    escrow.totalAmount !== "0"
      ? (Number.parseFloat(escrow.releasedAmount) /
          Number.parseFloat(escrow.totalAmount)) *
        100
      : 0;

  const completedMilestones = escrow.milestones.filter(
    (m) => m.status === "approved",
  ).length;
  const totalMilestones = escrow.milestones.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.1 }}
    >
      <Card className="glass border-primary/20 p-4 md:p-6 hover:border-primary/40 transition-colors">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-lg mb-1">
                {escrow.projectTitle || escrow.projectDescription}
              </CardTitle>
              {escrow.projectTitle && escrow.projectDescription && (
                <p className="text-sm text-muted-foreground mb-2">
                  {escrow.projectDescription}
                </p>
              )}
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  <span>
                    {Math.round(escrow.duration / (24 * 60 * 60))} days
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <DollarSign className="h-4 w-4" />
                  <span>{fmtXlm(escrow.totalAmount)}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={getStatusColor(displayStatus)}>
                {displayStatus}
              </Badge>
              {escrow.isClient &&
                escrow.beneficiary &&
                wallet.address &&
                isApiConfigured() && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => setChatOpen(true)}
                    title="Message freelancer"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    Message
                  </Button>
                )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggleExpanded(escrow.id)}
                className="cursor-pointer"
              >
                {expandedEscrow === escrow.id ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span>Progress</span>
                <span>
                  {completedMilestones}/{totalMilestones} milestones
                </span>
              </div>
              <Progress value={progressPercentage} className="h-2" />
            </div>

            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-600">Total Amount:</span>
                <div className="font-semibold">
                  {fmtXlm(escrow.totalAmount)}
                </div>
              </div>
              <div>
                <span className="text-gray-600">Released:</span>
                <div className="font-semibold">
                  {fmtXlm(escrow.releasedAmount)}
                </div>
              </div>
              <div>
                <span className="text-gray-600">Days Left:</span>
                <div className="font-semibold flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {(() => {
                    const daysLeft = calculateDaysLeft(
                      escrow.createdAt,
                      escrow.duration,
                    );
                    const message = getDaysLeftMessage(daysLeft);
                    return (
                      <span className={message.color}>{message.text}</span>
                    );
                  })()}
                </div>
              </div>
            </div>

            {expandedEscrow === escrow.id && (
              <div className="space-y-4 pt-4 border-t">
                <div className="space-y-3">
                  <h4 className="font-medium">Milestones:</h4>
                  {escrow.milestones.map((milestone, idx) => (
                    <div
                      key={idx}
                      className="flex flex-col gap-3 p-3 bg-muted/20 rounded-lg border border-muted"
                    >
                      {/* Milestone header */}
                      {(() => {
                        const { body: rawBody, attachment } = parseAttachment(
                          milestone.description ?? "",
                        );
                        // `requirements` comes directly from the contract (new field, never overwritten)
                        const contractReq = (milestone as any).requirements as
                          | string
                          | undefined;
                        let requirements: string = contractReq ?? "";
                        let submissionResponse: string | null = null;
                        let submissionAttachment: {
                          url: string;
                          name: string;
                        } | null = null;

                        if (
                          [
                            "submitted",
                            "approved",
                            "disputed",
                            "resolved",
                            "rejected",
                          ].includes(milestone.status)
                        ) {
                          // description is the freelancer's submission response
                          submissionResponse = rawBody;
                          submissionAttachment = attachment ?? null;
                        } else {
                          // still pending — description IS the requirements (no submission yet)
                          if (!requirements) requirements = rawBody;
                        }

                        return (
                          <>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0 space-y-2">
                                {/* Original requirements */}
                                {requirements ? (
                                  <div>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                                      Requirements
                                    </p>
                                    <p className="text-sm whitespace-pre-wrap wrap-break-word leading-relaxed">
                                      {requirements}
                                    </p>
                                  </div>
                                ) : null}

                                {/* Freelancer submission response */}
                                {submissionResponse !== null && (
                                  <div className="p-2.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-1">
                                      Freelancer's Submission
                                    </p>
                                    <p className="text-sm text-emerald-900 dark:text-emerald-100 whitespace-pre-wrap wrap-break-word leading-relaxed">
                                      {submissionResponse || (
                                        <span className="italic text-emerald-600/60">
                                          No description provided
                                        </span>
                                      )}
                                    </p>
                                    {submissionAttachment && (
                                      <a
                                        href={submissionAttachment.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 mt-1.5 text-xs text-emerald-700 dark:text-emerald-400 hover:underline"
                                      >
                                        <Paperclip className="h-3 w-3 shrink-0" />
                                        {submissionAttachment.name}
                                      </a>
                                    )}
                                  </div>
                                )}

                                {/* Attachment for requirements (when no separate submission) */}
                                {submissionResponse === null && attachment && (
                                  <a
                                    href={attachment.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
                                  >
                                    <Paperclip className="h-3 w-3 shrink-0" />
                                    {attachment.name}
                                  </a>
                                )}

                                <p className="text-xs text-muted-foreground pt-0.5">
                                  {fmtXlm(milestone.amount)}
                                </p>
                              </div>
                              <Badge
                                className={getMilestoneStatusColor(
                                  milestone.status,
                                )}
                              >
                                {milestone.status}
                              </Badge>
                            </div>
                          </>
                        );
                      })()}

                      {/* Dispute resolution outcome — visible to both parties */}
                      {milestone.status === "resolved" &&
                        (() => {
                          const freelancerAmt = Number(
                            (milestone as any).resolutionFreelancerAmount ||
                              milestone.resolutionAmount ||
                              "0",
                          );
                          const clientAmt = Number(
                            (milestone as any).resolutionClientAmount || "0",
                          );
                          const reason = (milestone as any).resolutionReason as
                            | string
                            | undefined;
                          return (
                            <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 space-y-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                                Dispute Resolved
                              </p>
                              {(freelancerAmt > 0 || clientAmt > 0) && (
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="p-2 rounded bg-green-100 dark:bg-green-900/30 text-center">
                                    <p className="text-xs text-green-700 dark:text-green-400 font-medium">
                                      Freelancer received
                                    </p>
                                    <p className="text-sm font-bold text-green-800 dark:text-green-300">
                                      {(freelancerAmt / 1e7).toFixed(2)} XLM
                                    </p>
                                  </div>
                                  <div className="p-2 rounded bg-orange-100 dark:bg-orange-900/30 text-center">
                                    <p className="text-xs text-orange-700 dark:text-orange-400 font-medium">
                                      You were refunded
                                    </p>
                                    <p className="text-sm font-bold text-orange-800 dark:text-orange-300">
                                      {(clientAmt / 1e7).toFixed(2)} XLM
                                    </p>
                                  </div>
                                </div>
                              )}
                              {reason && (
                                <div className="p-2 rounded bg-blue-100 dark:bg-blue-800/30 border border-blue-200 dark:border-blue-700">
                                  <p className="text-xs font-medium text-blue-800 dark:text-blue-200 mb-0.5">
                                    Arbiter's reasoning:
                                  </p>
                                  <p className="text-sm text-blue-700 dark:text-blue-300">
                                    {reason}
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                      {/* Milestone actions (approve / reject / dispute) — centered */}
                      <div className="flex justify-center">
                        <MilestoneActions
                          escrowId={escrow.id}
                          milestoneIndex={idx}
                          milestone={milestone}
                          isPayer={escrow.isClient || false}
                          isBeneficiary={escrow.isFreelancer || false}
                          escrowStatus={escrow.status}
                          allMilestones={escrow.milestones}
                          showSubmitButton={false}
                          payerAddress={escrow.payer}
                          beneficiaryAddress={escrow.beneficiary}
                          escrowReleasedAmount={escrow.releasedAmount}
                          escrowTotalAmount={escrow.totalAmount}
                          onSuccess={async () => {
                            window.dispatchEvent(
                              new CustomEvent("escrowUpdated"),
                            );
                            await new Promise((resolve) =>
                              setTimeout(resolve, 2000),
                            );
                          }}
                        />
                      </div>

                      {/* Evidence buttons for disputed milestones */}
                      {milestone.status === "disputed" && (
                        <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="h-4 w-4 text-orange-600" />
                            <span className="text-sm font-medium text-orange-700 dark:text-orange-300">
                              Milestone Under Dispute
                            </span>
                          </div>
                          <p className="text-xs text-orange-600 dark:text-orange-400 mb-3">
                            This milestone is being reviewed by an arbiter.
                            Submit evidence to support your case.
                          </p>
                          <div className="flex flex-col gap-2">
                            <ViewEvidenceButton
                              escrowId={escrow.id}
                              milestoneIndex={idx}
                              clientAddress={escrow.payer}
                              freelancerAddress={escrow.beneficiary}
                              variant="outline"
                              size="sm"
                              className="w-full"
                            />
                            <EvidenceSubmissionButton
                              escrowId={escrow.id}
                              milestoneIndex={idx}
                              onEvidenceSubmitted={() => {
                                toast({
                                  title: "Evidence submitted",
                                  description:
                                    "Your evidence has been recorded on-chain.",
                                });
                              }}
                              variant="default"
                              size="sm"
                              className="w-full"
                            />
                          </div>
                        </div>
                      )}

                      {/* Milestone negotiation (propose / approve / reject changes) */}
                      <MilestoneNegotiation
                        escrowId={escrow.id}
                        milestoneIndex={idx}
                        milestone={milestone as any}
                        isFreelancer={escrow.isFreelancer || false}
                        isClient={escrow.isClient || false}
                        totalBudget={escrow.totalAmount}
                        onUpdate={() =>
                          window.dispatchEvent(new CustomEvent("escrowUpdated"))
                        }
                      />
                    </div>
                  ))}
                </div>

                {/* Job Management — fund management + cancel (open jobs, client only) */}
                <JobManagement
                  escrowId={escrow.id}
                  isOpenJob={isOpenJob}
                  isClient={escrow.isClient || false}
                  totalAmount={escrow.totalAmount}
                  milestones={escrow.milestones.map((m, i) => ({
                    index: i,
                    description:
                      (m as any).originalDescription ?? m.description ?? "",
                    amount: m.amount,
                  }))}
                  onUpdate={() =>
                    window.dispatchEvent(new CustomEvent("escrowUpdated"))
                  }
                />
              </div>
            )}

            {/* Overdue actions */}
            {isOverdue &&
              isActive &&
              !isSettled &&
              (escrow.isClient || escrow.isFreelancer) && (
                <div className="mt-4 pt-4 border-t border-orange-200 dark:border-orange-800 space-y-3">
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700">
                    <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium text-orange-700 dark:text-orange-400">
                        Project deadline has passed
                      </p>
                      <p className="text-orange-600/80 dark:text-orange-400/70 text-xs mt-0.5">
                        {escrow.isClient
                          ? "You may extend the deadline to give the freelancer more time, or raise a dispute for arbiter review."
                          : "If the client is unresponsive, you can raise a dispute so an arbiter reviews the situation fairly."}
                      </p>
                    </div>
                  </div>

                  {escrow.isClient && onExtendDeadline && (
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Label className="text-xs mb-1 block text-muted-foreground">
                          Extend by (days)
                        </Label>
                        <Input
                          type="number"
                          min={1}
                          max={90}
                          placeholder="e.g. 7"
                          value={customDays}
                          onChange={(e) => setCustomDays(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 shrink-0"
                        disabled={!customDays || Number(customDays) < 1}
                        onClick={() => {
                          const days = parseInt(customDays, 10);
                          if (days > 0) {
                            onExtendDeadline(escrow.id, days);
                            setCustomDays("");
                          }
                        }}
                      >
                        <CalendarPlus className="h-3.5 w-3.5" />
                        Extend
                      </Button>
                    </div>
                  )}

                  {onRaiseOverdueDispute && (
                    <div>
                      {!showDisputeForm ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 w-full border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                          onClick={() => setShowDisputeForm(true)}
                        >
                          <Scale className="h-3.5 w-3.5" />
                          Request Arbitration
                        </Button>
                      ) : (
                        <div className="space-y-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700">
                          <p className="text-xs font-medium text-red-700 dark:text-red-400">
                            State your case — arbiters will review both sides
                          </p>
                          <Textarea
                            rows={3}
                            placeholder="Describe the situation clearly — what work was done, what's missing, and what outcome you're requesting..."
                            value={disputeReason}
                            onChange={(e) => setDisputeReason(e.target.value)}
                            className="text-sm"
                          />
                          <div className="flex gap-2 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setShowDisputeForm(false);
                                setDisputeReason("");
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={!disputeReason.trim()}
                              onClick={() => {
                                onRaiseOverdueDispute(escrow.id, disputeReason);
                                setShowDisputeForm(false);
                                setDisputeReason("");
                              }}
                            >
                              Submit to Arbiters
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

            {/* Rating — completed escrows, client only, no dispute */}
            {escrow.status === "completed" &&
              escrow.isClient &&
              !hasResolvedDispute && (
                <div className="mt-4 pt-4 border-t">
                  {hasRating ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                        <span className="font-medium">
                          Your Rating: {existingRating?.rating}/5
                        </span>
                      </div>
                      {existingRating?.review && (
                        <div className="bg-muted/20 rounded-lg p-3 text-sm">
                          {existingRating.review}
                        </div>
                      )}
                    </div>
                  ) : (
                    <Button
                      onClick={() => setShowRatingDialog(true)}
                      variant="outline"
                      size="sm"
                      className="w-full"
                    >
                      <Star className="h-4 w-4 mr-2" />
                      Rate Freelancer
                    </Button>
                  )}
                </div>
              )}
          </div>
        </CardContent>
      </Card>

      {chatOpen && escrow.beneficiary && wallet.address && (
        <ChatDialog
          open={chatOpen}
          onOpenChange={setChatOpen}
          myAddress={wallet.address}
          otherAddress={escrow.beneficiary}
        />
      )}

      {escrow.status === "completed" && escrow.beneficiary && (
        <RatingDialog
          open={showRatingDialog}
          onOpenChange={setShowRatingDialog}
          escrowId={Number.parseInt(escrow.id, 10)}
          freelancerAddress={escrow.beneficiary}
          onRatingSubmitted={async () => {
            setHasRating(true);
            try {
              const rating = await contractService.getRating(
                Number.parseInt(escrow.id, 10),
              );
              if (rating)
                setExistingRating({
                  rating: rating.rating,
                  review: rating.review,
                });
            } catch {}
          }}
        />
      )}
    </motion.div>
  );
}
