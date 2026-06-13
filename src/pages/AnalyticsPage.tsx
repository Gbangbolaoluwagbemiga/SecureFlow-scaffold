import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { useWeb3 } from "@/contexts/web3-context";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  TrendingUp,
  DollarSign,
  Users,
  Activity,
  Award,
  Briefcase,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { contractService } from "@/lib/web3/contract-service";

interface PlatformAnalytics {
  totalEscrows: number;
  activeEscrows: number;
  completedEscrows: number;
  disputedEscrows: number;
  totalVolumeFormatted: string;
  totalFeesFormatted: string;
  completionRate: string;
  disputeRate: string;
}

interface UserAnalytics {
  address: string;
  completedEscrows: number;
  reputation: number;
  averageRating: number;
  ratingCount: number;
  projectsAsClient: number;
  projectsAsFreelancer: number;
  totalEarned: string;
  totalSpent: string;
  activeProjects: number;
}

interface TrendsData {
  totalEscrows: number;
  statusDistribution: {
    pending: number;
    inProgress: number;
    released: number;
    disputed: number;
  };
}

const COLORS: Record<string, string> = {
  pending: "#8b5cf6",
  inprogress: "#06b6d4",
  released: "#10b981",
  disputed: "#ef4444",
};

// Normalize raw milestone status tag/string/number → number
// 0=NotStarted, 1=Submitted, 2=Approved, 3=Disputed, 4=Resolved, 5=Rejected
const normalizeMilestoneStatus = (rawStatus: any): number => {
  if (typeof rawStatus === "string") {
    switch (rawStatus.toLowerCase()) {
      case "notstarted":
      case "pending":
        return 0;
      case "submitted":
        return 1;
      case "approved":
        return 2;
      case "disputed":
        return 3;
      case "resolved":
        return 4;
      case "rejected":
        return 5;
    }
  }
  if (Array.isArray(rawStatus) && rawStatus.length > 0) {
    return normalizeMilestoneStatus(rawStatus[0]);
  }
  if (rawStatus && typeof rawStatus === "object" && "tag" in rawStatus) {
    return normalizeMilestoneStatus(rawStatus.tag);
  }
  if (typeof rawStatus === "number") return rawStatus;
  return 0;
};

const formatTokens = (raw: bigint): string => (Number(raw) / 1e7).toFixed(2);

export default function AnalyticsPage() {
  const { wallet } = useWeb3();
  const { toast } = useToast();
  const [platformData, setPlatformData] = useState<PlatformAnalytics | null>(null);
  const [userData, setUserData] = useState<UserAnalytics | null>(null);
  const [trendsData, setTrendsData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address]);

  const fetchAnalytics = async () => {
    setRefreshing(true);
    try {
      const [totalEscrows, platformFeeBP] = await Promise.all([
        contractService.getTotalEscrows(),
        contractService.getPlatformFeeBP(),
      ]);

      let activeEscrows = 0;
      let completedEscrows = 0;
      let disputedEscrows = 0;
      let totalVolumeRaw = 0n;
      let totalFeesRaw = 0n;
      const statusDistribution: TrendsData["statusDistribution"] = {
        pending: 0,
        inProgress: 0,
        released: 0,
        disputed: 0,
      };

      for (let i = 1; i <= totalEscrows; i++) {
        try {
          const escrow = await contractService.getEscrow(i);
          if (!escrow) continue;

          const amount = BigInt(escrow.amount || "0");
          totalVolumeRaw += amount;
          if (platformFeeBP > 0) {
            totalFeesRaw += (amount * BigInt(platformFeeBP)) / 10000n;
          }

          // Check milestones for disputed (3) or resolved (4) status
          let hasDisputedMilestone = false;
          try {
            const milestones = await contractService.getMilestones(i);
            for (const m of milestones) {
              const msStatus = normalizeMilestoneStatus(m.status);
              if (msStatus === 3 || msStatus === 4) {
                hasDisputedMilestone = true;
                break;
              }
            }
          } catch {
            // ignore milestone fetch errors
          }

          if (hasDisputedMilestone) {
            disputedEscrows++;
            statusDistribution.disputed++;
          } else {
            // Stellar service status: 0=Pending, 1=InProgress, 2=Released, 3=Disputed
            switch (escrow.status) {
              case 0:
                statusDistribution.pending++;
                break;
              case 1:
                activeEscrows++;
                statusDistribution.inProgress++;
                break;
              case 2:
                completedEscrows++;
                statusDistribution.released++;
                break;
              case 3:
                disputedEscrows++;
                statusDistribution.disputed++;
                break;
              default:
                statusDistribution.pending++;
            }
          }
        } catch {
          continue;
        }
      }

      const completionRate =
        totalEscrows > 0
          ? ((completedEscrows / totalEscrows) * 100).toFixed(2)
          : "0.00";
      const disputeRate =
        totalEscrows > 0
          ? ((disputedEscrows / totalEscrows) * 100).toFixed(2)
          : "0.00";

      setPlatformData({
        totalEscrows,
        activeEscrows,
        completedEscrows,
        disputedEscrows,
        totalVolumeFormatted: formatTokens(totalVolumeRaw),
        totalFeesFormatted: formatTokens(totalFeesRaw),
        completionRate,
        disputeRate,
      });

      setTrendsData({ totalEscrows, statusDistribution });

      // User-specific analytics (only when wallet is connected)
      if (wallet.address) {
        try {
          const userEscrowIds = await contractService.getUserEscrows(wallet.address);
          let userCompleted = 0;
          let userActive = 0;
          let userAsClient = 0;
          let userAsFreelancer = 0;
          let userEarned = 0n;
          let userSpent = 0n;

          for (const escrowId of userEscrowIds) {
            try {
              const escrow = await contractService.getEscrow(escrowId);
              if (!escrow) continue;

              const isClient =
                escrow.creator?.toLowerCase() === wallet.address!.toLowerCase();
              const isFreelancer =
                escrow.freelancer?.toLowerCase() === wallet.address!.toLowerCase();

              if (isClient) {
                userAsClient++;
                userSpent += BigInt(escrow.amount || "0");
              }
              if (isFreelancer) {
                userAsFreelancer++;
                userEarned += BigInt(escrow.paid_amount || "0");
              }

              if (escrow.status === 1) userActive++;
              else if (escrow.status === 2) userCompleted++;
            } catch {
              continue;
            }
          }

          const [ratingData, reputation] = await Promise.all([
            contractService.getAverageRating(wallet.address),
            contractService.getReputation(wallet.address),
          ]);

          setUserData({
            address: wallet.address,
            completedEscrows: userCompleted,
            reputation,
            averageRating: ratingData.average,
            ratingCount: ratingData.count,
            projectsAsClient: userAsClient,
            projectsAsFreelancer: userAsFreelancer,
            totalEarned: formatTokens(userEarned),
            totalSpent: formatTokens(userSpent),
            activeProjects: userActive,
          });
        } catch (err) {
          console.error("Failed to fetch user analytics:", err);
        }
      }
    } catch (error: any) {
      toast({
        title: "Failed to load analytics",
        description: error.message || "Could not fetch analytics data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen py-12 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading analytics...</p>
        </div>
      </div>
    );
  }

  const statusChartData = trendsData
    ? Object.entries(trendsData.statusDistribution)
        .filter(([, value]) => value > 0)
        .map(([name, value]) => ({
          name:
            name === "inProgress"
              ? "In Progress"
              : name.charAt(0).toUpperCase() + name.slice(1),
          value,
          key: name === "inProgress" ? "inprogress" : name.toLowerCase(),
        }))
    : [];

  return (
    <div className="min-h-screen py-12">
      <div className="container mx-auto px-4">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold mb-2">
              Analytics Dashboard
            </h1>
            <p className="text-xl text-muted-foreground">
              Platform metrics and user statistics
            </p>
          </div>
          <Button
            variant="outline"
            onClick={fetchAnalytics}
            disabled={refreshing}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <Tabs defaultValue="platform" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
            <TabsTrigger value="platform">Platform</TabsTrigger>
            <TabsTrigger value="user" disabled={!wallet.isConnected}>
              My Stats
            </TabsTrigger>
          </TabsList>

          {/* ── Platform Tab ─────────────────────────────────── */}
          <TabsContent value="platform" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card className="glass border-primary/20 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Total Escrows
                    </p>
                    <h3 className="text-3xl font-bold mt-2">
                      {platformData?.totalEscrows || 0}
                    </h3>
                  </div>
                  <Briefcase className="h-8 w-8 text-primary" />
                </div>
              </Card>

              <Card className="glass border-primary/20 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Active Projects
                    </p>
                    <h3 className="text-3xl font-bold mt-2">
                      {platformData?.activeEscrows || 0}
                    </h3>
                  </div>
                  <Activity className="h-8 w-8 text-cyan-500" />
                </div>
              </Card>

              <Card className="glass border-primary/20 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Total Volume
                    </p>
                    <h3 className="text-3xl font-bold mt-2">
                      {platformData?.totalVolumeFormatted ?? "0.00"} XLM
                    </h3>
                  </div>
                  <DollarSign className="h-8 w-8 text-green-500" />
                </div>
              </Card>

              <Card className="glass border-primary/20 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Completion Rate
                    </p>
                    <h3 className="text-3xl font-bold mt-2">
                      {platformData?.completionRate || "0.00"}%
                    </h3>
                  </div>
                  <TrendingUp className="h-8 w-8 text-purple-500" />
                </div>
              </Card>
            </div>

            {/* Charts */}
            <div className="grid gap-6 md:grid-cols-2">
              <Card className="glass border-primary/20 p-6">
                <h3 className="text-xl font-bold mb-4">
                  Escrow Status Distribution
                </h3>
                {statusChartData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={statusChartData}
                          cx="50%"
                          cy="50%"
                          labelLine={true}
                          label={({ name, value, percent }: any) =>
                            value > 0
                              ? `${name}: ${value} (${(
                                  (percent as number) * 100
                                ).toFixed(0)}%)`
                              : ""
                          }
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {statusChartData.map((entry) => (
                            <Cell
                              key={`cell-${entry.key}`}
                              fill={COLORS[entry.key] || "#8b5cf6"}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number) => [
                            `${value} escrows`,
                            "Count",
                          ]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                      {statusChartData.map((entry) => (
                        <div
                          key={entry.key}
                          className="flex items-center gap-2"
                        >
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{
                              backgroundColor: COLORS[entry.key] || "#8b5cf6",
                            }}
                          />
                          <span className="text-muted-foreground">
                            {entry.name}:{" "}
                            <span className="font-semibold text-foreground">
                              {entry.value}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    No escrow data available
                  </div>
                )}
              </Card>

              <Card className="glass border-primary/20 p-6">
                <h3 className="text-xl font-bold mb-4">Platform Metrics</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={[
                      {
                        name: "Metrics",
                        Active: platformData?.activeEscrows || 0,
                        Completed: platformData?.completedEscrows || 0,
                        Disputed: platformData?.disputedEscrows || 0,
                      },
                    ]}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="Active" fill="#06b6d4" />
                    <Bar dataKey="Completed" fill="#10b981" />
                    <Bar dataKey="Disputed" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>

            {/* Additional stats row */}
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="glass border-primary/20 p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-full bg-green-500/10">
                    <TrendingUp className="h-6 w-6 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Completed</p>
                    <p className="text-2xl font-bold">
                      {platformData?.completedEscrows || 0}
                    </p>
                  </div>
                </div>
              </Card>

              <Card className="glass border-primary/20 p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-full bg-red-500/10">
                    <Activity className="h-6 w-6 text-red-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Dispute Rate
                    </p>
                    <p className="text-2xl font-bold">
                      {platformData?.disputeRate || "0.00"}%
                    </p>
                  </div>
                </div>
              </Card>

              <Card className="glass border-primary/20 p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-full bg-purple-500/10">
                    <DollarSign className="h-6 w-6 text-purple-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Est. Platform Fees
                    </p>
                    <p className="text-2xl font-bold">
                      {platformData?.totalFeesFormatted ?? "0.00"} XLM
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* ── My Stats Tab ──────────────────────────────────── */}
          <TabsContent value="user" className="space-y-6">
            {userData ? (
              <>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <Card className="glass border-primary/20 p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">
                          Reputation
                        </p>
                        <h3 className="text-3xl font-bold mt-2">
                          {userData.reputation}
                        </h3>
                      </div>
                      <Award className="h-8 w-8 text-yellow-500" />
                    </div>
                  </Card>

                  <Card className="glass border-primary/20 p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">
                          Average Rating
                        </p>
                        <h3 className="text-3xl font-bold mt-2">
                          {userData.averageRating.toFixed(1)} ⭐
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          {userData.ratingCount} ratings
                        </p>
                      </div>
                      <Users className="h-8 w-8 text-purple-500" />
                    </div>
                  </Card>

                  <Card className="glass border-primary/20 p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">
                          Total Earned
                        </p>
                        <h3 className="text-3xl font-bold mt-2">
                          {userData.totalEarned} XLM
                        </h3>
                      </div>
                      <DollarSign className="h-8 w-8 text-green-500" />
                    </div>
                  </Card>

                  <Card className="glass border-primary/20 p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">
                          Active Projects
                        </p>
                        <h3 className="text-3xl font-bold mt-2">
                          {userData.activeProjects}
                        </h3>
                      </div>
                      <Activity className="h-8 w-8 text-cyan-500" />
                    </div>
                  </Card>
                </div>

                <Card className="glass border-primary/20 p-6">
                  <h3 className="text-xl font-bold mb-4">Your Activity</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={[
                        {
                          name: "Projects",
                          "As Client": userData.projectsAsClient,
                          "As Freelancer": userData.projectsAsFreelancer,
                          Completed: userData.completedEscrows,
                        },
                      ]}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="As Client" fill="#8b5cf6" />
                      <Bar dataKey="As Freelancer" fill="#06b6d4" />
                      <Bar dataKey="Completed" fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>

                <div className="grid gap-4 md:grid-cols-2">
                  <Card className="glass border-primary/20 p-6">
                    <h3 className="text-lg font-bold mb-4">
                      Earnings Overview
                    </h3>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                          Total Earned
                        </span>
                        <span className="font-bold">
                          {userData.totalEarned} XLM
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                          Projects as Freelancer
                        </span>
                        <span className="font-bold">
                          {userData.projectsAsFreelancer}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                          Completed Projects
                        </span>
                        <span className="font-bold">
                          {userData.completedEscrows}
                        </span>
                      </div>
                    </div>
                  </Card>

                  <Card className="glass border-primary/20 p-6">
                    <h3 className="text-lg font-bold mb-4">
                      Spending Overview
                    </h3>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                          Total Spent
                        </span>
                        <span className="font-bold">
                          {userData.totalSpent} XLM
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                          Projects as Client
                        </span>
                        <span className="font-bold">
                          {userData.projectsAsClient}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                          Active Projects
                        </span>
                        <span className="font-bold">
                          {userData.activeProjects}
                        </span>
                      </div>
                    </div>
                  </Card>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <AlertCircle className="h-5 w-5 mr-2" />
                No activity found for your wallet.
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
