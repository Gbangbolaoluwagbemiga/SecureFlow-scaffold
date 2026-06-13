import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { useWeb3 } from "@/contexts/web3-context";
import { useToast } from "@/hooks/use-toast";
import { CONTRACTS } from "@/lib/web3/config";

import {
  useNotifications,
  createEscrowNotification,
  createMilestoneNotification,
} from "@/contexts/notification-context";
import type { Escrow } from "@/lib/web3/types";
// import { motion } from "framer-motion"; // Unused
import {
  Wallet,
  // CheckCircle2, // Unused
  // AlertCircle, // Unused
  FileText,
  // Clock, // Unused
  // TrendingUp, // Unused
} from "lucide-react";
// import { Badge } from "@/components/ui/badge"; // Unused
// import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"; // Unused
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardStats } from "@/components/dashboard/dashboard-stats";
import { EscrowCard } from "@/components/dashboard/escrow-card";
import { DashboardLoading } from "@/components/dashboard/dashboard-loading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export default function DashboardPage() {
  const { wallet, getContract, refreshBalance } = useWeb3();
  const { toast } = useToast();
  const { addNotification } = useNotifications();
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const escrowsRef = useRef<Escrow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Keep ref in sync with state
  useEffect(() => {
    escrowsRef.current = escrows;
  }, [escrows]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "active" | "completed" | "disputed"
  >("all");
  const [sortFilter, setSortFilter] = useState<"newest" | "oldest">("newest");
  const [expandedEscrow, setExpandedEscrow] = useState<string | null>(null);
  const [submittingMilestone, setSubmittingMilestone] = useState<string | null>(
    null,
  );

  const getStatusFromNumber = (status: number): string => {
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
        return "active"; // Changed from "cancelled" to "active" for disputed escrows
      default:
        return "pending";
    }
  };

  // Check if an escrow should be marked as terminated (has disputed or resolved milestones)
  // const isEscrowTerminated = (escrow: Escrow): boolean => { // Unused
  //   return escrow.milestones.some(
  //     (milestone) =>
  //       milestone.status === "disputed" ||
  //       milestone.status === "rejected" ||
  //       milestone.status === "resolved"
  //   );
  // };

  // Check if all disputes have been resolved
  // const hasAllDisputesResolved = (escrow: Escrow): boolean => { // Unused
  //   const disputedMilestones = escrow.milestones.filter(
  //     (milestone) => milestone.status === "disputed"
  //   );
  //   return (
  //     disputedMilestones.length === 0 &&
  //     escrow.milestones.some((milestone) => milestone.status === "resolved")
  //   );
  // };

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

  useEffect(() => {
    if (wallet.isConnected) {
      fetchUserEscrows();
    }
  }, [wallet.isConnected]);

  // Listen for escrow update events from MilestoneActions
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
      fetchUserEscrows(true);
      window.setTimeout(() => void fetchUserEscrows(true), 1200);
      window.setTimeout(() => void fetchUserEscrows(true), 3000);
    };

    window.addEventListener("escrowUpdated", handleEscrowUpdated);
    window.addEventListener("milestoneApproved", handleEscrowUpdated);

    return () => {
      window.removeEventListener("escrowUpdated", handleEscrowUpdated);
      window.removeEventListener("milestoneApproved", handleEscrowUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address]);

  const fetchUserEscrows = async (isManualRefresh = false) => {
    // Use ref to get the most current escrows, not the stale closure value
    const previousEscrows = escrowsRef.current;
    const previousEscrowsCount = previousEscrows.length;

    // Don't set loading to true if we're refreshing after an operation - preserve UI
    if (isManualRefresh) {
      setIsRefreshing(true);
    } else if (previousEscrowsCount === 0) {
      // Only set loading if we don't have escrows yet (initial load)
      setLoading(true);
    }
    try {
      if (!wallet.isConnected || !wallet.address) {
        // Only clear escrows if we're doing an initial load, not a refresh
        if (!isManualRefresh && previousEscrowsCount === 0) {
          setEscrows([]);
        }
        setLoading(false);
        return;
      }

      // Use ContractService instead of contract.call - it reads from blockchain
      const { ContractService } = await import("@/lib/web3/contract-service");
      const contractService = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);

      // Get next escrow ID from blockchain (not hardcoded)
      const nextEscrowId = await contractService.getNextEscrowId();

      const userEscrows: Escrow[] = [];

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

      // Fetch user's escrows from the contract
      // Check if there are any escrows created yet (nextEscrowId > 1 means at least one escrow exists)
      const maxEscrowsToCheck = Math.min(nextEscrowId - 1, 20);
      for (let i = 1; i <= maxEscrowsToCheck; i++) {
        try {
          const escrowData = await contractService.getEscrow(i);

          if (!escrowData) {
            continue;
          }

          // Check if user is involved in this escrow
          const isPayer =
            escrowData.creator &&
            escrowData.creator.toLowerCase().trim() ===
              wallet.address.toLowerCase().trim();
          const isBeneficiary =
            escrowData.freelancer &&
            escrowData.freelancer.toLowerCase().trim() ===
              wallet.address.toLowerCase().trim();

          // Show escrows for both clients and freelancers, but with different functionality
          if (isPayer || isBeneficiary) {
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
            let milestonesData: any[] = [];
            try {
              milestonesData = await contractService.getMilestones(i);
            } catch (milestoneError) {
              // Continue with empty milestones array if fetch fails
              milestonesData = [];
            }
            const milestones = milestonesData
              .map((m: any, milestoneIndex: number) => {
                try {
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
                  const SECONDS_PER_LEDGER = 5;
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

                  // Get resolution data if milestone is resolved
                  const resolvedAtLedger = m.resolved_at || 0;
                  const resolvedAt =
                    resolvedAtLedger > 0
                      ? Date.now() -
                        (currentLedger - resolvedAtLedger) *
                          SECONDS_PER_LEDGER *
                          1000
                      : undefined;

                  return {
                    description: m.description || "",
                    requirements: m.requirements || "",
                    amount: m.amount?.toString() || "0",
                    status,
                    submittedAt,
                    approvedAt,
                    disputeReason: m.dispute_reason || undefined,
                    rejectionReason: m.rejection_reason || undefined,
                    resolvedAt,
                    resolvedBy: m.resolved_by || undefined,
                    resolutionAmount: m.resolution_freelancer_amount?.toString() || undefined,
                    resolutionFreelancerAmount: m.resolution_freelancer_amount?.toString() || undefined,
                    resolutionClientAmount: m.resolution_client_amount?.toString() || undefined,
                    resolutionReason: m.resolution_reason || undefined,
                  };
                } catch (error) {
                  // Return a safe default milestone object if parsing fails
                  return {
                    description: m.description || "",
                    requirements: m.requirements || "",
                    amount: m.amount?.toString() || "0",
                    status: "pending" as const,
                    submittedAt: undefined,
                    approvedAt: undefined,
                    disputeReason: undefined,
                    rejectionReason: undefined,
                    resolutionAmount: undefined,
                    resolutionFreelancerAmount: undefined,
                    resolutionClientAmount: undefined,
                    resolutionReason: undefined,
                  };
                }
              })
              .filter((m) => m !== null && m !== undefined);

            // Compute approximate deadline timestamp (ms)
            const deadlineAt =
              deadlineLedger > 0
                ? Date.now() +
                  (deadlineLedger - currentLedger) * SECONDS_PER_LEDGER * 1000
                : undefined;

            // Convert contract data to our Escrow type
            const escrow: Escrow = {
              id: i.toString(),
              payer: escrowData.creator || "",
              beneficiary: escrowData.freelancer || "",
              isClient: isPayer ? true : undefined,
              isFreelancer: isBeneficiary ? true : undefined,
              token: escrowData.token || "native",
              totalAmount: escrowData.amount || "0",
              releasedAmount: escrowData.paid_amount || "0",
              status: getStatusFromNumber(escrowData.status || 0) as
                | "pending"
                | "active"
                | "completed"
                | "disputed",
              createdAt: approxCreatedAt,
              duration: durationInSeconds,
              deadlineAt,
              milestones,
              projectTitle: escrowData.project_title || "",
              projectDescription: escrowData.project_description || "",
            };

            userEscrows.push(escrow);
          }
        } catch (error) {
          // Skip escrows that don't exist or user doesn't have access to
          continue;
        }
      }

      // If we had escrows before but now have 0, preserve existing escrows and log warning
      if (previousEscrowsCount > 0 && userEscrows.length === 0) {
        // Don't update escrows - keep what we had
        // This prevents the dashboard from going empty after operations
        return;
      }

      // Always update escrows if fetch was successful
      // The error handling in catch block will preserve escrows if fetch fails
      setEscrows(userEscrows);
    } catch (error) {
      // Don't clear existing escrows on error - preserve what we have
      // Only show toast if we don't have any escrows yet
      if (escrows.length === 0) {
        toast({
          title: "Failed to load escrows",
          description: "Could not fetch your escrows from the blockchain",
          variant: "destructive",
        });
      } else {
        // If we have existing escrows, just log the error but don't show toast
        // This prevents clearing the UI when a refresh fails
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleRefresh = () => {
    fetchUserEscrows(true);
  };

  // const getStatusBadge = (status: string, escrow?: Escrow) => { // Unused
  //   // Check if this escrow should be terminated
  //   const isTerminated = escrow ? isEscrowTerminated(escrow) : false;
  //   const finalStatus = isTerminated ? "terminated" : status;
  //
  //   const variants: Record<string, { variant: any; icon: any; label: string }> =
  //     {
  //       pending: { variant: "secondary", icon: Clock, label: "Pending" },
  //       active: { variant: "default", icon: TrendingUp, label: "Active" },
  //       completed: {
  //         variant: "outline",
  //         icon: CheckCircle2,
  //         label: "Completed",
  //       },
  //       disputed: {
  //         variant: "destructive",
  //         icon: AlertCircle,
  //         label: "Disputed",
  //       },
  //       terminated: {
  //         variant: "secondary",
  //         icon: AlertCircle,
  //         label: "Terminated",
  //       },
  //     };
  //
  //   const config = variants[finalStatus] || variants.pending;
  //   const Icon = config.icon;
  //
  //   return (
  //     <Badge variant={config.variant} className="gap-1">
  //       <Icon className="h-3 w-3" />
  //       {config.label}
  //     </Badge>
  //   );
  // };

  // const getMilestoneStatusBadge = (status: string) => { // Unused
  //   const variants: Record<string, { variant: any; label: string }> = {
  //     pending: { variant: "secondary", label: "Pending" },
  //     submitted: { variant: "default", label: "Submitted" },
  //     approved: { variant: "outline", label: "Approved" },
  //     disputed: { variant: "destructive", label: "Disputed" },
  //   };
  //
  //   const config = variants[status] || variants.pending;
  //
  //   return (
  //     <Badge variant={config.variant} className="text-xs">
  //       {config.label}
  //     </Badge>
  //   );
  // };

  // const calculateProgress = (escrow: Escrow) => { // Unused
  //   const released = Number.parseFloat(escrow.releasedAmount) / 1e7;
  //   const total = Number.parseFloat(escrow.totalAmount) / 1e7;
  //   return total > 0 ? (released / total) * 100 : 0;
  // };

  // const formatAmount = (amount: string) => { // Unused
  //   return (Number.parseFloat(amount) / 1e7).toFixed(2);
  // };

  // const getTokenInfo = (tokenAddress: string) => { // Unused
  //   return {
  //     name:
  //       tokenAddress === "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
  //         ? "MON"
  //         : "Token",
  //     symbol:
  //       tokenAddress === "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
  //         ? "MON"
  //         : "TKN",
  //   };
  // };

  // const getStatusColor = (status: string) => { // Unused
  //   switch (status) {
  //     case "pending":
  //       return "bg-yellow-100 text-yellow-800";
  //     case "active":
  //       return "bg-blue-100 text-blue-800";
  //     case "completed":
  //       return "bg-green-100 text-green-800";
  //     case "disputed":
  //       return "bg-red-100 text-red-800";
  //     default:
  //       return "bg-gray-100 text-gray-800";
  //   }
  // };

  // const getMilestoneStatusColor = (status: string) => { // Unused
  //   switch (status) {
  //     case "pending":
  //       return "bg-yellow-100 text-yellow-800";
  //     case "submitted":
  //       return "bg-blue-100 text-blue-800";
  //     case "approved":
  //       return "bg-green-100 text-green-800";
  //     case "disputed":
  //       return "bg-red-100 text-red-800";
  //     default:
  //       return "bg-gray-100 text-gray-800";
  //   }
  // };

  // const filterEscrows = (filter: string) => { // Unused
  //   if (filter === "all") return escrows;
  //   return escrows.filter((e) => e.status === filter);
  // };

  const disputeMilestone = async (escrowId: string, milestoneIndex: number) => {
    try {
      // SECURITY: Double-check that user is the depositor
      const escrow = escrows.find((e) => e.id === escrowId);
      if (
        !escrow ||
        escrow.payer.toLowerCase() !== wallet.address?.toLowerCase()
      ) {
        toast({
          title: "Access Denied",
          description: "Only the job creator can dispute milestones",
          variant: "destructive",
        });
        return;
      }

      setSubmittingMilestone(`${escrowId}-${milestoneIndex}`);
      const { ContractService } = await import("@/lib/web3/contract-service");
      const contractService = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);

      toast({
        title: "Disputing milestone...",
        description: "Please confirm the transaction in your wallet",
      });

      await contractService.disputeMilestone({
        escrow_id: Number(escrowId),
        milestone_index: milestoneIndex,
        reason: "Disputed by client",
        disputer: wallet.address || "",
      });

      toast({
        title: "Milestone Disputed",
        description: "A dispute has been opened for this milestone",
      });

      // Wait a moment for blockchain state to update
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        await fetchUserEscrows(true);
      } catch (refreshError: any) {
        toast({
          title: "Milestone Disputed",
          description:
            "Milestone was disputed, but failed to refresh data. Please refresh the page.",
          variant: "default",
        });
        // Don't throw - the dispute was successful, just the refresh failed
      }
    } catch (error: any) {
      toast({
        title: "Dispute Failed",
        description: error.message || "Failed to dispute milestone",
        variant: "destructive",
      });
    } finally {
      setSubmittingMilestone(null);
    }
  };

  const startWork = async (escrowId: string) => {
    try {
      const contract = getContract(CONTRACTS.SECUREFLOW_ESCROW);
      if (!contract) return;

      setSubmittingMilestone(escrowId);
      await contract.send("start_work", escrowId);
      toast({
        title: "Work Started",
        description: "You have started work on this escrow",
      });

      // Get freelancer address from escrow data
      const escrow = escrows.find((e) => e.id === escrowId);
      const payer = escrow?.payer;
      const beneficiary = escrow?.beneficiary;
      const current = wallet.address?.toLowerCase();
      const otherParty =
        current && payer?.toLowerCase() === current ? beneficiary : payer;

      // Notify the *other party* only (no self-notifications).
      if (otherParty) {
        addNotification(
          createEscrowNotification("work_started", escrowId, {
            projectTitle:
              escrows.find((e) => e.id === escrowId)?.projectDescription ||
              `Project #${escrowId}`,
            freelancerName:
              wallet.address!.slice(0, 6) + "..." + wallet.address!.slice(-4),
          }),
          [otherParty],
        );
      }

      // Wait a moment for blockchain state to update
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await fetchUserEscrows();
    } catch (error) {
      toast({
        title: "Start Work Failed",
        description: "Could not start work. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmittingMilestone(null);
    }
  };

  const openDispute = async (escrowId: string) => {
    try {
      setSubmittingMilestone(escrowId);
      const { ContractService } = await import("@/lib/web3/contract-service");
      const contractService = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);

      await contractService.disputeMilestone({
        escrow_id: Number(escrowId),
        milestone_index: 0,
        reason: "General dispute",
        disputer: wallet.address || "",
      });

      toast({
        title: "Dispute Opened",
        description: "A dispute has been opened for this escrow",
      });

      // Wait a moment for blockchain state to update
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        await fetchUserEscrows(true);
      } catch (refreshError: any) {
        toast({
          title: "Dispute Opened",
          description:
            "Dispute was opened, but failed to refresh data. Please refresh the page.",
          variant: "default",
        });
        // Don't throw - the dispute was successful, just the refresh failed
      }
    } catch (error: any) {
      toast({
        title: "Dispute Failed",
        description: "Could not open dispute. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmittingMilestone(null);
    }
  };

  const approveMilestone = async (escrowId: string, milestoneIndex: number) => {
    try {
      // SECURITY: Double-check that user is the depositor
      const escrow = escrows.find((e) => e.id === escrowId);
      if (
        !escrow ||
        escrow.payer.toLowerCase() !== wallet.address?.toLowerCase()
      ) {
        toast({
          title: "Access Denied",
          description: "Only the job creator can approve milestones",
          variant: "destructive",
        });
        return;
      }

      setSubmittingMilestone(`${escrowId}-${milestoneIndex}`);
      const contract = getContract(CONTRACTS.SECUREFLOW_ESCROW);
      if (!contract) return;

      toast({
        title: "Approving milestone...",
        description: "Please confirm the transaction in your wallet",
      });

      await contract.send(
        "approve_milestone",
        "no-value",
        escrowId,
        milestoneIndex,
      );

      // Transaction is already confirmed via waitForConfirmation in web3-context
      // For Stellar, we don't need to poll for receipts like Ethereum
      // The transaction hash is returned after confirmation
      toast({
        title: "Milestone Approved!",
        description: "Payment has been sent to the freelancer",
      });

      // Get freelancer address from escrow data
      const freelancerAddress = escrow.beneficiary;

      // Notify freelancer only (no self-notifications).
      if (freelancerAddress) {
        addNotification(
          createMilestoneNotification("approved", escrowId, milestoneIndex, {
            clientName:
              wallet.address.slice(0, 6) + "..." + wallet.address.slice(-4),
            projectTitle: escrow.projectDescription || `Project #${escrowId}`,
          }),
          [freelancerAddress],
        );
      }

      // Refresh balance to reflect XLM released from escrow
      refreshBalance().catch(() => {});

      // Wait a moment for blockchain state to update
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Refresh the escrow data without reloading the page
      // Use manual refresh flag to prevent showing loading screen
      try {
        await fetchUserEscrows(true);
      } catch (refreshError: any) {
        toast({
          title: "Milestone Approved",
          description:
            "Milestone was approved, but failed to refresh data. Please refresh the page.",
          variant: "default",
        });
        // Don't throw - the approval was successful, just the refresh failed
      }

      // Dispatch event to notify other components
      window.dispatchEvent(new CustomEvent("milestoneApproved"));
    } catch (error: any) {
      toast({
        title: "Approval Failed",
        description: error.message || "Failed to approve milestone",
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
        description: "Arbiters have been notified and will review your case",
      });

      // Notify all authorized arbiters via the backend
      const escrow = escrows.find((e) => e.id === escrowId);
      try {
        const authorizedArbiters =
          await contractService.getAuthorizedArbiters();
        for (const arbAddr of authorizedArbiters) {
          addNotification(
            {
              type: "dispute",
              title: "Overdue Dispute Raised",
              message: `Project "${escrow?.projectDescription?.slice(0, 60) || `#${escrowId}`}" is overdue and needs arbitration`,
              actionUrl: `/admin?escrow=${escrowId}`,
              data: {
                escrowId,
                requester: wallet.address,
                reason,
              },
            },
            [arbAddr],
          );
        }
      } catch {
        /* arbiter fetch failed — non-critical */
      }

      await fetchUserEscrows(true);
    } catch (error: any) {
      toast({
        title: "Failed to raise dispute",
        description: error.message || "Transaction failed",
        variant: "destructive",
      });
    }
  };

  const extendDeadline = async (escrowId: string, extraDays: number) => {
    try {
      const { ContractService } = await import("@/lib/web3/contract-service");
      const contractService = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);
      toast({
        title: "Extending deadline…",
        description: "Please confirm the transaction in your wallet",
      });
      await contractService.extendDeadline({
        escrow_id: Number(escrowId),
        extra_seconds: extraDays * 24 * 3600,
        depositor: wallet.address || "",
      });
      toast({
        title: "Deadline extended",
        description: `Added ${extraDays} day${extraDays > 1 ? "s" : ""} to the project deadline`,
      });
      await fetchUserEscrows(true);
    } catch (error: any) {
      toast({
        title: "Failed to extend deadline",
        description: error.message || "Transaction failed",
        variant: "destructive",
      });
    }
  };

  const rejectMilestone = async (
    escrowId: string,
    milestoneIndex: number,
    reason: string,
  ) => {
    try {
      // SECURITY: Double-check that user is the depositor
      const escrow = escrows.find((e) => e.id === escrowId);
      if (
        !escrow ||
        escrow.payer.toLowerCase() !== wallet.address?.toLowerCase()
      ) {
        toast({
          title: "Access Denied",
          description: "Only the job creator can reject milestones",
          variant: "destructive",
        });
        return;
      }

      setSubmittingMilestone(`${escrowId}-${milestoneIndex}`);
      const { ContractService } = await import("@/lib/web3/contract-service");
      const contractService = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);

      toast({
        title: "Rejecting milestone...",
        description: "Please confirm the transaction in your wallet",
      });

      await contractService.rejectMilestone({
        escrow_id: Number(escrowId),
        milestone_index: milestoneIndex,
        reason: reason,
        depositor: wallet.address || "",
      });

      toast({
        title: "Milestone Rejected",
        description: "The freelancer has been notified and can resubmit",
      });

      // Wait a moment for blockchain state to update
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Refresh the escrow data without reloading the page
      // Use manual refresh flag to prevent showing loading screen
      try {
        await fetchUserEscrows(true);
      } catch (refreshError: any) {
        toast({
          title: "Milestone Rejected",
          description:
            "Milestone was rejected, but failed to refresh data. Please refresh the page.",
          variant: "default",
        });
        // Don't throw - the rejection was successful, just the refresh failed
      }
    } catch (error: any) {
      toast({
        title: "Rejection Failed",
        description: error.message || "Failed to reject milestone",
        variant: "destructive",
      });
    } finally {
      setSubmittingMilestone(null);
    }
  };

  // const toggleExpand = (id: string) => { // Unused
  //   setExpandedEscrow(expandedEscrow === id ? null : id);
  // };

  if (!wallet.isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-mesh">
        <Card className="glass border-primary/20 p-12 text-center max-w-md">
          <Wallet className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-2xl font-bold mb-2">Wallet Not Connected</h2>
          <p className="text-muted-foreground mb-6">
            Please connect your wallet to view your escrows
          </p>
        </Card>
      </div>
    );
  }

  if (loading) {
    return <DashboardLoading isConnected={wallet.isConnected} />;
  }

  // const completedEscrows = escrows.filter((e) => e.status === "completed"); // Unused
  // const totalVolume = escrows
  //   .reduce((sum, e) => sum + Number.parseFloat(e.totalAmount) / 1e7, 0)
  //   .toFixed(2); // Unused

  if (!wallet.isConnected) {
    return (
      <div className="min-h-screen py-12">
        <div className="container mx-auto px-4">
          <DashboardHeader />
          <Card className="glass border-primary/20 p-12 text-center max-w-md">
            <Wallet className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-2xl font-bold mb-2">Connect Your Wallet</h2>
            <p className="text-muted-foreground">
              Connect your wallet to view your escrows and manage milestones.
            </p>
          </Card>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen py-12">
        <div className="container mx-auto px-4">
          <DashboardHeader />
          <DashboardLoading isConnected={wallet.isConnected} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-12 relative">
      {/* Spinner overlay when refreshing */}
      {isRefreshing && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <RefreshCw className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Refreshing data...</p>
          </div>
        </div>
      )}
      <div className="container mx-auto px-4">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold mb-2">Dashboard</h1>
            <p className="text-xl text-muted-foreground">
              Manage your escrows and track your projects
            </p>
          </div>
          {/* Refresh Button */}
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

        <DashboardStats escrows={escrows} />

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

        {escrows.length === 0 ? (
          <Card className="glass border-muted p-12 text-center">
            <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-xl font-bold mb-2">No Escrows Found</h3>
            <p className="text-muted-foreground">
              You don't have any escrows yet. Create one to get started.
            </p>
          </Card>
        ) : (
          <div className="space-y-6">
            {escrows
              .filter((escrow) => {
                // Status filter
                const matchesStatus =
                  statusFilter === "all" || escrow.status === statusFilter;

                // Search filter
                const matchesSearch =
                  !searchQuery ||
                  (escrow.projectDescription &&
                    escrow.projectDescription
                      .toLowerCase()
                      .includes(searchQuery.toLowerCase()));

                return matchesStatus && matchesSearch;
              })
              .sort((a, b) => {
                if (sortFilter === "newest") {
                  return b.createdAt - a.createdAt;
                } else {
                  return a.createdAt - b.createdAt;
                }
              })
              .map((escrow, index) => (
                <EscrowCard
                  key={escrow.id}
                  escrow={escrow}
                  index={index}
                  expandedEscrow={expandedEscrow}
                  submittingMilestone={
                    submittingMilestone === escrow.id ? "true" : "false"
                  }
                  onToggleExpanded={() =>
                    setExpandedEscrow(
                      expandedEscrow === escrow.id ? null : escrow.id,
                    )
                  }
                  onApproveMilestone={approveMilestone}
                  onRejectMilestone={(
                    escrowId: string,
                    milestoneIndex: number,
                  ) => {
                    // For now, use empty reason - this should be handled by the component
                    rejectMilestone(
                      escrowId,
                      milestoneIndex,
                      "No reason provided",
                    );
                  }}
                  onDisputeMilestone={disputeMilestone}
                  onStartWork={startWork}
                  onDispute={openDispute}
                  calculateDaysLeft={calculateDaysLeft}
                  getDaysLeftMessage={getDaysLeftMessage}
                  onRaiseOverdueDispute={raiseOverdueDispute}
                  onExtendDeadline={extendDeadline}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
