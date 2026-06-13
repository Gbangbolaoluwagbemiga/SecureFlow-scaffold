import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, FileText, CheckCircle2, AlertCircle } from "lucide-react";

interface DashboardStatsProps {
  escrows: Array<{
    totalAmount: string;
    releasedAmount: string;
    status: string;
    milestones: Array<{
      status: string;
    }>;
  }>;
}

export function DashboardStats({ escrows }: DashboardStatsProps) {
  const totalValue = escrows.reduce(
    (sum, escrow) => sum + Number.parseFloat(escrow.totalAmount) / 1e7,
    0,
  );

  const totalReleased = escrows.reduce(
    (sum, escrow) => sum + Number.parseFloat(escrow.releasedAmount) / 1e7,
    0,
  );

  // Helper function to check if an escrow is terminated (has disputed, rejected, or resolved milestones)
  const isEscrowTerminated = (escrow: any) => {
    return escrow.milestones.some(
      (milestone: any) =>
        milestone.status === "disputed" ||
        milestone.status === "rejected" ||
        milestone.status === "resolved",
    );
  };

  // Count active projects (excluding terminated ones)
  const activeProjects = escrows.filter(
    (escrow) => escrow.status === "active" && !isEscrowTerminated(escrow),
  ).length;

  // const completedProjects = escrows.filter(
  //   (escrow) => escrow.status === "completed"
  // ).length; // Unused

  // Count disputed projects (including terminated ones)
  const disputedProjects = escrows.filter(
    (escrow) => escrow.status === "disputed" || isEscrowTerminated(escrow),
  ).length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-8">
      <Card className="glass border-primary/20 p-4 md:p-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Value</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{totalValue.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">XLM in escrows</p>
        </CardContent>
      </Card>

      <Card className="glass border-accent/20 p-4 md:p-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Released</CardTitle>
          <FileText className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{totalReleased.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">XLM released</p>
        </CardContent>
      </Card>

      <Card className="glass border-primary/20 p-4 md:p-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Active</CardTitle>
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{activeProjects}</div>
          <p className="text-xs text-muted-foreground">projects</p>
        </CardContent>
      </Card>

      <Card className="glass border-primary/20 p-4 md:p-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Disputed</CardTitle>
          <AlertCircle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{disputedProjects}</div>
          <p className="text-xs text-muted-foreground">projects</p>
        </CardContent>
      </Card>
    </div>
  );
}
