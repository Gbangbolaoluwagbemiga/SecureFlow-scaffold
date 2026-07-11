import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DollarSign,
  FileText,
  CheckCircle,
  AlertTriangle,
  Star,
  Award,
} from "lucide-react";
import type { Badge as BadgeType } from "@/lib/web3/types";

interface FreelancerStatsProps {
  escrows: Array<{
    totalAmount: string;
    releasedAmount: string;
    status: string;
    milestones: Array<{
      status: string;
    }>;
  }>;
  averageRating?: number;
  ratingCount?: number;
  badge?: BadgeType;
}

export function FreelancerStats({
  escrows,
  averageRating = 0,
  ratingCount = 0,
  badge = "Beginner",
}: FreelancerStatsProps) {
  const totalEarnings = escrows.reduce(
    (sum, escrow) => sum + Number.parseFloat(escrow.releasedAmount),
    0,
  );

  const totalValue = escrows.reduce(
    (sum, escrow) => sum + Number.parseFloat(escrow.totalAmount),
    0,
  );

  // Escrow has/had issues: any disputed, rejected, or resolved-via-dispute milestone
  const isEscrowTerminated = (escrow: any) => {
    return escrow.milestones.some(
      (milestone: any) =>
        milestone.status === "disputed" ||
        milestone.status === "rejected" ||
        milestone.status === "resolved",
    );
  };

  // Completed = every milestone approved AND no disputes/rejections (mutually exclusive with Disputed)
  const completedProjects = escrows.filter((escrow) => {
    if (escrow.milestones.length === 0) return false;
    return (
      escrow.milestones.every(
        (milestone: any) => milestone.status === "approved",
      ) && !isEscrowTerminated(escrow)
    );
  }).length;

  // Disputed = any milestone was/is disputed, rejected, or resolved via dispute
  const terminatedProjects = escrows.filter((escrow) =>
    isEscrowTerminated(escrow),
  ).length;

  const badgeLabel = badge || "Beginner";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 md:gap-6 mb-8">
      <Card className="glass border-primary/20 p-4 md:p-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Earnings</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {(totalEarnings / 1e7).toFixed(2)}
          </div>
          <p className="text-xs text-muted-foreground">tokens earned</p>
        </CardContent>
      </Card>

      <Card className="glass border-accent/20 p-4 md:p-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Value</CardTitle>
          <FileText className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {(totalValue / 1e7).toFixed(2)}
          </div>
          <p className="text-xs text-muted-foreground">tokens in projects</p>
        </CardContent>
      </Card>

      <Card className="glass border-primary/20 p-4 md:p-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Completed</CardTitle>
          <CheckCircle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{completedProjects}</div>
          <p className="text-xs text-muted-foreground">projects</p>
        </CardContent>
      </Card>

      <Card className="glass border-destructive/20 p-4 md:p-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Disputed</CardTitle>
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{terminatedProjects}</div>
          <p className="text-xs text-muted-foreground">projects</p>
        </CardContent>
      </Card>

      <Card className="glass border-primary/20 p-4 md:p-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Rating</CardTitle>
          <Star className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {ratingCount > 0 ? averageRating.toFixed(1) : "0.0"}
          </div>
          <p className="text-xs text-muted-foreground">
            {ratingCount > 0 ? `(${ratingCount} ratings)` : "No ratings yet"}
          </p>
        </CardContent>
      </Card>

      <Card className="glass border-primary/20 p-4 md:p-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Badge Tier</CardTitle>
          <Award className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{badgeLabel}</div>
          <p className="text-xs text-muted-foreground">Freelancer level</p>
        </CardContent>
      </Card>
    </div>
  );
}
