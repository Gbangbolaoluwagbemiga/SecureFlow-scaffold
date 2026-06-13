import { useState, useEffect } from "react";
import {
  uploadMilestoneFile,
  isApiConfigured,
  type UploadedFile,
} from "@/lib/api";
import { useWeb3 } from "@/contexts/web3-context";
import { CONTRACTS } from "@/lib/web3/config";

import {
  useNotifications,
  createEscrowNotification,
  createMilestoneNotification,
} from "@/contexts/notification-context";
// import { useSmartAccount } from "@/contexts/smart-account-context"; // Unused
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
// import { Input } from "@/components/ui/input"; // Unused
// import { Label } from "@/components/ui/label"; // Unused
import { useToast } from "@/hooks/use-toast";
// import { FreelancerHeader } from "@/components/freelancer/freelancer-header"; // Unused
import { FreelancerStats } from "@/components/freelancer/freelancer-stats";
// import { EscrowCard } from "@/components/freelancer/escrow-card"; // Unused
// import { FreelancerLoading } from "@/components/freelancer/freelancer-loading"; // Unused
import { Badge } from "@/components/ui/badge";
// import { Progress } from "@/components/ui/progress"; // Unused
// import {
//   Dialog,
//   DialogContent,
//   DialogDescription,
//   DialogFooter,
//   DialogHeader,
//   DialogTitle,
// } from "@/components/ui/dialog"; // Unused
// import { Alert, AlertDescription } from "@/components/ui/alert"; // Unused
// import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"; // Unused
import {
  FileText,
  User,
  DollarSign,
  CheckCircle,
  Calendar,
  Play,
  Clock,
  Star,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Scale,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  RefreshCw,
  MessageCircle as MessageCircleFreelancer,
} from "lucide-react";
import { Link } from "react-router-dom";
import { EvidenceSubmissionButton } from "@/components/evidence-submission-button";
import { ViewEvidenceButton } from "@/components/view-evidence-button";

interface Escrow {
  id: string;
  payer: string;
  beneficiary: string;
  token: string;
  totalAmount: string;
  releasedAmount: string;
  status: string;
  createdAt: number;
  duration: number;
  deadlineAt?: number;
  milestones: Milestone[];
  projectTitle?: string;
  projectDescription: string;
  isOpenJob: boolean;
  milestoneCount: number;
}

interface Milestone {
  description: string;
  amount: string;
  status: string;
  submittedAt?: number;
  approvedAt?: number;
  disputeReason?: string;
  rejectionReason?: string;
  resolutionAmount?: string; // Amount paid to beneficiary in resolution (0 = client wins, >0 = freelancer wins)
}

function OverdueFreelancerBanner({
  escrowId,
  onRaiseDispute,
}: {
  escrowId: string;
  onRaiseDispute: (escrowId: string, reason: string) => void;
}) {
  const [show, setShow] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="mt-3 pt-3 border-t border-orange-200 dark:border-orange-800 space-y-2">
      <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700">
        <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
        <p className="text-sm text-orange-700 dark:text-orange-400">
          The project deadline has passed. If the client is unresponsive or the
          situation is unfair, raise a dispute for arbiter review.
        </p>
      </div>
      {!show ? (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 w-full border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          onClick={() => setShow(true)}
        >
          <Scale className="h-3.5 w-3.5" />
          Request Arbitration
        </Button>
      ) : (
        <div className="space-y-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700">
          <p className="text-xs font-medium text-red-700 dark:text-red-400">
            State your case — arbiters will review both sides fairly
          </p>
          <Textarea
            rows={3}
            placeholder="Describe the work you've done, why you deserve payment, and what resolution you're requesting..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="text-sm"
          />
          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShow(false);
                setReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!reason.trim()}
              onClick={() => {
                onRaiseDispute(escrowId, reason);
                setShow(false);
                setReason("");
              }}
            >
              Submit to Arbiters
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FreelancerPage() {
  const { wallet, getContract } = useWeb3();
  const { addNotification } = useNotifications();
  // Stellar doesn't use smart accounts
  // const { executeTransaction, isSmartAccountReady } = useSmartAccount();
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedEscrow, setExpandedEscrow] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "active" | "completed" | "disputed"
  >("all");
  const [sortFilter, setSortFilter] = useState<"newest" | "oldest">("newest");
  const [averageRating, setAverageRating] = useState<number>(0);
  const [ratingCount, setRatingCount] = useState<number>(0);
  const [badge, setBadge] = useState<
    "Beginner" | "Intermediate" | "Advanced" | "Expert"
  >("Beginner");
  const [escrowRatings, setEscrowRatings] = useState<
    Record<string, { rating: number; review: string }>
  >({});
  const [submittingMilestone, setSubmittingMilestone] = useState<string | null>(
    null,
  );
  const [submittedMilestones, setSubmittedMilestones] = useState<Set<string>>(
    new Set(),
  );
  const [approvedMilestones, setApprovedMilestones] = useState<Set<string>>(
    new Set(),
  );
  const [selectedEscrowId, setSelectedEscrowId] = useState<string | null>(null);
  const [selectedMilestoneIndex, setSelectedMilestoneIndex] = useState<
    number | null
  >(null);
  const [milestoneDescriptions, setMilestoneDescriptions] = useState<
    Record<string, string>
  >({});
  /** Per-milestone attachment files that have been selected but not yet uploaded */
  const [milestoneFiles, setMilestoneFiles] = useState<
    Record<string, File | null>
  >({});
  /** Per-milestone upload state */
  const [milestoneUploading, setMilestoneUploading] = useState<
    Record<string, boolean>
  >({});
  /** Per-milestone already-uploaded file info */
  const [milestoneAttachments, setMilestoneAttachments] = useState<
    Record<string, { url: string; filename: string } | null>
  >({});
  const [showDisputeDialog, setShowDisputeDialog] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [resubmitDescription, setResubmitDescription] = useState("");
  const [showResubmitDialog, setShowResubmitDialog] = useState(false);
  const [selectedResubmitEscrow, setSelectedResubmitEscrow] = useState<
    string | null
  >(null);
  const [selectedResubmitMilestone, setSelectedResubmitMilestone] = useState<
    number | null
  >(null);
  const { toast } = useToast();

  useEffect(() => {
    if (wallet.isConnected) {
      fetchFreelancerEscrows();
    }
  }, [wallet.isConnected]);

  // Listen for escrow update events from milestone approvals
  useEffect(() => {
    const handleEscrowUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ sourceAddress?: string }>).detail;
      const sourceAddress = detail?.sourceAddress?.toLowerCase();
      const current = wallet.address?.toLowerCase();
      if (sourceAddress && current && sourceAddress === current) {
        // Ignore self-originated updates when source is known.
        return;
      }

      // Refresh immediately, then do two quick follow-up refreshes to catch
      // ledger/indexing propagation without the user manually refreshing.
      fetchFreelancerEscrows(true);
      window.setTimeout(() => void fetchFreelancerEscrows(true), 1200);
      window.setTimeout(() => void fetchFreelancerEscrows(true), 3000);
    };

    window.addEventListener("escrowUpdated", handleEscrowUpdated);
    window.addEventListener("milestoneApproved", handleEscrowUpdated);

    return () => {
      window.removeEventListener("escrowUpdated", handleEscrowUpdated);
      window.removeEventListener("milestoneApproved", handleEscrowUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address]);

  // Listen for milestone submission events
  useEffect(() => {
    const handleMilestoneSubmitted = () => {
      fetchFreelancerEscrows();
    };

    const handleMilestoneApproved = () => {
      fetchFreelancerEscrows();
    };

    const handleMilestoneRejected = (_event: any) => {
      fetchFreelancerEscrows();
    };

    window.addEventListener("milestoneSubmitted", handleMilestoneSubmitted);
    window.addEventListener("milestoneApproved", handleMilestoneApproved);
    window.addEventListener("milestoneRejected", handleMilestoneRejected);
    return () => {
      window.removeEventListener(
        "milestoneSubmitted",
        handleMilestoneSubmitted,
      );
      window.removeEventListener("milestoneApproved", handleMilestoneApproved);
      window.removeEventListener("milestoneRejected", handleMilestoneRejected);
    };
  }, []);

  const fetchFreelancerEscrows = async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      if (!wallet.isConnected || !wallet.address) {
        return;
      }

      // Use ContractService instead of contract.call - it reads from blockchain
      const { ContractService } = await import("@/lib/web3/contract-service");
      const contractService = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);

      // Get next escrow ID from blockchain (not hardcoded)
      const nextEscrowId = await contractService.getNextEscrowId();

      // Get current ledger sequence once (needed for timestamp conversion)
      let currentLedger = 0;
      try {
        const { rpc } = await import("@stellar/stellar-sdk");
        const { getCurrentNetwork } = await import("@/lib/web3/stellar-config");
        const network = getCurrentNetwork();
        const rpcServer = new rpc.Server(network.rpcUrl);
        const latestLedger = await rpcServer.getLatestLedger();
        currentLedger = latestLedger.sequence;
      } catch (error) {
        // Fallback: use current time as approximation
        const SECONDS_PER_LEDGER = 5;
        currentLedger = Math.floor(Date.now() / 1000 / SECONDS_PER_LEDGER);
      }

      const freelancerEscrows: Escrow[] = [];

      // Fetch escrows where current user is the beneficiary
      const maxEscrowsToCheck = Math.min(nextEscrowId - 1, 20);
      for (let i = 1; i <= maxEscrowsToCheck; i++) {
        try {
          const escrowData = await contractService.getEscrow(i);

          if (!escrowData) {
            continue;
          }

          // Check if current user is the beneficiary
          const isBeneficiary =
            escrowData.freelancer &&
            escrowData.freelancer.toLowerCase().trim() ===
              wallet.address.toLowerCase().trim();

          if (isBeneficiary) {
            // Convert ledger sequence to approximate timestamp
            const SECONDS_PER_LEDGER = 5;
            const createdAtLedger = escrowData.created_at || 0;
            const ledgersAgo = currentLedger - createdAtLedger;
            const secondsAgo = ledgersAgo * SECONDS_PER_LEDGER;
            const approxCreatedAt = Date.now() - secondsAgo * 1000;

            // Calculate duration in seconds (deadline - created_at are both ledger sequences)
            const deadlineLedger = escrowData.deadline || 0;
            const durationInSeconds =
              (deadlineLedger - createdAtLedger) * SECONDS_PER_LEDGER;

            // Fetch milestones for this escrow
            const milestonesData = await contractService.getMilestones(i);
            const allMilestones = milestonesData.map(
              (m: any, index: number) => {
                // Convert milestone status to number first (might be string enum or number)
                let statusNumber = 0;
                const rawStatus = m.status || m[2] || 0;

                if (typeof rawStatus === "string") {
                  // Status is an enum string like "NotStarted", "Submitted", "Approved", etc.
                  switch (rawStatus.toLowerCase()) {
                    case "notstarted":
                    case "pending":
                      statusNumber = 0;
                      break;
                    case "submitted":
                      statusNumber = 1;
                      break;
                    case "approved":
                      statusNumber = 2;
                      break;
                    case "disputed":
                      statusNumber = 3;
                      break;
                    case "resolved":
                      statusNumber = 4;
                      break;
                    case "rejected":
                      statusNumber = 5;
                      break;
                    default:
                      statusNumber = 0;
                  }
                } else if (typeof rawStatus === "number") {
                  statusNumber = rawStatus;
                } else if (Array.isArray(rawStatus) && rawStatus.length > 0) {
                  // Status might be an enum array
                  const statusStr = rawStatus[0];
                  if (typeof statusStr === "string") {
                    switch (statusStr.toLowerCase()) {
                      case "notstarted":
                      case "pending":
                        statusNumber = 0;
                        break;
                      case "submitted":
                        statusNumber = 1;
                        break;
                      case "approved":
                        statusNumber = 2;
                        break;
                      case "disputed":
                        statusNumber = 3;
                        break;
                      case "resolved":
                        statusNumber = 4;
                        break;
                      case "rejected":
                        statusNumber = 5;
                        break;
                    }
                  } else if (typeof statusStr === "number") {
                    statusNumber = statusStr;
                  }
                }

                const statusMap: Record<
                  number,
                  | "pending"
                  | "submitted"
                  | "approved"
                  | "rejected"
                  | "disputed"
                  | "resolved"
                > = {
                  0: "pending",
                  1: "submitted",
                  2: "approved",
                  3: "disputed",
                  4: "resolved",
                  5: "rejected",
                };
                const status = statusMap[statusNumber] || "pending";

                // Convert ledger sequences to timestamps
                const submittedAtLedger = m.submitted_at || 0;
                const approvedAtLedger = m.approved_at || 0;
                const submittedAt =
                  submittedAtLedger > 0
                    ? Date.now() -
                      (currentLedger - submittedAtLedger) *
                        SECONDS_PER_LEDGER *
                        1000
                    : undefined;
                const approvedAt =
                  approvedAtLedger > 0
                    ? Date.now() -
                      (currentLedger - approvedAtLedger) *
                        SECONDS_PER_LEDGER *
                        1000
                    : undefined;

                // Track milestone states for submission prevention
                const milestoneKey = `${i}-${index}`;
                if (status === "approved") {
                  setApprovedMilestones(
                    (prev) => new Set([...prev, milestoneKey]),
                  );
                } else if (status === "submitted") {
                  setSubmittedMilestones(
                    (prev) => new Set([...prev, milestoneKey]),
                  );
                }

                return {
                  description: m.description || "",
                  amount: m.amount?.toString() || "0",
                  status,
                  submittedAt,
                  approvedAt,
                  disputeReason: m.dispute_reason || undefined,
                  rejectionReason: m.rejection_reason || undefined,
                };
              },
            );

            // Convert contract data to our Escrow type
            const statusNumber = escrowData.status || 0;
            const statusString = getStatusFromNumber(statusNumber);

            const deadlineLedgerFL = escrowData.deadline || 0;
            const deadlineAtFL =
              deadlineLedgerFL > 0
                ? Date.now() +
                  (deadlineLedgerFL - currentLedger) * SECONDS_PER_LEDGER * 1000
                : undefined;

            const escrow: Escrow = {
              id: i.toString(),
              payer: escrowData.creator || "",
              beneficiary: escrowData.freelancer || "",
              token: escrowData.token || "native",
              totalAmount: escrowData.amount || "0",
              releasedAmount: escrowData.paid_amount || "0",
              status: statusString,
              createdAt: approxCreatedAt,
              duration: durationInSeconds,
              deadlineAt: deadlineAtFL,
              milestones: allMilestones,
              projectTitle: escrowData.project_title || "",
              projectDescription: escrowData.project_description || "",
              isOpenJob: false,
              milestoneCount: allMilestones.length,
            };

            freelancerEscrows.push(escrow);
          }
        } catch (error) {
          continue;
        }
      }

      setEscrows(freelancerEscrows);

      // Fetch badge and rating for the freelancer
      if (wallet.address) {
        try {
          const badgeData = await contractService.getBadge(wallet.address);
          setBadge(badgeData);

          const ratingData = await contractService.getAverageRating(
            wallet.address,
          );
          setAverageRating(ratingData.average);
          setRatingCount(ratingData.count);
        } catch (error) {}
      }

      // Fetch ratings for completed escrows
      const ratings: Record<string, { rating: number; review: string }> = {};
      for (const escrow of freelancerEscrows) {
        if (escrow.status === "completed") {
          try {
            const rating = await contractService.getRating(
              Number.parseInt(escrow.id, 10),
            );
            if (rating) {
              ratings[escrow.id] = {
                rating: rating.rating,
                review: rating.review,
              };
            }
          } catch (error) {}
        }
      }
      setEscrowRatings(ratings);

      // Update submitted milestones based on current data
      const currentSubmittedMilestones = new Set<string>();
      freelancerEscrows.forEach((escrow) => {
        escrow.milestones.forEach((milestone, index) => {
          // Mark as submitted if milestone is submitted, approved, or has been processed
          if (
            milestone.status === "submitted" ||
            milestone.status === "approved" ||
            milestone.submittedAt ||
            milestone.approvedAt
          ) {
            currentSubmittedMilestones.add(`${escrow.id}-${index}`);
          }
        });
      });
      setSubmittedMilestones(currentSubmittedMilestones);
    } catch (error) {
      toast({
        title: "Failed to load escrows",
        description:
          "Could not fetch your assigned escrows from the blockchain",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleRefresh = () => {
    fetchFreelancerEscrows(true);
  };

  const startWork = async (escrowId: string) => {
    try {
      if (!wallet.address) {
        toast({
          title: "Error",
          description:
            "Wallet address not found. Please reconnect your wallet.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Starting work...",
        description: "Submitting transaction to start work on this escrow",
      });

      // Use ContractService instead of contract.send - it handles the correct format
      const { ContractService } = await import("@/lib/web3/contract-service");
      const contractService = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);

      await contractService.startWork(Number(escrowId), wallet.address);

      toast({
        title: "Work started!",
        description: "You can now submit milestones for this project",
      });

      // Get client address from escrow data
      const escrow = escrows.find((e) => e.id === escrowId);
      const clientAddress = escrow?.payer;

      // Notify the client only (no self-notifications).
      if (clientAddress) {
        addNotification(
          createEscrowNotification("work_started", escrowId, {
            projectTitle:
              escrows.find((e) => e.id === escrowId)?.projectTitle ||
              `Project #${escrowId}`,
            freelancerName:
              wallet.address!.slice(0, 6) + "..." + wallet.address!.slice(-4),
          }),
          [clientAddress],
        );
      }

      // Wait a moment for blockchain state to update
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Refresh escrows
      await fetchFreelancerEscrows();
    } catch (error: any) {
      // Check for specific error codes
      const errorMessage = error.message || "";
      if (
        errorMessage.includes("1102") ||
        errorMessage.includes("InvalidEscrowStatus")
      ) {
        // Work may have already started - refresh to get latest status
        toast({
          title: "Work Already Started",
          description:
            "Work has already been started on this escrow. Refreshing...",
        });
        // Refresh escrows to get latest status
        await fetchFreelancerEscrows();
        return;
      }

      if (
        errorMessage.includes("1103") ||
        errorMessage.includes("WorkAlreadyStarted")
      ) {
        toast({
          title: "Work Already Started",
          description: "Work has already been started on this escrow.",
        });
        // Refresh escrows to get latest status
        await fetchFreelancerEscrows();
        return;
      }

      // Check for MetaMask disconnection
      if (
        error.message?.includes("Disconnected from MetaMask") ||
        error.message?.includes("Premature close") ||
        error.code === "UNPREDICTABLE_GAS_LIMIT"
      ) {
        toast({
          title: "MetaMask Connection Lost",
          description: "Please refresh the page and reconnect your wallet",
          variant: "destructive",
        });
      } else if (error.message?.includes("Only beneficiary")) {
        toast({
          title: "Not Authorized",
          description: "Only the beneficiary can start work on this escrow",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Failed to start work",
          description: errorMessage || "Could not start work on this escrow",
          variant: "destructive",
        });
      }
    }
  };

  const submitMilestone = async (escrowId: string, milestoneIndex: number) => {
    const milestoneKey = `${escrowId}-${milestoneIndex}`;
    const baseDescription = milestoneDescriptions[milestoneKey] || "";

    // Upload any pending file attachment before submitting.
    // Keep a local reference so we can use it immediately without waiting
    // for the React state update cycle.
    let localAttachment = milestoneAttachments[milestoneKey] ?? null;
    const pendingFile = milestoneFiles[milestoneKey];
    if (pendingFile && isApiConfigured() && !localAttachment) {
      try {
        setMilestoneUploading((prev) => ({ ...prev, [milestoneKey]: true }));
        toast({
          title: "Uploading attachment…",
          description: pendingFile.name,
        });
        const uploaded: UploadedFile = await uploadMilestoneFile(
          pendingFile,
          escrowId,
          milestoneIndex,
        );
        localAttachment = { url: uploaded.url, filename: uploaded.filename };
        setMilestoneAttachments((prev) => ({
          ...prev,
          [milestoneKey]: localAttachment!,
        }));
        setMilestoneFiles((prev) => ({ ...prev, [milestoneKey]: null }));
      } catch (uploadErr: any) {
        toast({
          title: "File upload failed",
          description: uploadErr.message || "Could not upload attachment",
          variant: "destructive",
        });
        setMilestoneUploading((prev) => ({ ...prev, [milestoneKey]: false }));
        return;
      } finally {
        setMilestoneUploading((prev) => ({ ...prev, [milestoneKey]: false }));
      }
    }

    // Build the final description synchronously using the local reference.
    const description = localAttachment
      ? `${baseDescription}\n\n[Attachment: ${localAttachment.filename}](${localAttachment.url})`.trim()
      : baseDescription;

    // Keep UI state in sync too (non-blocking)
    if (localAttachment) {
      setMilestoneDescriptions((prev) => ({
        ...prev,
        [milestoneKey]: description,
      }));
    }

    // Check if milestone has already been submitted
    if (submittedMilestones.has(milestoneKey)) {
      toast({
        title: "Milestone already submitted",
        description:
          "This milestone has already been submitted and cannot be submitted again",
        variant: "destructive",
      });
      return;
    }

    // Check if milestone has already been approved
    if (approvedMilestones.has(milestoneKey)) {
      toast({
        title: "Milestone already approved",
        description:
          "This milestone has already been approved and cannot be resubmitted",
        variant: "destructive",
      });
      return;
    }

    // Check if this is the correct milestone to submit (sequential order)
    const escrow = escrows.find((e) => e.id === escrowId);
    if (escrow) {
      // Find the current milestone that should be submitted
      let expectedMilestoneIndex = -1;

      for (let i = 0; i < escrow.milestones.length; i++) {
        const milestone = escrow.milestones[i];
        const milestoneKey = `${escrowId}-${i}`;

        // Check if this milestone is pending and can be submitted
        if (
          milestone.status === "pending" &&
          !submittedMilestones.has(milestoneKey) &&
          !approvedMilestones.has(milestoneKey)
        ) {
          // For the first milestone, it can always be submitted if pending
          if (i === 0) {
            expectedMilestoneIndex = i;
            break;
          }

          // For subsequent milestones, check if the previous one is approved
          const previousMilestone = escrow.milestones[i - 1];
          const previousMilestoneKey = `${escrowId}-${i - 1}`;

          // Check if previous milestone is approved
          const isPreviousApproved =
            previousMilestone &&
            (previousMilestone.status === "approved" ||
              approvedMilestones.has(previousMilestoneKey));

          // Check if there are any submitted milestones before this one that aren't approved
          let hasUnapprovedSubmitted = false;
          for (let j = 0; j < i; j++) {
            const prevMilestone = escrow.milestones[j];
            const prevMilestoneKey = `${escrowId}-${j}`;
            const isPrevSubmitted =
              prevMilestone.status === "submitted" ||
              submittedMilestones.has(prevMilestoneKey);
            const isPrevApproved =
              prevMilestone.status === "approved" ||
              approvedMilestones.has(prevMilestoneKey);

            if (isPrevSubmitted && !isPrevApproved) {
              hasUnapprovedSubmitted = true;
              break;
            }
          }

          // Only allow submission if previous milestone is approved AND no submitted milestones are pending
          if (isPreviousApproved && !hasUnapprovedSubmitted) {
            expectedMilestoneIndex = i;
            break;
          }
        }
      }

      // Check if the milestone being submitted is the expected one
      if (expectedMilestoneIndex !== milestoneIndex) {
        if (expectedMilestoneIndex === -1) {
          toast({
            title: "No milestone available for submission",
            description:
              "All milestones are either completed or in progress. Please wait for the current milestone to be approved.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Wrong milestone sequence",
            description: `You can only submit milestone ${
              expectedMilestoneIndex + 1
            } at this time. Please complete the previous milestones first.`,
            variant: "destructive",
          });
        }
        return;
      }
    }

    // Additional check: Get the current milestone status from contract
    try {
      const contract = getContract(CONTRACTS.SECUREFLOW_ESCROW);
      const milestones = await contract.call("get_milestones", escrowId);

      if (milestones && milestones.length > milestoneIndex) {
        const milestone = milestones[milestoneIndex];

        // Check if milestone has been submitted (status 1) or approved (status 2)
        if (milestone && milestone[2] && Number(milestone[2]) > 0) {
          toast({
            title: "Milestone already processed",
            description: `This milestone has already been ${
              Number(milestone[2]) === 2 ? "approved" : "submitted"
            } and cannot be submitted again`,
            variant: "destructive",
          });
          return;
        }
      }
    } catch (error) {}

    // Validate milestone description from input field
    if (!description?.trim()) {
      toast({
        title: "Description required",
        description: "Please provide a description of your work",
        variant: "destructive",
      });
      return;
    }

    try {
      if (!wallet.address) {
        toast({
          title: "Error",
          description:
            "Wallet address not found. Please reconnect your wallet.",
          variant: "destructive",
        });
        return;
      }

      setSubmittingMilestone(`${escrowId}-${milestoneIndex}`);

      toast({
        title: "Submitting milestone...",
        description: "Submitting transaction to submit your milestone",
      });

      // Use ContractService instead of contract.send - it handles the correct format
      const { ContractService } = await import("@/lib/web3/contract-service");
      const contractService = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);

      await contractService.submitMilestone({
        escrow_id: Number(escrowId),
        milestone_index: milestoneIndex,
        description: description,
        beneficiary: wallet.address,
      });

      // Transaction is already confirmed via waitForConfirmation in web3-context
      // For Stellar, we don't need to poll for receipts like Ethereum
      // The transaction hash is returned after confirmation
      toast({
        title: "Milestone submitted!",
        description: "Your milestone has been submitted for review",
      });

      // Get client address from escrow data
      const escrow = escrows.find((e) => e.id === escrowId);
      const clientAddress = escrow?.payer;

      // Notify the client only (no self-notifications).
      if (clientAddress) {
        addNotification(
          createMilestoneNotification("submitted", escrowId, milestoneIndex, {
            freelancerName:
              wallet.address!.slice(0, 6) + "..." + wallet.address!.slice(-4),
            projectTitle: escrow?.projectTitle || `Project #${escrowId}`,
          }),
          [clientAddress],
        );
      }

      // Mark this milestone as submitted to prevent double submission
      const milestoneKey = `${escrowId}-${milestoneIndex}`;
      setSubmittedMilestones((prev) => new Set([...prev, milestoneKey]));

      // Clear form and attachments
      setMilestoneDescriptions((prev) => {
        const updated = { ...prev };
        delete updated[milestoneKey];
        return updated;
      });
      setMilestoneAttachments((prev) => {
        const updated = { ...prev };
        delete updated[milestoneKey];
        return updated;
      });
      setMilestoneFiles((prev) => {
        const updated = { ...prev };
        delete updated[milestoneKey];
        return updated;
      });
      setSelectedEscrowId(null);

      // Refresh escrows
      await fetchFreelancerEscrows();

      // Dispatch event to notify other components
      window.dispatchEvent(new CustomEvent("milestoneSubmitted"));
    } catch (error) {
      toast({
        title: "Failed to submit milestone",
        description: "Could not submit your milestone",
        variant: "destructive",
      });
    } finally {
      setSubmittingMilestone(null);
    }
  };

  const resubmitMilestone = async (
    escrowId: string,
    milestoneIndex: number,
    description: string,
  ) => {
    if (!description.trim()) {
      toast({
        title: "Description required",
        description: "Please describe the improvements you've made",
        variant: "destructive",
      });
      return;
    }

    try {
      setSubmittingMilestone(`${escrowId}-${milestoneIndex}`);

      toast({
        title: "Resubmitting milestone...",
        description: "Submitting transaction to resubmit your milestone",
      });

      // Use ContractService resubmitMilestone for rejected milestones
      const { ContractService } = await import("@/lib/web3/contract-service");
      const contractService = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);

      await contractService.resubmitMilestone({
        escrow_id: Number(escrowId),
        milestone_index: milestoneIndex,
        description: description,
        beneficiary: wallet.address || "",
      });

      // Transaction is already confirmed via waitForConfirmation in web3-context
      // For Stellar, we don't need to poll for receipts like Ethereum
      // The transaction hash is returned after confirmation
      toast({
        title: "Milestone resubmitted!",
        description: "Your milestone has been resubmitted for client review",
      });

      // Get client address from escrow data
      const escrow = escrows.find((e) => e.id === escrowId);
      const clientAddress = escrow?.payer;

      // Add notification for milestone resubmission (notify the client)
      addNotification(
        createMilestoneNotification("submitted", escrowId, milestoneIndex, {
          freelancerName:
            wallet.address!.slice(0, 6) + "..." + wallet.address!.slice(-4),
          projectTitle: escrow?.projectTitle || `Project #${escrowId}`,
        }),
        clientAddress ? [clientAddress] : undefined, // Notify the client
      );

      // Clear form and close dialog
      setResubmitDescription("");
      setShowResubmitDialog(false);
      setSelectedResubmitEscrow(null);
      setSelectedResubmitMilestone(null);

      // Refresh escrows
      await fetchFreelancerEscrows();

      // Dispatch event to notify other components
      window.dispatchEvent(new CustomEvent("milestoneResubmitted"));
    } catch (error) {
      toast({
        title: "Failed to resubmit milestone",
        description: "Could not resubmit your milestone",
        variant: "destructive",
      });
    } finally {
      setSubmittingMilestone(null);
    }
  };

  const openDispute = async (
    escrowId: string,
    milestoneIndex: number,
    reason: string,
  ) => {
    if (!reason.trim()) {
      toast({
        title: "Reason required",
        description: "Please provide a reason for the dispute",
        variant: "destructive",
      });
      return;
    }

    try {
      setSubmittingMilestone(`${escrowId}-${milestoneIndex}`);

      toast({
        title: "Opening dispute...",
        description: "Submitting transaction to open dispute",
      });

      // Use ContractService instead of contract.send
      const { ContractService } = await import("@/lib/web3/contract-service");
      const contractService = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);

      await contractService.disputeMilestone({
        escrow_id: Number(escrowId),
        milestone_index: milestoneIndex,
        reason: reason,
        disputer: wallet.address || "",
      });

      toast({
        title: "Dispute Opened!",
        description: "Your dispute has been opened successfully",
      });

      // Add notification for dispute opening
      addNotification(
        createMilestoneNotification("disputed", escrowId, milestoneIndex, {
          reason: reason,
          freelancerName:
            wallet.address!.slice(0, 6) + "..." + wallet.address!.slice(-4),
        }),
      );

      // Refresh escrows
      await fetchFreelancerEscrows();
    } catch (error) {
      toast({
        title: "Failed to open dispute",
        description: "Could not open dispute for this milestone",
        variant: "destructive",
      });
    } finally {
      setSubmittingMilestone(null);
    }
  };

  const raiseOverdueDispute = async (escrowId: string, reason: string) => {
    try {
      const { ContractService } = await import("@/lib/web3/contract-service");
      const contractService = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);
      toast({
        title: "Raising overdue dispute…",
        description: "Please confirm the transaction in your wallet",
      });
      await contractService.raiseOverdueDispute({
        escrow_id: Number(escrowId),
        requester: wallet.address || "",
        reason,
      });
      toast({
        title: "Dispute submitted",
        description:
          "Arbiters have been notified and will review both sides fairly",
      });

      // Notify arbiters
      const escrow = escrows.find((e) => e.id === escrowId);
      try {
        const authorizedArbiters =
          await contractService.getAuthorizedArbiters();
        for (const arbAddr of authorizedArbiters) {
          addNotification(
            {
              type: "dispute",
              title: "Overdue Dispute — Freelancer",
              message: `Freelancer raised a dispute on "${escrow?.projectTitle?.slice(0, 50) || `Project #${escrowId}`}"`,
              actionUrl: `/admin?escrow=${escrowId}`,
              data: { escrowId, requester: wallet.address, reason },
            },
            [arbAddr],
          );
        }
        // Notify client too
        if (escrow?.payer) {
          addNotification(
            {
              type: "dispute",
              title: "Overdue Dispute Raised",
              message: `A freelancer raised a dispute on your project "${escrow?.projectTitle?.slice(0, 50) || `#${escrowId}`}"`,
              actionUrl: `/dashboard?escrow=${escrowId}`,
              data: { escrowId, reason },
            },
            [escrow.payer],
          );
        }
      } catch {
        /* non-critical */
      }

      await fetchFreelancerEscrows();
    } catch (error: any) {
      toast({
        title: "Failed to raise dispute",
        description: error.message || "Transaction failed",
        variant: "destructive",
      });
    }
  };

  const getStatusFromNumber = (
    status: number,
  ): "pending" | "active" | "completed" | "disputed" => {
    switch (status) {
      case 0:
        return "pending";
      case 1:
        return "active";
      case 2:
        return "completed";
      case 3:
        return "disputed";
      case 4:
        return "active"; // Map cancelled to active
      default:
        return "pending";
    }
  };

  const getMilestoneStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200";
      case "submitted":
        return "bg-yellow-100 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200";
      case "approved":
        return "bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-200";
      case "rejected":
        return "bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200";
      case "disputed":
        return "bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200";
      case "resolved":
        return "bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200";
      default:
        return "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "inprogress":
        return "bg-blue-100 text-blue-800";
      case "released":
        return "bg-green-100 text-green-800";
      case "completed":
        return "bg-green-100 text-green-800";
      case "submitted":
        return "bg-blue-100 text-blue-800";
      case "approved":
        return "bg-green-100 text-green-800";
      case "terminated":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const formatAmount = (amount: string) => {
    try {
      const num = Number(amount) / 1e7;
      if (isNaN(num) || num < 0) {
        return "0.00";
      }
      return num.toFixed(2);
    } catch (error) {
      return "0.00";
    }
  };

  const calculateDaysLeft = (createdAt: number, duration: number): number => {
    const now = Date.now();
    // Duration is already in seconds from the contract, convert to milliseconds
    const projectEndTime = createdAt + duration * 1000;
    const daysLeft = Math.ceil((projectEndTime - now) / (24 * 60 * 60 * 1000));
    return Math.max(0, daysLeft); // Don't show negative days
  };

  const getDaysLeftMessage = (
    daysLeft: number,
  ): { text: string; color: string; bgColor: string } => {
    if (daysLeft > 7) {
      return {
        text: `${daysLeft} days`,
        color: "text-red-700 dark:text-red-400",
        bgColor: "bg-red-50 dark:bg-red-900/20",
      };
    } else if (daysLeft > 0) {
      return {
        text: `${daysLeft} days`,
        color: "text-orange-700 dark:text-orange-400",
        bgColor: "bg-orange-50 dark:bg-orange-900/20",
      };
    } else {
      return {
        text: "Deadline passed",
        color: "text-red-700 dark:text-red-400",
        bgColor: "bg-red-100 dark:bg-red-900/30",
      };
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  if (!wallet.isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Connect Wallet</CardTitle>
            <CardDescription>
              Please connect your wallet to view your freelancer dashboard
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              Freelancer Dashboard
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Manage your assigned projects and track your earnings
            </p>
          </div>
          {/* Header actions */}
          <div className="flex items-center gap-2">
            <Link to="/messages">
              <Button
                variant="outline"
                size="default"
                className="flex items-center gap-2"
              >
                <MessageCircleFreelancer className="h-4 w-4" />
                Messages
              </Button>
            </Link>
            <Button
              variant="outline"
              size="default"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-2"
            >
              <RefreshCw
                className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400"></div>
          </div>
        ) : escrows.length === 0 ? (
          <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-gray-400 dark:text-gray-500 mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                No assigned projects
              </h3>
              <p className="text-gray-600 dark:text-gray-400 text-center">
                You don't have any assigned projects yet. Check the jobs page to
                find open opportunities.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Stats Section */}
            <FreelancerStats
              escrows={escrows}
              averageRating={averageRating}
              ratingCount={ratingCount}
              badge={badge}
            />

            {/* Search and Filters */}
            <div className="mb-6 flex flex-col sm:flex-row gap-4 items-end">
              {/* Search Bar */}
              <div className="flex-1 min-w-0">
                <Input
                  type="text"
                  placeholder="Search projects by title or description..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full"
                />
              </div>

              {/* Status Filter */}
              <div className="w-full sm:w-[180px]">
                <Label htmlFor="status-filter" className="mb-2 block text-sm">
                  Status
                </Label>
                <Select
                  value={statusFilter}
                  onValueChange={(value: any) => setStatusFilter(value)}
                >
                  <SelectTrigger id="status-filter" className="w-full">
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="disputed">Disputed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Sort Filter */}
              <div className="w-full sm:w-[180px]">
                <Label htmlFor="sort-filter" className="mb-2 block text-sm">
                  Sort
                </Label>
                <Select
                  value={sortFilter}
                  onValueChange={(value: any) => setSortFilter(value)}
                >
                  <SelectTrigger id="sort-filter" className="w-full">
                    <SelectValue placeholder="Newest First" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest First</SelectItem>
                    <SelectItem value="oldest">Oldest First</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Projects Section */}
            <div className="grid gap-6">
              {escrows
                .filter((escrow) => {
                  // Status filter
                  const matchesStatus =
                    statusFilter === "all" || escrow.status === statusFilter;

                  // Search filter
                  const matchesSearch =
                    !searchQuery ||
                    escrow.projectDescription
                      .toLowerCase()
                      .includes(searchQuery.toLowerCase());

                  return matchesStatus && matchesSearch;
                })
                .sort((a, b) => {
                  if (sortFilter === "newest") {
                    return b.createdAt - a.createdAt;
                  } else {
                    return a.createdAt - b.createdAt;
                  }
                })
                .map((escrow) => (
                  <motion.div
                    key={escrow.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-gray-100">
                              <User className="h-5 w-5" />
                              {escrow.projectTitle ||
                                (escrow.projectDescription
                                  ? escrow.projectDescription.length > 50
                                    ? escrow.projectDescription.substring(
                                        0,
                                        50,
                                      ) + "..."
                                    : escrow.projectDescription
                                  : `Project #${escrow.id}`)}
                            </CardTitle>
                            <CardDescription className="mt-1 text-gray-600 dark:text-gray-400">
                              {escrow.projectDescription &&
                              (!escrow.projectTitle ||
                                escrow.projectDescription.length > 50)
                                ? escrow.projectDescription
                                : `Project ID: #${escrow.id}`}
                            </CardDescription>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              className={getStatusColor(
                                escrow.milestones.some(
                                  (m) =>
                                    m.status === "disputed" ||
                                    m.status === "rejected",
                                )
                                  ? "terminated"
                                  : escrow.status,
                              )}
                            >
                              {escrow.milestones.some(
                                (m) =>
                                  m.status === "disputed" ||
                                  m.status === "rejected",
                              )
                                ? "terminated"
                                : escrow.status}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setExpandedEscrow(
                                  expandedEscrow === escrow.id
                                    ? null
                                    : escrow.id,
                                )
                              }
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
                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
                          <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                            <DollarSign className="h-5 w-5 text-green-600 dark:text-green-400" />
                            <div>
                              <p className="text-sm text-gray-600 dark:text-gray-400">
                                Total Value
                              </p>
                              <p className="font-semibold text-green-700 dark:text-green-400">
                                {formatAmount(escrow.totalAmount)} tokens
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                            <CheckCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                            <div>
                              <p className="text-sm text-gray-600 dark:text-gray-400">
                                Released
                              </p>
                              <p className="font-semibold text-blue-700 dark:text-blue-400">
                                {formatAmount(escrow.releasedAmount)} tokens
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                            <Calendar className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                            <div>
                              <p className="text-sm text-gray-600 dark:text-gray-400">
                                Created
                              </p>
                              <p className="font-semibold text-purple-700 dark:text-purple-400">
                                {formatDate(escrow.createdAt)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                            <FileText className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                            <div>
                              <p className="text-sm text-gray-600 dark:text-gray-400">
                                Milestones
                              </p>
                              <p className="font-semibold text-orange-700 dark:text-orange-400">
                                {escrow.milestoneCount ||
                                  escrow.milestones.length}{" "}
                                total
                              </p>
                            </div>
                          </div>
                          <div
                            className={`flex items-center gap-2 p-3 rounded-lg ${(() => {
                              const daysLeft = calculateDaysLeft(
                                escrow.createdAt,
                                escrow.duration,
                              );
                              const message = getDaysLeftMessage(daysLeft);
                              return message.bgColor;
                            })()}`}
                          >
                            <Clock className="h-5 w-5 text-red-600 dark:text-red-400" />
                            <div>
                              <p className="text-sm text-gray-600 dark:text-gray-400">
                                Days Left
                              </p>
                              <p
                                className={`font-semibold ${(() => {
                                  const daysLeft = calculateDaysLeft(
                                    escrow.createdAt,
                                    escrow.duration,
                                  );
                                  const message = getDaysLeftMessage(daysLeft);
                                  return message.color;
                                })()}`}
                              >
                                {(() => {
                                  const daysLeft = calculateDaysLeft(
                                    escrow.createdAt,
                                    escrow.duration,
                                  );
                                  const message = getDaysLeftMessage(daysLeft);
                                  return message.text;
                                })()}
                              </p>
                            </div>
                          </div>
                          {escrow.status === "completed" &&
                            escrowRatings[escrow.id] && (
                              <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                                <Star className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                                <div>
                                  <p className="text-sm text-gray-600 dark:text-gray-400">
                                    Client Rating
                                  </p>
                                  <p className="font-semibold text-yellow-700 dark:text-yellow-400 flex items-center gap-1">
                                    {Array.from({ length: 5 }, (_, i) => (
                                      <Star
                                        key={i}
                                        className={`h-4 w-4 ${
                                          i < escrowRatings[escrow.id].rating
                                            ? "fill-yellow-400 text-yellow-400"
                                            : "text-gray-300"
                                        }`}
                                      />
                                    ))}
                                    <span className="ml-1">
                                      {escrowRatings[escrow.id].rating}/5
                                    </span>
                                  </p>
                                </div>
                              </div>
                            )}
                        </div>

                        {/* Milestones - Compact Design */}
                        {expandedEscrow === escrow.id && (
                          <div className="mb-6">
                            <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">
                              Milestones (
                              {escrow.milestoneCount ||
                                escrow.milestones.length}{" "}
                              total)
                            </h4>

                            {/* Milestone Progress */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                              {escrow.milestones.map((milestone, index) => {
                                const milestoneKey = `${escrow.id}-${index}`;
                                const isApproved =
                                  milestone.status === "approved" ||
                                  approvedMilestones.has(milestoneKey);
                                const isSubmitted =
                                  milestone.status === "submitted" ||
                                  submittedMilestones.has(milestoneKey);
                                const isPending =
                                  milestone.status === "pending" &&
                                  !submittedMilestones.has(milestoneKey) &&
                                  !approvedMilestones.has(milestoneKey);

                                // Determine if this is the current milestone that can be submitted
                                let isCurrent = false;
                                let isBlocked = false;
                                if (isPending) {
                                  // For the first milestone, it can always be current if pending
                                  if (index === 0) {
                                    isCurrent = true;
                                  } else {
                                    // For subsequent milestones, check if the previous one is approved
                                    const previousMilestone =
                                      escrow.milestones[index - 1];
                                    const previousMilestoneKey = `${escrow.id}-${
                                      index - 1
                                    }`;

                                    // Check if previous milestone is approved
                                    const isPreviousApproved =
                                      previousMilestone &&
                                      (previousMilestone.status ===
                                        "approved" ||
                                        approvedMilestones.has(
                                          previousMilestoneKey,
                                        ));

                                    // Check if there are any submitted milestones before this one that aren't approved
                                    let hasUnapprovedSubmitted = false;
                                    for (let j = 0; j < index; j++) {
                                      const prevMilestone =
                                        escrow.milestones[j];
                                      const prevMilestoneKey = `${escrow.id}-${j}`;
                                      const isPrevSubmitted =
                                        prevMilestone.status === "submitted" ||
                                        submittedMilestones.has(
                                          prevMilestoneKey,
                                        );
                                      const isPrevApproved =
                                        prevMilestone.status === "approved" ||
                                        approvedMilestones.has(
                                          prevMilestoneKey,
                                        );

                                      if (isPrevSubmitted && !isPrevApproved) {
                                        hasUnapprovedSubmitted = true;
                                        break;
                                      }
                                    }

                                    // Only allow submission if previous milestone is approved AND no submitted milestones are pending
                                    if (
                                      isPreviousApproved &&
                                      !hasUnapprovedSubmitted
                                    ) {
                                      isCurrent = true;
                                    } else if (hasUnapprovedSubmitted) {
                                      isBlocked = true;
                                    }
                                  }
                                }

                                return (
                                  <div
                                    key={index}
                                    className={`p-4 rounded-lg border-2 ${
                                      isApproved
                                        ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                                        : isSubmitted
                                          ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800"
                                          : isCurrent
                                            ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
                                            : isBlocked
                                              ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                                              : "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700"
                                    }`}
                                  >
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                                        Milestone {index + 1}
                                      </span>
                                      <div className="flex gap-1">
                                        {isCurrent && (
                                          <Badge className="bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200">
                                            Current
                                          </Badge>
                                        )}
                                        {isBlocked && (
                                          <Badge className="bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200">
                                            Blocked
                                          </Badge>
                                        )}
                                        <Badge
                                          className={getMilestoneStatusColor(
                                            milestone.status,
                                          )}
                                        >
                                          {milestone.status}
                                        </Badge>
                                      </div>
                                    </div>

                                    {/* Client Requirements */}
                                    {milestone.description &&
                                      !milestone.description.includes(
                                        "To be defined",
                                      ) &&
                                      milestone.description !==
                                        `Milestone ${index + 1}` && (
                                        <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                                          <span className="font-medium">
                                            Requirements:
                                          </span>
                                          <p className="mt-1 line-clamp-2">
                                            {milestone.description.length > 80
                                              ? milestone.description.substring(
                                                  0,
                                                  80,
                                                ) + "..."
                                              : milestone.description}
                                          </p>
                                        </div>
                                      )}

                                    <div className="text-sm font-semibold text-green-600 dark:text-green-400">
                                      {formatAmount(milestone.amount)} tokens
                                    </div>

                                    {/* Show rejected status if milestone is rejected */}
                                    {milestone.status === "rejected" && (
                                      <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                                        <div className="flex items-center gap-2 mb-2">
                                          <Badge className="bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200">
                                            Rejected - Needs Improvement
                                          </Badge>
                                        </div>

                                        {/* Display feedback directly */}
                                        {milestone.disputeReason && (
                                          <div className="mb-3 p-2 bg-red-100 dark:bg-red-800/30 rounded border border-red-200 dark:border-red-700">
                                            <p className="text-xs font-medium text-red-800 dark:text-red-200 mb-1">
                                              Client Feedback:
                                            </p>
                                            <p className="text-sm text-red-700 dark:text-red-300">
                                              {milestone.disputeReason}
                                            </p>
                                          </div>
                                        )}

                                        <p className="text-sm text-red-700 dark:text-red-300 mb-3">
                                          This milestone was rejected by the
                                          client. Please review the feedback
                                          above and resubmit with improvements.
                                        </p>

                                        <div className="flex gap-2">
                                          <Button
                                            size="sm"
                                            className="bg-red-600 hover:bg-red-700 text-white"
                                            onClick={() => {
                                              setSelectedResubmitEscrow(
                                                escrow.id,
                                              );
                                              setSelectedResubmitMilestone(
                                                index,
                                              );
                                              setResubmitDescription("");
                                              setShowResubmitDialog(true);
                                            }}
                                          >
                                            Resubmit Work
                                          </Button>
                                        </div>
                                      </div>
                                    )}

                                    {/* Show resolved status with winner info */}
                                    {milestone.status === "resolved" && (
                                      <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                                        <div className="flex items-center gap-2 mb-2">
                                          <Badge className="bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200">
                                            Resolved
                                          </Badge>
                                        </div>
                                        {(() => {
                                          // Determine winner based on resolution amount or escrow state
                                          if (
                                            milestone.resolutionAmount !==
                                            undefined
                                          ) {
                                            const resolutionAmount = Number(
                                              milestone.resolutionAmount,
                                            );
                                            return (
                                              <div className="text-sm">
                                                {resolutionAmount > 0 ? (
                                                  <p className="text-green-600 dark:text-green-400 font-medium">
                                                    ✅ You won!{" "}
                                                    {(
                                                      resolutionAmount / 1e7
                                                    ).toFixed(2)}{" "}
                                                    tokens awarded
                                                  </p>
                                                ) : (
                                                  <p className="text-orange-600 dark:text-orange-400 font-medium">
                                                    ❌ Client won - Full refund
                                                    issued
                                                  </p>
                                                )}
                                              </div>
                                            );
                                          }
                                          // Infer from escrow state
                                          if (
                                            escrow.releasedAmount &&
                                            escrow.totalAmount
                                          ) {
                                            const released = Number(
                                              escrow.releasedAmount,
                                            );
                                            const milestoneAmount = Number(
                                              milestone.amount,
                                            );
                                            if (
                                              released >=
                                              milestoneAmount * 0.9
                                            ) {
                                              return (
                                                <p className="text-green-600 dark:text-green-400 font-medium text-sm">
                                                  ✅ You won! Payment released
                                                </p>
                                              );
                                            } else {
                                              return (
                                                <p className="text-orange-600 dark:text-orange-400 font-medium text-sm">
                                                  ❌ Client won - Refund issued
                                                </p>
                                              );
                                            }
                                          }
                                          return (
                                            <p className="text-sm text-blue-700 dark:text-blue-300">
                                              Dispute has been resolved by admin
                                            </p>
                                          );
                                        })()}
                                      </div>
                                    )}

                                    {/* Show disputed status if milestone is disputed */}
                                    {milestone.status === "disputed" && (
                                      <div className="mt-3 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                                        <div className="flex items-center gap-2 mb-2">
                                          <Badge className="bg-orange-100 dark:bg-orange-800 text-orange-800 dark:text-orange-200">
                                            Disputed - Under Review
                                          </Badge>
                                        </div>
                                        <p className="text-sm text-orange-700 dark:text-orange-300 mb-3">
                                          This milestone is currently under
                                          dispute. The admin will review the
                                          case and make a fair resolution.
                                        </p>
                                        {milestone.disputeReason && (
                                          <div className="mt-2 p-2 bg-orange-100 dark:bg-orange-800/30 rounded border border-orange-200 dark:border-orange-700">
                                            <p className="text-xs font-medium text-orange-800 dark:text-orange-200 mb-1">
                                              Reason for dispute:
                                            </p>
                                            <p className="text-sm text-orange-700 dark:text-orange-300">
                                              {milestone.disputeReason}
                                            </p>
                                          </div>
                                        )}
                                        <div className="flex gap-2 flex-wrap">
                                          <EvidenceSubmissionButton
                                            escrowId={String(escrow.id)}
                                            milestoneIndex={index}
                                          />
                                          <ViewEvidenceButton
                                            escrowId={String(escrow.id)}
                                            milestoneIndex={index}
                                            clientAddress={escrow.payer}
                                            freelancerAddress={escrow.beneficiary}
                                          />
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {/* Current Milestone Submission Form */}
                            {(() => {
                              // Find the current milestone that can be submitted
                              // Only allow submission of the next milestone in sequence
                              let currentMilestoneIndex = -1;

                              for (
                                let i = 0;
                                i < escrow.milestones.length;
                                i++
                              ) {
                                const milestone = escrow.milestones[i];
                                const milestoneKey = `${escrow.id}-${i}`;

                                // Check if this milestone is pending and can be submitted
                                if (
                                  milestone.status === "pending" &&
                                  !submittedMilestones.has(milestoneKey) &&
                                  !approvedMilestones.has(milestoneKey)
                                ) {
                                  // For the first milestone, it can always be submitted if pending
                                  if (i === 0) {
                                    currentMilestoneIndex = i;
                                    break;
                                  }

                                  // For subsequent milestones, check if the previous one is approved
                                  const previousMilestone =
                                    escrow.milestones[i - 1];
                                  const previousMilestoneKey = `${escrow.id}-${
                                    i - 1
                                  }`;

                                  // Check if previous milestone is approved
                                  const isPreviousApproved =
                                    previousMilestone &&
                                    (previousMilestone.status === "approved" ||
                                      approvedMilestones.has(
                                        previousMilestoneKey,
                                      ));

                                  // Check if there are any submitted milestones before this one that aren't approved
                                  let hasUnapprovedSubmitted = false;
                                  for (let j = 0; j < i; j++) {
                                    const prevMilestone = escrow.milestones[j];
                                    const prevMilestoneKey = `${escrow.id}-${j}`;
                                    const isPrevSubmitted =
                                      prevMilestone.status === "submitted" ||
                                      submittedMilestones.has(prevMilestoneKey);
                                    const isPrevApproved =
                                      prevMilestone.status === "approved" ||
                                      approvedMilestones.has(prevMilestoneKey);

                                    if (isPrevSubmitted && !isPrevApproved) {
                                      hasUnapprovedSubmitted = true;
                                      break;
                                    }
                                  }

                                  // Only allow submission if previous milestone is approved AND no submitted milestones are pending
                                  if (
                                    isPreviousApproved &&
                                    !hasUnapprovedSubmitted
                                  ) {
                                    currentMilestoneIndex = i;
                                    break;
                                  }
                                }
                              }

                              if (currentMilestoneIndex === -1) {
                                return (
                                  <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-center">
                                    <p className="text-gray-600 dark:text-gray-400">
                                      All milestones completed or in progress
                                    </p>
                                  </div>
                                );
                              }

                              const currentMilestone =
                                escrow.milestones[currentMilestoneIndex];
                              const milestoneKey = `${escrow.id}-${currentMilestoneIndex}`;
                              const isSubmitted =
                                currentMilestone.status === "submitted" ||
                                submittedMilestones.has(milestoneKey);
                              const canSubmit =
                                currentMilestone.status === "pending" &&
                                escrow.status === "active" &&
                                !submittedMilestones.has(milestoneKey) &&
                                !approvedMilestones.has(milestoneKey);

                              // Don't show form if milestone is already submitted
                              if (isSubmitted) {
                                return (
                                  <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <h5 className="font-semibold text-yellow-900 dark:text-yellow-100 mb-1">
                                          Milestone {currentMilestoneIndex + 1}{" "}
                                          Submitted
                                        </h5>
                                        <p className="text-sm text-yellow-700 dark:text-yellow-300">
                                          Awaiting client approval...
                                        </p>
                                      </div>
                                      <div className="flex gap-2">
                                        <Badge className="bg-yellow-100 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-100">
                                          Submitted
                                        </Badge>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => {
                                            setSelectedEscrowId(escrow.id);
                                            setSelectedMilestoneIndex(
                                              currentMilestoneIndex,
                                            );
                                            setDisputeReason("");
                                            setShowDisputeDialog(true);
                                          }}
                                        >
                                          Dispute
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              }

                              return (
                                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                                  <h5 className="font-semibold text-blue-900 dark:text-blue-100 mb-3">
                                    Submit Milestone {currentMilestoneIndex + 1}
                                  </h5>

                                  {/* Client Requirements */}
                                  {currentMilestone.description &&
                                    !currentMilestone.description.includes(
                                      "To be defined",
                                    ) &&
                                    currentMilestone.description !==
                                      `Milestone ${currentMilestoneIndex + 1}` && (
                                      <div className="mb-3 p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                                        <div className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">
                                          Client Requirements:
                                        </div>
                                        <div className="text-sm text-blue-700 dark:text-blue-300">
                                          {currentMilestone.description}
                                        </div>
                                      </div>
                                    )}

                                  {/* Show input form only if not submitted */}
                                  {!isSubmitted && (
                                    <div className="space-y-3">
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                          Your Work Description
                                        </label>
                                        <Textarea
                                          value={
                                            milestoneDescriptions[
                                              milestoneKey
                                            ] || ""
                                          }
                                          onChange={(e) =>
                                            setMilestoneDescriptions(
                                              (prev) => ({
                                                ...prev,
                                                [milestoneKey]: e.target.value,
                                              }),
                                            )
                                          }
                                          className="text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                                          rows={3}
                                          placeholder="Describe what you've completed for this milestone..."
                                        />
                                      </div>

                                      {/* File attachment */}
                                      {isApiConfigured() && (
                                        <div>
                                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                            Attach File{" "}
                                            <span className="font-normal text-gray-400 dark:text-gray-500">
                                              (optional · PDF, images, docs ·
                                              max 10 MB)
                                            </span>
                                          </label>
                                          {milestoneAttachments[
                                            milestoneKey
                                          ] ? (
                                            <div className="flex items-center gap-2 p-2 rounded bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-sm">
                                              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                                              <span className="truncate text-green-700 dark:text-green-300">
                                                {
                                                  milestoneAttachments[
                                                    milestoneKey
                                                  ]!.filename
                                                }
                                              </span>
                                              <button
                                                type="button"
                                                className="ml-auto text-gray-400 hover:text-red-500 text-xs shrink-0"
                                                onClick={() =>
                                                  setMilestoneAttachments(
                                                    (prev) => ({
                                                      ...prev,
                                                      [milestoneKey]: null,
                                                    }),
                                                  )
                                                }
                                              >
                                                Remove
                                              </button>
                                            </div>
                                          ) : milestoneFiles[milestoneKey] ? (
                                            <div className="flex items-center gap-2 p-2 rounded bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 text-sm">
                                              <Clock className="h-4 w-4 text-blue-500 shrink-0 animate-pulse" />
                                              <span className="truncate text-blue-700 dark:text-blue-300">
                                                {
                                                  milestoneFiles[milestoneKey]!
                                                    .name
                                                }
                                              </span>
                                              <button
                                                type="button"
                                                className="ml-auto text-gray-400 hover:text-red-500 text-xs shrink-0"
                                                onClick={() =>
                                                  setMilestoneFiles((prev) => ({
                                                    ...prev,
                                                    [milestoneKey]: null,
                                                  }))
                                                }
                                              >
                                                Remove
                                              </button>
                                            </div>
                                          ) : (
                                            <label className="flex items-center justify-center gap-2 p-2.5 rounded border-2 border-dashed border-gray-200 dark:border-gray-600 cursor-pointer hover:border-primary/50 transition-colors text-sm text-gray-500 dark:text-gray-400">
                                              <input
                                                type="file"
                                                className="sr-only"
                                                accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.zip,.doc,.docx"
                                                onChange={(e) => {
                                                  const f = e.target.files?.[0];
                                                  if (f)
                                                    setMilestoneFiles(
                                                      (prev) => ({
                                                        ...prev,
                                                        [milestoneKey]: f,
                                                      }),
                                                    );
                                                }}
                                              />
                                              <span>
                                                Click to attach a file
                                              </span>
                                            </label>
                                          )}
                                        </div>
                                      )}

                                      <div className="flex gap-2">
                                        {canSubmit && (
                                          <Button
                                            size="sm"
                                            onClick={() =>
                                              submitMilestone(
                                                escrow.id,
                                                currentMilestoneIndex,
                                              )
                                            }
                                            disabled={
                                              submittingMilestone ===
                                                milestoneKey ||
                                              milestoneUploading[
                                                milestoneKey
                                              ] ||
                                              !milestoneDescriptions[
                                                milestoneKey
                                              ]?.trim()
                                            }
                                          >
                                            {milestoneUploading[milestoneKey]
                                              ? "Uploading…"
                                              : submittingMilestone ===
                                                  milestoneKey
                                                ? "Submitting..."
                                                : "Submit Milestone"}
                                          </Button>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {/* Show submitted status if milestone is submitted */}
                                  {isSubmitted && (
                                    <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                                      <div className="flex items-center gap-2 mb-2">
                                        <Badge className="bg-yellow-100 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200">
                                          Submitted - Awaiting Approval
                                        </Badge>
                                      </div>
                                      <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-3">
                                        Your milestone has been submitted and is
                                        waiting for client approval.
                                      </p>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          setSelectedEscrowId(escrow.id);
                                          setSelectedMilestoneIndex(
                                            currentMilestoneIndex,
                                          );
                                          setDisputeReason("");
                                          setShowDisputeDialog(true);
                                        }}
                                        className="border-yellow-300 dark:border-yellow-600 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-800"
                                      >
                                        Dispute
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {/* Overdue dispute banner (freelancer side) */}
                        {(() => {
                          const now = Date.now();
                          const deadlineAt = escrow.deadlineAt ?? 0;
                          const isOverdue = deadlineAt > 0 && now > deadlineAt;
                          const isActive =
                            escrow.status === "active" ||
                            escrow.status === "pending";
                          if (!isOverdue || !isActive) return null;
                          return (
                            <OverdueFreelancerBanner
                              escrowId={escrow.id}
                              onRaiseDispute={raiseOverdueDispute}
                            />
                          );
                        })()}

                        {/* Actions */}
                        <div className="flex gap-3">
                          {escrow.status === "pending" && (
                            <Button
                              onClick={() => startWork(escrow.id)}
                              className="flex items-center gap-2"
                            >
                              <Play className="h-4 w-4" />
                              Start Work
                            </Button>
                          )}
                          {escrow.status === "active" && (
                            <Badge className="bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-100">
                              Work Started
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
            </div>
          </div>
        )}

        {/* Dispute Dialog */}
        {showDisputeDialog && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-lg flex items-center justify-center z-50">
            <Card className="w-full max-w-md mx-4">
              <CardHeader>
                <CardTitle>Open Dispute</CardTitle>
                <CardDescription>
                  Provide a reason for disputing this milestone
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Dispute Reason
                    </label>
                    <textarea
                      value={disputeReason}
                      onChange={(e) => setDisputeReason(e.target.value)}
                      placeholder="Explain why you're disputing this milestone..."
                      className="w-full p-3 border rounded-lg resize-none"
                      rows={4}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        if (
                          selectedEscrowId &&
                          selectedMilestoneIndex !== null
                        ) {
                          openDispute(
                            selectedEscrowId,
                            selectedMilestoneIndex,
                            disputeReason,
                          );
                          setShowDisputeDialog(false);
                        }
                      }}
                      disabled={
                        !disputeReason.trim() || submittingMilestone !== null
                      }
                      className="flex-1"
                    >
                      {submittingMilestone ? "Opening..." : "Open Dispute"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setShowDisputeDialog(false)}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Resubmit Dialog */}
        {showResubmitDialog && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-lg flex items-center justify-center z-50">
            <Card className="w-full max-w-md mx-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Resubmit Milestone</CardTitle>
                <CardDescription className="text-sm">
                  Resubmit milestone{" "}
                  {selectedResubmitMilestone !== null
                    ? selectedResubmitMilestone + 1
                    : ""}{" "}
                  for client review. Make sure you've addressed the feedback.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-3">
                  {/* Show rejection reason if available */}
                  {selectedResubmitEscrow &&
                    selectedResubmitMilestone !== null && (
                      <div>
                        <label className="block text-sm font-medium mb-1.5 text-red-600">
                          Rejection Reason
                        </label>
                        <div className="p-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
                          {(() => {
                            const escrow = escrows.find(
                              (e) => e.id === selectedResubmitEscrow,
                            );
                            if (
                              escrow &&
                              escrow.milestones &&
                              escrow.milestones[selectedResubmitMilestone]
                            ) {
                              const milestone =
                                escrow.milestones[selectedResubmitMilestone];
                              // The rejection reason should be in the last field of the milestone data
                              return (
                                milestone.rejectionReason ||
                                "No reason provided"
                              );
                            }
                            return "No reason provided";
                          })()}
                        </div>
                      </div>
                    )}

                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      Update Message
                    </label>
                    <textarea
                      value={resubmitDescription}
                      onChange={(e) => setResubmitDescription(e.target.value)}
                      placeholder="Describe the improvements you've made to address the client's feedback..."
                      className="w-full p-2.5 border rounded-lg resize-none text-sm"
                      rows={3}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      This message will be sent to the client along with your
                      resubmission.
                    </p>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      onClick={() => {
                        if (
                          selectedResubmitEscrow &&
                          selectedResubmitMilestone !== null
                        ) {
                          resubmitMilestone(
                            selectedResubmitEscrow,
                            selectedResubmitMilestone,
                            resubmitDescription,
                          );
                        }
                      }}
                      disabled={
                        !resubmitDescription.trim() ||
                        submittingMilestone !== null
                      }
                      className="flex-1"
                    >
                      {submittingMilestone
                        ? "Resubmitting..."
                        : "Resubmit Milestone"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowResubmitDialog(false);
                        setResubmitDescription("");
                        setSelectedResubmitEscrow(null);
                        setSelectedResubmitMilestone(null);
                      }}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
