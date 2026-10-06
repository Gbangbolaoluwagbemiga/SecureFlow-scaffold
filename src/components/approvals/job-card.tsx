import type { Escrow } from "@/lib/web3/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { Clock, MessageSquare } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ApplicationCard } from "./application-card";

interface Application {
  freelancerAddress: string;
  coverLetter: string;
  proposedTimeline: number;
  appliedAt: number;
  status: "pending" | "accepted" | "rejected";
}

interface JobWithApplications {
  id: string;
  payer: string;
  beneficiary: string;
  token: string;
  totalAmount: string;
  releasedAmount: string;
  status: Escrow["status"];
  createdAt: number;
  duration: number;
  milestones: any[];
  projectDescription?: string;
  isOpenJob?: boolean;
  applications: Application[];
  applicationCount: number;
}

interface JobCardProps {
  job: JobWithApplications;
  index: number;
  dialogOpen: boolean;
  selectedJob: JobWithApplications | null;
  approving: boolean;
  onJobSelect: (job: JobWithApplications) => void;
  onDialogChange: (open: boolean) => void;
  onApprove: (freelancer: string) => void;
}

export function JobCard({
  job,
  index,
  dialogOpen,
  selectedJob,
  approving,
  onJobSelect,
  onDialogChange,
  onApprove,
}: JobCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.1 }}
    >
      <Card className="glass border-primary/20 p-4 md:p-6 hover:border-primary/40 transition-colors">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-xl font-bold">
                {job.projectDescription || `Job #${job.id}`}
              </h3>
              <Badge variant="secondary" className="gap-1">
                <Clock className="h-3 w-3" />
                {job.duration.toFixed(1)} days
              </Badge>
              <Badge variant="outline" className="gap-1">
                <MessageSquare className="h-3 w-3" />
                {job.applicationCount} applications
              </Badge>
            </div>

            <p className="text-muted-foreground mb-4 break-words overflow-hidden">
              {job.projectDescription}
            </p>

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>Posted {new Date(job.createdAt).toLocaleDateString()}</span>
              <span>•</span>
              <span>
                Budget: {(Number.parseFloat(job.totalAmount) / 1e7).toFixed(2)}{" "}
                tokens
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-4 w-full lg:w-auto">
            <div className="text-right w-full lg:w-auto">
              <p className="text-sm text-muted-foreground mb-1">Total Budget</p>
              <p className="text-2xl md:text-3xl font-bold text-primary break-all">
                {(Number.parseFloat(job.totalAmount) / 1e7).toFixed(2)}
              </p>
            </div>

            <Dialog
              open={dialogOpen && selectedJob?.id === job.id}
              onOpenChange={onDialogChange}
            >
              <DialogTrigger asChild>
                <Button
                  onClick={() => {
                    onJobSelect(job);
                    onDialogChange(true);
                  }}
                  className="w-full lg:w-auto min-w-[140px]"
                  disabled={job.applicationCount === 0}
                >
                  {job.applicationCount === 0
                    ? "No Applications"
                    : "Review Applications"}
                </Button>
              </DialogTrigger>
              <DialogContent className="glass max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Job #{job.id} Applications</DialogTitle>
                  <DialogDescription>
                    Review and approve freelancer applications for this job.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  {job.applications.length === 0 ? (
                    <div className="text-center py-8">
                      <MessageSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                      <p className="text-muted-foreground">
                        No applications yet
                      </p>
                    </div>
                  ) : (
                    job.applications.map((application, idx) => (
                      <ApplicationCard
                        key={idx}
                        application={application}
                        index={idx}
                        onApprove={onApprove}
                        approving={approving}
                      />
                    ))
                  )}
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      onDialogChange(false);
                    }}
                  >
                    Close
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
