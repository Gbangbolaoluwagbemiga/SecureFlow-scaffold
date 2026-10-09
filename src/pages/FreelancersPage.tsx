import { VerifiedBadge } from "@/components/verification/verified-badge";
import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWeb3 } from "@/contexts/web3-context";
import { ChatDialog } from "@/components/chat/chat-dialog";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CONTRACTS } from "@/lib/web3/config";
import {
  Star,
  Search,
  Briefcase,
  CheckCircle,
  Loader2,
  Users,
  ChevronRight,
  Award,
  MessageCircle,
} from "lucide-react";

interface FreelancerProfile {
  address: string;
  badge: string; // "Beginner" | "Intermediate" | "Advanced" | "Expert"
  avgRating: number; // 0-5
  ratingCount: number;
  completedProjects: number;
  reputation: number;
}

const BADGE_ORDER: Record<string, number> = {
  Expert: 4,
  Advanced: 3,
  Intermediate: 2,
  Beginner: 1,
};

const BADGE_STYLES: Record<string, string> = {
  Expert:
    "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700/40",
  Advanced:
    "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700/40",
  Intermediate:
    "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700/40",
  Beginner:
    "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800/50 dark:text-gray-300 dark:border-gray-600/40",
};

const BADGE_ICON_COLOR: Record<string, string> = {
  Expert: "text-yellow-500",
  Advanced: "text-purple-500",
  Intermediate: "text-blue-500",
  Beginner: "text-gray-400",
};

function avatarLetters(address: string): string {
  return address.slice(0, 2).toUpperCase();
}

function avatarColor(address: string): string {
  const colors = [
    "bg-blue-500",
    "bg-purple-500",
    "bg-green-500",
    "bg-orange-500",
    "bg-rose-500",
    "bg-teal-500",
    "bg-indigo-500",
    "bg-amber-500",
  ];
  const idx = address.charCodeAt(1) % colors.length;
  return colors[idx];
}

function StarRating({ value, count }: { value: number; count: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex">
        {[1, 2, 3, 4, 5].map((s) => (
          <Star
            key={s}
            className={`h-3.5 w-3.5 ${
              s <= Math.round(value)
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground/30"
            }`}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">
        {value > 0 ? `${value.toFixed(1)} (${count})` : "No reviews yet"}
      </span>
    </div>
  );
}

export default function FreelancersPage() {
  const navigate = useNavigate();
  const { wallet } = useWeb3();
  const myAddress = wallet.address ?? "";
  const [chatTarget, setChatTarget] = useState<string | null>(null);
  const [freelancers, setFreelancers] = useState<FreelancerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [badgeFilter, setBadgeFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"rating" | "projects" | "reputation">(
    "rating",
  );

  const fetchFreelancers = useCallback(async () => {
    setLoading(true);
    try {
      const { ContractService } = await import("@/lib/web3/contract-service");
      const svc = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);
      const nextId = await svc.getNextEscrowId();

      // Collect unique freelancer addresses + count their completed escrows
      const freelancerMap = new Map<string, number>(); // address -> completed count
      const escrowPromises: Promise<void>[] = [];
      for (let i = 1; i < nextId; i++) {
        escrowPromises.push(
          svc
            .getEscrow(i)
            .then((escrow) => {
              const addr = (escrow as any)?.freelancer as string | undefined;
              if (addr && typeof addr === "string" && addr.startsWith("G")) {
                const prev = freelancerMap.get(addr) ?? 0;
                const rawStatus = (escrow as any)?.status;
                const isCompleted =
                  rawStatus === 2 || // getEscrow numeric: released/completed
                  rawStatus === "completed" ||
                  rawStatus === "released" ||
                  rawStatus === "Completed" ||
                  rawStatus === "Released";
                freelancerMap.set(addr, prev + (isCompleted ? 1 : 0));
              }
            })
            .catch(() => {
              /* skip */
            }),
        );
      }
      await Promise.all(escrowPromises);

      // Fetch on-chain stats for each freelancer in parallel
      const profiles = await Promise.allSettled(
        Array.from(freelancerMap.entries()).map(
          async ([address, completedCount]): Promise<FreelancerProfile> => {
            const [badge, ratingData, rep] = await Promise.all([
              svc.getBadge(address).catch((): "Beginner" => "Beginner"),
              svc
                .getAverageRating(address)
                .catch(() => ({ average: 0, count: 0 })),
              svc.getReputation(address).catch(() => 0),
            ]);

            return {
              address,
              badge,
              avgRating: Math.round((ratingData.average ?? 0) * 10) / 10,
              ratingCount: Number(ratingData.count ?? 0),
              completedProjects: completedCount,
              reputation: Number(rep),
            };
          },
        ),
      );

      const valid = profiles
        .filter(
          (r): r is PromiseFulfilledResult<FreelancerProfile> =>
            r.status === "fulfilled",
        )
        .map((r) => r.value);

      setFreelancers(valid);
    } catch (err) {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFreelancers();
  }, [fetchFreelancers]);

  const filtered = freelancers
    .filter((f) => {
      const q = search.toLowerCase();
      const matchSearch = !q || f.address.toLowerCase().includes(q);
      const matchBadge = badgeFilter === "all" || f.badge === badgeFilter;
      return matchSearch && matchBadge;
    })
    .sort((a, b) => {
      if (sortBy === "rating") {
        if (b.avgRating !== a.avgRating) return b.avgRating - a.avgRating;
        return b.ratingCount - a.ratingCount;
      }
      if (sortBy === "projects")
        return b.completedProjects - a.completedProjects;
      return b.reputation - a.reputation;
    });

  return (
    <div className="min-h-screen gradient-mesh py-10">
      <div className="container mx-auto px-4 max-w-6xl space-y-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-3"
        >
          <div className="flex items-center justify-center gap-2 mb-2">
            <Users className="h-7 w-7 text-primary" />
            <h1 className="text-3xl font-bold">Browse Freelancers</h1>
          </div>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Discover verified on-chain freelancers. Every profile shows real
            completed projects and ratings — no fake reviews, all verifiable on
            the Stellar blockchain.
          </p>
        </motion.div>

        {/* Filters */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by wallet address…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={badgeFilter} onValueChange={setBadgeFilter}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="All Levels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              <SelectItem value="Expert">Expert</SelectItem>
              <SelectItem value="Advanced">Advanced</SelectItem>
              <SelectItem value="Intermediate">Intermediate</SelectItem>
              <SelectItem value="Beginner">Beginner</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as typeof sortBy)}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rating">Highest Rated</SelectItem>
              <SelectItem value="projects">Most Projects</SelectItem>
              <SelectItem value="reputation">Reputation</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" onClick={() => void fetchFreelancers()}>
            Refresh
          </Button>
        </motion.div>

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm">Scanning on-chain freelancer profiles…</p>
          </div>
        ) : filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-24"
          >
            <Users className="h-14 w-14 mx-auto mb-4 text-muted-foreground opacity-30" />
            <h3 className="text-xl font-semibold mb-2">
              {freelancers.length === 0
                ? "No freelancers found yet"
                : "No results match your filters"}
            </h3>
            <p className="text-muted-foreground text-sm max-w-sm mx-auto">
              {freelancers.length === 0
                ? "Freelancers appear here once they accept a job and start working on the platform."
                : "Try adjusting your search or filter."}
            </p>
          </motion.div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Showing {filtered.length} freelancer
              {filtered.length !== 1 ? "s" : ""}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {filtered.map((f, i) => (
                <FreelancerCard
                  key={f.address}
                  profile={f}
                  index={i}
                  canMessage={!!myAddress && myAddress !== f.address}
                  onHire={() => navigate(`/create?freelancer=${f.address}`)}
                  onMessage={() => setChatTarget(f.address)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Chat dialog */}
      {chatTarget && (
        <ChatDialog
          open={!!chatTarget}
          onOpenChange={(open) => {
            if (!open) setChatTarget(null);
          }}
          myAddress={myAddress}
          otherAddress={chatTarget}
        />
      )}
    </div>
  );
}

function FreelancerCard({
  profile,
  index,
  canMessage,
  onHire,
  onMessage,
}: {
  profile: FreelancerProfile;
  index: number;
  canMessage: boolean;
  onHire: () => void;
  onMessage: () => void;
}) {
  const short = `${profile.address.slice(0, 6)}…${profile.address.slice(-4)}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card className="group glass border-primary/20 hover:border-primary/50 transition-colors h-full flex flex-col relative overflow-hidden">
        <CardContent className="p-5 flex flex-col gap-4 flex-1">
          {/* Avatar + address + badge */}
          <div className="flex items-start gap-3">
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0 ${avatarColor(profile.address)}`}
            >
              {avatarLetters(profile.address)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm font-semibold truncate">
                {short}
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <VerifiedBadge address={profile.address} />
                <Badge
                  variant="outline"
                  className={`text-xs gap-1 ${BADGE_STYLES[profile.badge] ?? BADGE_STYLES.Beginner}`}
                >
                  <Award
                    className={`h-3 w-3 ${BADGE_ICON_COLOR[profile.badge] ?? "text-gray-400"}`}
                  />
                  {profile.badge}
                </Badge>
              </div>
            </div>
          </div>

          {/* Rating */}
          <StarRating value={profile.avgRating} count={profile.ratingCount} />

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-lg bg-muted/30 p-2.5">
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                <span className="text-base font-bold">
                  {profile.completedProjects}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">Projects done</p>
            </div>
            <div className="rounded-lg bg-muted/30 p-2.5">
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <Briefcase className="h-3.5 w-3.5 text-primary" />
                <span className="text-base font-bold">
                  {profile.reputation}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Reputation pts
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-auto flex gap-2">
            <Button size="sm" className="flex-1 gap-1" onClick={onHire}>
              Hire
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to={`/jobs?search=${profile.address}`}>Jobs</Link>
            </Button>
          </div>
        </CardContent>

        {/* Hover overlay — "Reach Out" button */}
        {canMessage && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto rounded-[inherit]">
            <Button
              size="default"
              className="gap-2 shadow-lg"
              onClick={onMessage}
            >
              <MessageCircle className="h-4 w-4" />
              Reach Out
            </Button>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
