import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { useWeb3 } from "@/contexts/web3-context";
import { useToast } from "@/hooks/use-toast";
import { CONTRACTS } from "@/lib/web3/config";
import { contractService } from "@/lib/web3/contract-service";

import {
  useNotifications,
  createApplicationNotification,
} from "@/contexts/notification-context";
import type { Escrow } from "@/lib/web3/types";
import { Briefcase } from "lucide-react";
import { JobsHeader } from "@/components/jobs/jobs-header";
import { JobsStats } from "@/components/jobs/jobs-stats";
import { JobCard } from "@/components/jobs/job-card";
import { ApplicationDialog } from "@/components/jobs/application-dialog";
import { JobsLoading } from "@/components/jobs/jobs-loading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

export default function JobsPage() {
  const { wallet, getContract } = useWeb3();
  const { toast } = useToast();
  const { addNotification } = useNotifications();
  const [jobs, setJobs] = useState<Escrow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "active" | "completed" | "disputed"
  >("all");
  const [selectedJob, setSelectedJob] = useState<Escrow | null>(null);
  // const [coverLetter, setCoverLetter] = useState(""); // Unused - handled in dialog
  // const [proposedTimeline, setProposedTimeline] = useState(""); // Unused - handled in dialog
  const [applying, setApplying] = useState(false);
  const [hasApplied, setHasApplied] = useState<Record<string, boolean>>({});
  const [isContractPaused, setIsContractPaused] = useState(false);
  const [contractConfigError, setContractConfigError] = useState<string | null>(
    null,
  );
  const [ongoingProjectsCount, setOngoingProjectsCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [totalEscrowsCount, setTotalEscrowsCount] = useState(0); // Actual count from blockchain

  const getStatusFromNumber = (
    status: number,
  ): "pending" | "disputed" | "active" | "completed" => {
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
        return "pending"; // Map cancelled to pending
      default:
        return "pending";
    }
  };

  const normalizeJobStatus = (
    raw: unknown,
  ): "pending" | "active" | "completed" | "disputed" => {
    if (typeof raw === "string") {
      const s = raw.toLowerCase().trim();
      if (
        s === "pending" ||
        s === "active" ||
        s === "completed" ||
        s === "disputed"
      ) {
        return s;
      }
      if (s === "cancelled" || s === "canceled") return "pending";
      return "pending";
    }

    if (typeof raw === "number") {
      return getStatusFromNumber(raw);
    }

    if (typeof raw === "bigint") {
      return getStatusFromNumber(Number(raw));
    }

    return "pending";
  };

  useEffect(() => {
    if (wallet.address) {
      fetchOpenJobs();
      countOngoingProjects();
    } else {
    }
    checkContractPauseStatus();
  }, [wallet.address]);

  // Removed automatic refresh to prevent constant reloading

  // Check application status when jobs are loaded
  // Don't auto-check application status - fetchOpenJobs already does this
  // This useEffect was causing state to be reset to false
  // useEffect(() => {
  //   if (wallet.address && jobs.length > 0) {
  //     checkApplicationStatus();
  //   }
  // }, [wallet.address, jobs]);

  // Removed duplicate project count refresh

  const checkContractPauseStatus = async () => {
    try {
      const health = await contractService.probeEscrowContractHealth();
      if (!health.ok) {
        setContractConfigError(health.userMessage);
        setIsContractPaused(true);
        return;
      }
      setContractConfigError(null);
      setIsContractPaused(health.jobCreationPaused);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Contract check failed.";
      setContractConfigError(msg);
      setIsContractPaused(true);
    }
  };

  const countOngoingProjects = async () => {
    try {
      if (!wallet.address) {
        setOngoingProjectsCount(0);
        return;
      }

      // Use the contract's user->escrows index instead of relying on the legacy wrapper shape.
      const escrowIds = await contractService.getUserEscrows(wallet.address);

      let ongoingCount = 0;
      for (const id of escrowIds) {
        const escrow = await contractService.getEscrow(id);
        if (!escrow) continue;
        if (escrow.status === 0 || escrow.status === 1) ongoingCount++;
      }

      setOngoingProjectsCount(ongoingCount);
    } catch (error) {
      setOngoingProjectsCount(0);
    }
  };

  const checkApplicationStatus = async () => {
    try {
      // Check blockchain for application status for each job
      if (!wallet.address || jobs.length === 0) return;

      const applicationStatus: Record<string, boolean> = {};

      for (const job of jobs) {
        try {
          const hasAppliedResult = await contractService.hasUserApplied(
            Number.parseInt(job.id, 10),
            wallet.address,
          );
          applicationStatus[job.id] = hasAppliedResult;
        } catch (error) {
          // Preserve existing state if check fails
          applicationStatus[job.id] = hasApplied[job.id] || false;
        }
      }

      setHasApplied((prev) => ({
        ...prev,
        ...applicationStatus, // Merge with existing state instead of replacing
      }));
    } catch (error) {
      // Don't reset state on error
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchOpenJobs(), countOngoingProjects()]);
      // Check application status after refreshing jobs
      if (wallet.address && jobs.length > 0) {
        await checkApplicationStatus();
      }
    } finally {
      setRefreshing(false);
    }
  };

  // Clear application status cache when wallet changes
  useEffect(() => {
    setHasApplied({});
  }, [wallet.address]);

  const fetchOpenJobs = async () => {
    setLoading(true);
    try {
      // Fetch all data from blockchain via contractService.getEscrow()
      // This ensures all displayed data is from the blockchain, not mock data

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

      // Get total number of escrows using contract service
      // NO TIMEOUT - let it complete fully to get accurate count from blockchain
      const escrowCount = await contractService.getNextEscrowId();

      // Set the actual escrow count from blockchain
      // escrowCount is the next available ID, so actual count is escrowCount - 1
      const actualCount = Math.max(0, escrowCount - 1);
      setTotalEscrowsCount(actualCount);

      const openJobs: Escrow[] = [];

      // Fetch open jobs from the contract
      // escrowCount is the next available ID, so if it's 2, that means 1 escrow exists
      // But if it times out and returns 1, we should still check escrow 1 directly
      // Limit the number of escrows to fetch to prevent long loading times
      const maxEscrowsToFetch = 20; // Limit to 20 escrows max
      const escrowsToCheck = Math.min(
        Math.max(escrowCount - 1, 1),
        maxEscrowsToFetch,
      );

      // Always check at least escrow 1, even if escrowCount is 1 (might be timeout default)
      if (escrowsToCheck > 0) {
        for (let i = 1; i <= escrowsToCheck; i++) {
          try {
            const escrowData = await contractService.getEscrow(i);
            if (!escrowData) {
              continue;
            }

            // Check if this is an open job (beneficiary is null or zero address)
            // For Stellar, null beneficiary means it's an open job
            const zeroAddress =
              "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
            const isOpenJob =
              !escrowData.freelancer ||
              escrowData.freelancer === zeroAddress ||
              escrowData.freelancer === "";

            if (isOpenJob) {
              // Check if current user is the job creator (should not be able to apply to own job)
              const isJobCreator =
                wallet.address &&
                escrowData.creator &&
                escrowData.creator.toLowerCase().trim() ===
                  wallet.address.toLowerCase().trim();

              // Check if current user has already applied to this job
              // First check local state (preserves state after applying)
              let userHasApplied = hasApplied[i] || false;
              let applicationCount = 0;

              // Only check blockchain if not already in local state
              if (!userHasApplied && wallet.address) {
                try {
                  userHasApplied = await contractService.hasUserApplied(
                    i,
                    wallet.address,
                  );
                } catch (error) {
                  userHasApplied = false;
                }
              }

              // IMPORTANT: created_at and deadline are LEDGER SEQUENCE NUMBERS, not timestamps!
              // Stellar ledgers close approximately every 5 seconds
              // Duration = (deadline - created_at) * 5 seconds
              const SECONDS_PER_LEDGER = 5;
              const ledgerDiff = escrowData.deadline - escrowData.created_at;
              const durationInSeconds = ledgerDiff * SECONDS_PER_LEDGER;
              const durationInDays = Math.max(
                0,
                Math.round(durationInSeconds / (24 * 60 * 60)),
              );

              // Calculate approximate timestamp: current time - (current_ledger - created_at) * 5 seconds
              const ledgersAgo = currentLedger - escrowData.created_at;
              const secondsAgo = ledgersAgo * SECONDS_PER_LEDGER;
              const approxCreatedAt = Date.now() - secondsAgo * 1000;

              // Convert contract data to our Escrow type
              // All data is from blockchain - fetched via contractService.getEscrow()
              const job: Escrow = {
                id: i.toString(),
                payer: escrowData.creator, // depositor/creator (from blockchain)
                beneficiary: escrowData.freelancer || zeroAddress, // beneficiary/freelancer (from blockchain)
                token: escrowData.token || "", // token (from blockchain)
                totalAmount: escrowData.amount, // totalAmount (from blockchain)
                releasedAmount: "0", // paidAmount - would need to calculate from milestones
                status: getStatusFromNumber(escrowData.status), // status (from blockchain)
                createdAt: approxCreatedAt, // Approximate timestamp from ledger sequence
                duration: durationInDays, // Duration in days (calculated correctly from ledger sequence)
                milestones: [], // Would need to fetch milestones separately
                projectTitle: escrowData.project_title || "", // projectTitle (from blockchain)
                projectDescription: escrowData.project_description || "", // projectDescription (from blockchain)
                isOpenJob: true,
                applications: [], // Would need to fetch applications separately
                applicationCount: applicationCount, // Add real application count
                isJobCreator: !!isJobCreator, // Add flag to track if current user is the job creator (from blockchain)
              };

              // Log blockchain data for debugging

              openJobs.push(job);

              // Store application status from blockchain check
              setHasApplied((prev) => {
                const newState = {
                  ...prev,
                  [job.id]: userHasApplied, // Always use blockchain result
                };
                return newState;
              });
            }
          } catch (error) {
            // Skip escrows that don't exist or user doesn't have access to
            continue;
          }
        }
      }

      // Set the actual jobs from the blockchain contract
      // All data in openJobs is fetched directly from the blockchain
      setJobs(openJobs);
    } catch (error) {
      toast({
        title: "Failed to load jobs",
        description: "Could not fetch available jobs from the blockchain",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (
    job: Escrow,
    coverLetter: string,
    proposedTimeline: string,
  ) => {
    if (!job || !wallet.isConnected) return;

    // Check if user is the job creator (should not be able to apply to own job)
    if (
      job.isJobCreator ||
      job.payer?.toLowerCase() === wallet.address?.toLowerCase()
    ) {
      toast({
        title: "Cannot Apply",
        description: "You cannot apply to a job you created.",
        variant: "destructive",
      });
      return;
    }

    // Check if freelancer has reached the maximum number of ongoing projects (3)
    if (ongoingProjectsCount >= 3) {
      toast({
        title: "Project Limit Reached",
        description:
          "You can only have a maximum of 3 ongoing projects at a time. Please complete or cancel some projects before applying to new ones.",
        variant: "destructive",
      });
      return;
    }

    // Check if user has already applied to this job (local state)
    if (hasApplied[job.id]) {
      toast({
        title: "Already Applied",
        description: "You have already applied to this job.",
        variant: "destructive",
      });
      return;
    }

    setApplying(true);
    try {
      const contract = getContract(CONTRACTS.SECUREFLOW_ESCROW);
      if (!contract) return;

      // Check if user has already applied to this job using contractService
      // Always check blockchain to prevent double applications
      let userHasApplied = false;
      if (wallet.address) {
        try {
          const hasAppliedResult = await contractService.hasUserApplied(
            Number.parseInt(job.id, 10),
            wallet.address,
          );
          userHasApplied = hasAppliedResult;
        } catch (error) {
          // If check fails, use local state as fallback
          userHasApplied = hasApplied[job.id] || false;
        }
      }

      if (userHasApplied) {
        toast({
          title: "Already Applied",
          description: "You have already applied to this job.",
          variant: "destructive",
        });
        setApplying(false);
        return;
      } else {
      }

      // Apply to the job via the gasless path — admin wallet pays the fee,
      // so the applicant does not need XLM for gas.
      const { ContractService: GaslessCS } = await import(
        "@/lib/web3/contract-service"
      );
      const gaslessService = new GaslessCS(CONTRACTS.SECUREFLOW_ESCROW);
      await gaslessService.applyToJobGasless({
        escrow_id: Number.parseInt(job.id, 10),
        cover_letter: coverLetter,
        proposed_timeline: Number.parseInt(proposedTimeline, 10),
        freelancer: wallet.address || "",
      });

      // Update hasApplied state to prevent double application
      setHasApplied((prev) => ({
        ...prev,
        [job.id]: true,
      }));

      toast({
        title: "Application Submitted!",
        description:
          "The client will review your application and get back to you.",
      });

      // Add notification for job application submission - notify the CLIENT (job creator)
      addNotification(
        createApplicationNotification(
          "submitted",
          Number(job.id),
          wallet.address!,
          {
            jobTitle: job.projectDescription || `Job #${job.id}`,
            freelancerName:
              wallet.address!.slice(0, 6) + "..." + wallet.address!.slice(-4),
          },
        ),
        [job.payer], // Notify the client (job creator)
      );

      // coverLetter and proposedTimeline are handled in the dialog component
      setSelectedJob(null);

      // DON'T refresh jobs list immediately - it will reset hasApplied state
      // The application is already recorded on blockchain, just update local state
      // Only refresh if needed for other reasons

      // Refresh the ongoing projects count
      await countOngoingProjects();
    } catch (error: any) {
      const msg =
        error?.message ||
        "Could not submit your application. Please try again.";
      toast({
        title: "Application Failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setApplying(false);
    }
  };

  const filteredJobs = jobs.filter((job) => {
    // Search filter
    const matchesSearch =
      job.projectDescription
        ?.toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      job.milestones.some((m) =>
        m.description.toLowerCase().includes(searchQuery.toLowerCase()),
      );

    // Status filter
    const jobStatus = normalizeJobStatus(job.status);
    const matchesStatus = statusFilter === "all" || jobStatus === statusFilter;

    return matchesSearch && matchesStatus;
  });

  if (!wallet.isConnected || loading) {
    return <JobsLoading isConnected={wallet.isConnected} />;
  }

  return (
    <div className="min-h-screen py-12">
      <div className="container mx-auto px-4">
        <JobsHeader
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />
        {contractConfigError && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Escrow contract unavailable</AlertTitle>
            <AlertDescription>{contractConfigError}</AlertDescription>
          </Alert>
        )}
        <JobsStats
          jobs={jobs}
          openJobsCount={jobs.length}
          ongoingProjectsCount={ongoingProjectsCount}
          isClientUser={jobs.some(
            (j) => (j as any).payer?.toLowerCase() === wallet.address?.toLowerCase()
          )}
        />

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="flex-1">
            <Label htmlFor="status-filter" className="mb-2 block">
              Filter by Status
            </Label>
            <Select
              value={statusFilter}
              onValueChange={(value: any) => setStatusFilter(value)}
            >
              <SelectTrigger id="status-filter" className="w-full">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="disputed">Disputed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Jobs List */}
        <div className="space-y-6">
          {filteredJobs.length === 0 ? (
            <Card className="glass border-muted p-12 text-center">
              <Briefcase className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">
                No jobs found matching your search
              </p>
            </Card>
          ) : (
            filteredJobs.map((job, index) => {
              const jobHasApplied = hasApplied[job.id] || false;
              return (
                <JobCard
                  key={job.id}
                  job={job}
                  index={index}
                  hasApplied={jobHasApplied}
                  isContractPaused={isContractPaused}
                  ongoingProjectsCount={ongoingProjectsCount}
                  onApply={setSelectedJob}
                />
              );
            })
          )}
        </div>

        <ApplicationDialog
          job={selectedJob}
          open={!!selectedJob}
          onOpenChange={(open) => !open && setSelectedJob(null)}
          onApply={handleApply}
          applying={applying}
        />
      </div>
    </div>
  );
}
