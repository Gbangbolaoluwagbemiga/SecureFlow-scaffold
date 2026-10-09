import { VerifiedBadge } from "@/components/verification/verified-badge";
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { useWeb3 } from "@/contexts/web3-context";
import { useToast } from "@/hooks/use-toast";
import { useJobCreatorStatus } from "@/hooks/use-job-creator-status";
import { usePendingApprovals } from "@/hooks/use-pending-approvals";
import { CONTRACTS } from "@/lib/web3/config";

import {
  useNotifications,
  createApplicationNotification,
} from "@/contexts/notification-context";
import type { Escrow, Application } from "@/lib/web3/types";

/** Pull the [Portfolio/Attachment: name](url) block out of a cover letter. */
function parseCoverLetter(text: string): {
  body: string;
  attachment?: { name: string; url: string };
} {
  const re = /\[Portfolio\/Attachment:\s*([^\]]+)\]\((https?:\/\/[^)]+)\)/i;
  const match = re.exec(text);
  if (!match) return { body: text };
  return {
    body: text
      .replace(match[0], "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    attachment: { name: match[1].trim(), url: match[2].trim() },
  };
}

import { Briefcase, MessageSquare, Paperclip } from "lucide-react";
import { ApprovalsHeader } from "@/components/approvals/approvals-header";
import { ApprovalsStats } from "@/components/approvals/approvals-stats";
import { JobCard } from "@/components/approvals/job-card";
import { ApprovalsLoading } from "@/components/approvals/approvals-loading";
import { BadgeDisplay, RatingDisplay } from "@/components/rating/badge-display";

interface JobWithApplications extends Escrow {
  applications: Application[];
  applicationCount: number;
  projectDescription?: string;
  isOpenJob?: boolean;
}

export default function ApprovalsPage() {
  const { wallet } = useWeb3();
  const { toast } = useToast();
  const { isJobCreator, loading: isJobCreatorLoading } = useJobCreatorStatus();
  const { refreshApprovals } = usePendingApprovals();
  const { addNotification } = useNotifications();
  const [jobs, setJobs] = useState<JobWithApplications[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<JobWithApplications | null>(
    null,
  );
  const [selectedFreelancer, setSelectedFreelancer] =
    useState<Application | null>(null);
  const [selectedJobForApproval, setSelectedJobForApproval] =
    useState<JobWithApplications | null>(null);

  // Debug selectedFreelancer changes
  useEffect(() => {
    if (selectedFreelancer === null) {
    }
  }, [selectedFreelancer]);
  const [approving, setApproving] = useState(false);
  const [, setIsApproving] = useState(false); // Used in handlers

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
        return "pending"; // Map cancelled to pending
      default:
        return "pending";
    }
  };

  const fetchMyJobs = async () => {
    if (!wallet.isConnected || !isJobCreator) return;

    setLoading(true);
    try {
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

      // Use ContractService instead of contract.call - it reads from blockchain
      const { ContractService } = await import("@/lib/web3/contract-service");
      const contractService = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);

      // My escrows in one batch read (the old loop probed ids 1..20 one call
      // at a time and never saw jobs past #20), then every open job's
      // applications in parallel.
      const me = (wallet.address ?? "").toLowerCase().trim();
      const myIds = wallet.address
        ? await contractService.getUserEscrows(wallet.address)
        : [];
      const escrows = await contractService.getEscrowsBatch(myIds.map(Number));
      const myOpenJobs = escrows.filter(
        (e) =>
          e.creator.toLowerCase().trim() === me &&
          !e.freelancer &&
          e.status === 0,
      );
      const appsPerJob = await Promise.all(
        myOpenJobs.map((e) =>
          contractService.getApplications(e.escrow_id).catch(() => []),
        ),
      );

      const SECONDS_PER_LEDGER = 5;
      const toTimestamp = (ledger: number) =>
        Date.now() - (currentLedger - ledger) * SECONDS_PER_LEDGER * 1000;

      const myJobs: JobWithApplications[] = myOpenJobs.map((escrow, idx) => {
        const applications: Application[] = appsPerJob[idx].map((app) => ({
          freelancerAddress: app.freelancer,
          coverLetter: app.cover_letter,
          proposedTimeline: app.proposed_timeline,
          appliedAt: toTimestamp(app.applied_at || 0),
          status: "pending" as const,
          badge: app.badge,
          averageRating: app.averageRating,
          ratingCount: app.ratingCount,
        }));
        const durationInDays = Math.max(
          0,
          ((escrow.deadline - escrow.created_at) * SECONDS_PER_LEDGER) /
            (24 * 60 * 60),
        );
        return {
          id: escrow.escrow_id.toString(),
          payer: escrow.creator,
          beneficiary:
            "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          token: escrow.token || "native",
          totalAmount: escrow.amount || "0",
          releasedAmount: "0",
          status: getStatusFromNumber(escrow.status || 0),
          createdAt: toTimestamp(escrow.created_at),
          duration: durationInDays,
          milestones: [],
          projectDescription:
            escrow.project_title ||
            escrow.project_description ||
            "No description",
          isOpenJob: true,
          applications,
          applicationCount: applications.length,
        };
      });

      setJobs(myJobs);
    } catch (error) {
      toast({
        title: "Failed to load jobs",
        description: "Could not fetch your job postings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApproveFreelancer = async () => {
    if (!selectedJobForApproval || !selectedFreelancer || !wallet.isConnected) {
      toast({
        title: "Error",
        description: "Missing required information. Please try again.",
        variant: "destructive",
      });
      return;
    }

    if (!wallet.address) {
      toast({
        title: "Error",
        description: "Wallet address not found. Please reconnect your wallet.",
        variant: "destructive",
      });
      return;
    }

    setApproving(true);

    try {
      // Use ContractService instead of contract.send - it handles address conversion and auth properly
      const { ContractService } = await import("@/lib/web3/contract-service");
      const contractService = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);

      await contractService.acceptFreelancer({
        escrow_id: Number(selectedJobForApproval.id),
        freelancer: selectedFreelancer.freelancerAddress,
        depositor: wallet.address,
      });

      toast({
        title: "Freelancer Approved",
        description: "The freelancer has been approved for this job",
      });

      // Add notification for freelancer approval - notify the FREELANCER
      addNotification(
        createApplicationNotification(
          "approved",
          Number(selectedJobForApproval.id),
          selectedFreelancer.freelancerAddress,
          {
            jobTitle:
              selectedJobForApproval.projectDescription ||
              `Job #${selectedJobForApproval.id}`,
            freelancerName:
              selectedFreelancer.freelancerAddress.slice(0, 6) +
              "..." +
              selectedFreelancer.freelancerAddress.slice(-4),
          },
        ),
        [selectedFreelancer.freelancerAddress], // Notify the freelancer
      );

      // Close modals first
      setSelectedJob(null);
      setSelectedFreelancer(null);
      setSelectedJobForApproval(null);

      // Wait a moment for the transaction to be processed
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Refresh the jobs list
      await fetchMyJobs();

      // Refresh pending approvals status to update navigation
      await refreshApprovals();

      // Force a re-render by updating a dummy state
      setLoading(true);
      setTimeout(() => setLoading(false), 100);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      toast({
        title: "Approval Failed",
        description: `There was an error approving the freelancer: ${errorMessage}`,
        variant: "destructive",
      });
    } finally {
      setApproving(false);
    }
  };

  useEffect(() => {
    if (wallet.isConnected && isJobCreator) {
      fetchMyJobs();
    }
  }, [wallet.isConnected, isJobCreator]);

  // Don't redirect - let client see the page even if no approvals yet
  // They might want to see their jobs

  // Show loading while checking job creator status
  if (isJobCreatorLoading) {
    return <ApprovalsLoading isConnected={wallet.isConnected} />;
  }

  if (!wallet.isConnected) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <Briefcase className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-2xl font-bold mb-2">Connect Your Wallet</h2>
          <p className="text-muted-foreground">
            Please connect your wallet to view your job postings and manage
            applications.
          </p>
        </div>
      </div>
    );
  }

  if (!isJobCreator) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <Briefcase className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-2xl font-bold mb-2">
            Job Creator Access Required
          </h2>
          <p className="text-muted-foreground">
            You need to be a job creator to access this page.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return <ApprovalsLoading isConnected={wallet.isConnected} />;
  }

  // const totalJobs = jobs.length; // Unused
  // const totalApplications = jobs.reduce(
  //   (sum, job) => sum + job.applicationCount,
  //   0
  // ); // Unused
  // const totalValue = jobs.reduce(
  //   (sum, job) => sum + Number(job.totalAmount) / 1e7,
  //   0
  // ); // Unused

  return (
    <div className="container mx-auto px-4 py-8">
      <ApprovalsHeader />

      {/* Manual Refresh Button */}
      <div className="mb-6 flex justify-end">
        <button
          onClick={async () => {
            setLoading(true);
            await fetchMyJobs();
            setLoading(false);
          }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          🔄 Refresh Jobs
        </button>
      </div>

      <ApprovalsStats jobs={jobs} />

      {jobs.length === 0 ? (
        <Card className="p-8 text-center">
          <MessageSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-semibold mb-2">No Job Postings</h3>
          <p className="text-muted-foreground">
            You haven't created any job postings yet.
          </p>
        </Card>
      ) : (
        <div className="grid gap-6">
          {jobs.map((job, index) => (
            <JobCard
              key={job.id}
              job={job}
              index={index}
              dialogOpen={selectedJob?.id === job.id}
              selectedJob={selectedJob}
              approving={approving}
              onJobSelect={(job: JobWithApplications) => setSelectedJob(job)}
              onDialogChange={(open: boolean) => {
                if (!open) {
                  setSelectedJob(null);
                  setSelectedFreelancer(null);
                }
              }}
              onApprove={(freelancer: string) => {
                const application = job.applications.find(
                  (app) => app.freelancerAddress === freelancer,
                );
                if (application) {
                  setSelectedJobForApproval(job); // Store job data for approval
                  setSelectedJob(null); // Close the first modal
                  setSelectedFreelancer(application);
                  setIsApproving(true);
                } else {
                }
              }}
            />
          ))}
        </div>
      )}

      {/* Applications are reviewed in the job card's own dialog. A second,
          page-level modal used to open on top of it for the same click. */}

      {/* Approval/Rejection Confirmation Modal */}
      {(() => {
        return null;
      })()}
      {selectedFreelancer && (
        <div
          className="fixed inset-0 backdrop-blur-sm flex items-center justify-center p-4 z-[100]"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedFreelancer(null);
            }
          }}
        >
          {(() => {
            return null;
          })()}
          <div
            className="bg-background rounded-lg max-w-lg w-full border shadow-2xl"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">Approve Freelancer</h3>

              <div className="space-y-4">
                <div>
                  <p className="font-medium mb-2 flex items-center gap-2">
                    Freelancer Address:
                    <VerifiedBadge
                      address={selectedFreelancer.freelancerAddress}
                    />
                  </p>
                  <p className="text-sm text-muted-foreground font-mono break-all bg-muted/30 p-3 rounded-md">
                    {selectedFreelancer.freelancerAddress}
                  </p>
                </div>

                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setSelectedFreelancer(null)}
                    className="px-4 py-2 border rounded-md hover:bg-muted"
                    disabled={approving}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleApproveFreelancer();
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                    }}
                    onMouseUp={(e) => {
                      e.stopPropagation();
                    }}
                    className={`px-4 py-2 rounded-md text-white cursor-pointer bg-green-600 hover:bg-green-700 ${
                      approving ? "opacity-75" : ""
                    }`}
                    disabled={false}
                    style={{
                      pointerEvents: "auto",
                      zIndex: 1000,
                      position: "relative",
                    }}
                  >
                    Confirm Approval
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
