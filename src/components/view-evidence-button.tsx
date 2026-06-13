import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DisputeEvidence } from "@/components/admin/dispute-evidence";
import { Eye } from "lucide-react";

interface ViewEvidenceButtonProps {
  escrowId: string;
  milestoneIndex: number;
  clientAddress: string;
  freelancerAddress: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
  className?: string;
}

export function ViewEvidenceButton({
  escrowId,
  milestoneIndex,
  clientAddress,
  freelancerAddress,
  variant = "outline",
  size = "sm",
  className = "",
}: ViewEvidenceButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <Eye className="mr-2 h-4 w-4" />
          View Evidence
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Dispute Evidence</DialogTitle>
          <DialogDescription>
            Evidence and communication for Escrow #{escrowId}, Milestone {milestoneIndex}
          </DialogDescription>
        </DialogHeader>

        <DisputeEvidence
          escrowId={escrowId}
          milestoneIndex={milestoneIndex}
          clientAddress={clientAddress}
          freelancerAddress={freelancerAddress}
        />
      </DialogContent>
    </Dialog>
  );
}
