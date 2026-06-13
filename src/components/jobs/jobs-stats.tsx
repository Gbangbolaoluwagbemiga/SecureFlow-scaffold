import { Card } from "@/components/ui/card";
import { Briefcase, DollarSign, Clock, User } from "lucide-react";

interface JobsStatsProps {
  jobs: Array<{
    totalAmount: string;
    /**
     * Duration in **days** (already converted from ledgers/timestamps upstream).
     */
    duration: number;
  }>;
  openJobsCount?: number; // Total escrows from blockchain
  ongoingProjectsCount?: number;
  isClientUser?: boolean; // Only show "Your Projects" card for users who have client escrows
}

export function JobsStats({
  jobs,
  openJobsCount,
  ongoingProjectsCount = 0,
  isClientUser = false,
}: JobsStatsProps) {
  const totalValue = jobs.reduce(
    (sum, job) => sum + Number.parseFloat(job.totalAmount),
    0,
  );

  // `duration` is not consistently defined across pages (some pass seconds, some pass days).
  // Normalize here so the UI stays correct.
  const durationDays = jobs.map((job) => {
    const d = Number(job.duration) || 0;
    // If it's large, it's almost certainly seconds.
    if (d > 3650) return d / (24 * 60 * 60);
    return d;
  });

  const avgDuration =
    durationDays.length > 0
      ? durationDays.reduce((sum, d) => sum + d, 0) / durationDays.length
      : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-8">
      <Card className="glass border-primary/20 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground mb-1">Total Escrows</p>
            <p className="text-2xl md:text-3xl font-bold break-all">
              {openJobsCount !== undefined ? openJobsCount : jobs.length}
            </p>
          </div>
          <Briefcase className="h-8 w-8 md:h-10 md:w-10 text-primary opacity-50 shrink-0" />
        </div>
      </Card>

      <Card className="glass border-accent/20 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground mb-1">Total Value</p>
            <p className="text-2xl md:text-3xl font-bold break-all">
              {(totalValue / 1e7).toFixed(2)} XLM
            </p>
          </div>
          <DollarSign className="h-8 w-8 md:h-10 md:w-10 text-accent opacity-50 shrink-0" />
        </div>
      </Card>

      <Card className="glass border-primary/20 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground mb-1">Avg. Duration</p>
            <p className="text-2xl md:text-3xl font-bold break-all">
              {Math.round(avgDuration)} days
            </p>
          </div>
          <Clock className="h-8 w-8 md:h-10 md:w-10 text-primary opacity-50 shrink-0" />
        </div>
      </Card>

      {isClientUser && (
        <Card
          className={`glass p-4 md:p-6 ${ongoingProjectsCount >= 3 ? "border-red-200 dark:border-red-800" : "border-accent/20"}`}
        >
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted-foreground mb-1">Your Projects</p>
              <p
                className={`text-2xl md:text-3xl font-bold break-all ${ongoingProjectsCount >= 3 ? "text-red-600 dark:text-red-400" : "text-accent"}`}
              >
                {ongoingProjectsCount}/3
              </p>
              {ongoingProjectsCount >= 3 && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  Limit reached
                </p>
              )}
            </div>
            <User
              className={`h-8 w-8 md:h-10 md:w-10 opacity-50 shrink-0 ${ongoingProjectsCount >= 3 ? "text-red-600 dark:text-red-400" : "text-accent"}`}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
