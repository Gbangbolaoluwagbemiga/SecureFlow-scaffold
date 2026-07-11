import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import {
  Clock,
  DollarSign,
  Calendar,
  Play,
  Send,
  Star,
  Loader2,
} from "lucide-react";
import { ClientRatingDialog } from "@/components/rating/client-rating-dialog";
import { ContractService } from "@/lib/web3/contract-service";
import { CONTRACTS } from "@/lib/web3/config";

interface Milestone {
  description: string;
  amount: string;
  status: string;
  submittedAt?: number;
  approvedAt?: number;
}

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
  milestones: Milestone[];
  projectDescription: string;
  isOpenJob: boolean;
}

interface EscrowCardProps {
  escrow: Escrow;
  index: number;
  onStartWork: (escrowId: string) => void | Promise<void>;
  onSubmitMilestone: (escrowId: string, milestoneIndex: number) => void;
  onDispute: (escrowId: string) => void;
}

export function EscrowCard({
  escrow,
  index,
  onStartWork,
  onSubmitMilestone,
  onDispute,
}: EscrowCardProps) {
  const [ratingDialogOpen, setRatingDialogOpen] = useState(false);
  const [hasClientRating, setHasClientRating] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const isCompleted =
    escrow.status === "completed" ||
    escrow.status === "released" ||
    escrow.status === "Released";

  useEffect(() => {
    if (!isCompleted || !escrow.payer) return;
    const svc = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);
    svc
      .getClientRating(Number(escrow.id))
      .then((r) => setHasClientRating(!!r))
      .catch(() => {});
  }, [escrow.id, isCompleted, escrow.payer]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "active":
        return "bg-blue-100 text-blue-800";
      case "completed":
        return "bg-green-100 text-green-800";
      case "disputed":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getMilestoneStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-gray-100 text-gray-800";
      case "submitted":
        return "bg-yellow-100 text-yellow-800";
      case "approved":
        return "bg-green-100 text-green-800";
      case "disputed":
        return "bg-red-100 text-red-800";
      case "resolved":
        return "bg-blue-100 text-blue-800";
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
              <CardTitle className="text-lg mb-2">
                {escrow.projectDescription}
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  <span>
                    {Math.round(escrow.duration / (24 * 60 * 60))} days
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <DollarSign className="h-4 w-4" />
                  <span>
                    {(Number.parseFloat(escrow.totalAmount) / 1e7).toFixed(2)}{" "}
                    tokens
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  <span>
                    Created {new Date(escrow.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
            <Badge className={getStatusColor(escrow.status)}>
              {escrow.status}
            </Badge>
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

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600">Total Amount:</span>
                <div className="font-semibold">
                  {(Number.parseFloat(escrow.totalAmount) / 1e7).toFixed(2)}{" "}
                  tokens
                </div>
              </div>
              <div>
                <span className="text-gray-600">Released:</span>
                <div className="font-semibold">
                  {(Number.parseFloat(escrow.releasedAmount) / 1e7).toFixed(2)}{" "}
                  tokens
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium">Milestones:</h4>
              {escrow.milestones.map((milestone, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 bg-muted/20 rounded"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {milestone.description}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(Number.parseFloat(milestone.amount) / 1e7).toFixed(2)}{" "}
                      tokens
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      className={getMilestoneStatusColor(milestone.status)}
                    >
                      {milestone.status}
                    </Badge>
                    {milestone.status === "pending" && (
                      <Button
                        size="sm"
                        onClick={() => onSubmitMilestone(escrow.id, idx)}
                        className="cursor-pointer"
                      >
                        <Send className="h-3 w-3 mr-1" />
                        Submit
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              {escrow.status === "pending" && (
                <Button
                  onClick={async () => {
                    setIsStarting(true);
                    try {
                      await onStartWork(escrow.id);
                    } finally {
                      setIsStarting(false);
                    }
                  }}
                  disabled={isStarting}
                  className="flex-1 cursor-pointer"
                >
                  {isStarting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Starting…
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-1" />
                      Start Work
                    </>
                  )}
                </Button>
              )}
              {escrow.status === "active" && (
                <Button
                  onClick={() => onDispute(escrow.id)}
                  variant="destructive"
                  className="flex-1 cursor-pointer"
                >
                  Open Dispute
                </Button>
              )}
              {isCompleted && !hasClientRating && escrow.payer && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setRatingDialogOpen(true)}
                >
                  <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                  Rate Client
                </Button>
              )}
              {isCompleted && hasClientRating && (
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                  Client rated
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {ratingDialogOpen && escrow.payer && escrow.beneficiary && (
        <ClientRatingDialog
          open={ratingDialogOpen}
          onOpenChange={setRatingDialogOpen}
          escrowId={Number(escrow.id)}
          clientAddress={escrow.payer}
          freelancerAddress={escrow.beneficiary}
          onSuccess={() => setHasClientRating(true)}
        />
      )}
    </motion.div>
  );
}
