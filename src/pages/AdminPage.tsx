import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWeb3 } from "@/contexts/web3-context";
import { useToast } from "@/hooks/use-toast";
import { useAdminStatus } from "@/hooks/use-admin-status";
import { contractService } from "@/lib/web3/contract-service";
import { getNativeXLMSACAddress } from "@/lib/web3/stellar-config";
import { usePauseJobCreation, useUnpauseJobCreation } from "@/hooks/use-admin";
import {
  Shield,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Lock,
  Percent,
  Trash2,
  Pause,
  Play,
  AlertTriangle,
  Scale,
  Coins,
  BarChart3,
  Users,
  FileText,
  Wallet,
  RefreshCw,
  Settings,
  Sprout,
  Plus,
  X,
} from "lucide-react";
import { ArbiterManagement } from "@/components/admin/arbiter-management";
import { DisputeResolution } from "@/components/admin/dispute-resolution";
import { OverdueDisputeResolution } from "@/components/admin/overdue-dispute-resolution";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const USDC_ADDRESS = (
  (import.meta.env.VITE_USDC_TOKEN_CONTRACT as string | undefined) ?? ""
).trim();

export default function AdminPage() {
  const { wallet } = useWeb3();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isAdmin, loading: adminLoading } = useAdminStatus();
  const pauseJobCreation = usePauseJobCreation();
  const unpauseJobCreation = useUnpauseJobCreation();

  // Contract state
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [contractOwner, setContractOwner] = useState<string | null>(null);

  const isOwner =
    contractOwner !== null &&
    wallet.address?.toLowerCase() === contractOwner.toLowerCase();

  const [contractStats, setContractStats] = useState({
    platformFeeBP: 0,
    totalEscrows: 0,
    authorizedArbiters: 0,
    whitelistedTokens: 0,
  });

  // Token whitelist state
  const [tokenToWhitelist, setTokenToWhitelist] = useState("");
  const [whitelistedTokenList, setWhitelistedTokenList] = useState<string[]>(
    [],
  );
  const [isWhitelisting, setIsWhitelisting] = useState(false);
  const [delistingToken, setDelistingToken] = useState<string | null>(null);

  // Platform fee state
  const [currentFeeBP, setCurrentFeeBP] = useState<number | null>(null);
  const [newFeePercent, setNewFeePercent] = useState("");
  const [isSettingFee, setIsSettingFee] = useState(false);

  // Delete escrow state
  const [deleteInput, setDeleteInput] = useState("");
  const [isDeletingEscrow, setIsDeletingEscrow] = useState(false);

  // Withdraw stuck funds state
  const [withdrawToken, setWithdrawToken] = useState("");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  // Platform fees state
  const [feeBalances, setFeeBalances] = useState<
    { token: string; label: string; raw: string; display: string }[]
  >([]);
  const [fetchingFees, setFetchingFees] = useState(false);
  const [withdrawingFeeToken, setWithdrawingFeeToken] = useState<string | null>(
    null,
  );

  // Yield on idle funds
  const [yieldPool, setYieldPool] = useState<string | null>(null);
  const [yieldShareBp, setYieldShareBp] = useState<number | null>(null);
  const [newShare, setNewShare] = useState("");
  const [savingShare, setSavingShare] = useState(false);

  // Pause/unpause dialog
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const [pauseAction, setPauseAction] = useState<"pause" | "unpause">("pause");
  const [pauseActionLoading, setPauseActionLoading] = useState(false);

  useEffect(() => {
    if (wallet.isConnected && wallet.address) {
      Promise.all([
        checkPausedStatus(),
        fetchContractOwner(),
        fetchContractStats(),
        fetchYieldSettings(),
        fetchFeeBalances(),
      ]);
    }
  }, [wallet.isConnected, wallet.address]);

  const fetchContractOwner = async () => {
    try {
      const owner = await contractService.getOwner();
      setContractOwner(owner);
    } catch {
      const ownerFromEnv = import.meta.env.VITE_OWNER_ADDRESS;
      if (ownerFromEnv) setContractOwner(ownerFromEnv);
    }
  };

  const fetchContractStats = async () => {
    try {
      const [platformFeeBP, totalEscrows, arbiters, tokens] = await Promise.all(
        [
          contractService.getPlatformFeeBP(),
          contractService.getTotalEscrows(),
          contractService.getAuthorizedArbiters(),
          contractService.getWhitelistedTokens(),
        ],
      );
      setWhitelistedTokenList(tokens);
      setCurrentFeeBP(platformFeeBP);
      setContractStats({
        platformFeeBP,
        totalEscrows,
        authorizedArbiters: arbiters.length,
        whitelistedTokens: tokens.length,
      });
    } catch {
      setWhitelistedTokenList([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchYieldSettings = async () => {
    const [pool, total] = await Promise.all([
      contractService.getYieldPool(),
      contractService.getTotalEscrows().catch(() => 0),
    ]);
    setYieldPool(pool);
    // The share is reported on every escrow's yield info.
    if (total > 0) {
      const info = await contractService.getYieldInfo(total);
      if (info) setYieldShareBp(info.freelancerShareBp);
    }
  };

  const handleSetYieldShare = async () => {
    const pct = Number(newShare);
    if (!wallet.address || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      toast({
        title: "Invalid share",
        description: "Enter a percentage between 0 and 100.",
        variant: "destructive",
      });
      return;
    }
    setSavingShare(true);
    try {
      await contractService.setYieldFreelancerShare(
        Math.round(pct * 100),
        wallet.address,
      );
      toast({
        title: "Tip share updated",
        description: `Freelancers now get ${pct}% of a successful job's yield.`,
      });
      setNewShare("");
      await fetchYieldSettings();
    } catch (e: any) {
      toast({
        title: "Couldn't update the share",
        description: e?.message || "Transaction failed.",
        variant: "destructive",
      });
    } finally {
      setSavingShare(false);
    }
  };

  const checkPausedStatus = async () => {
    try {
      const paused = await contractService.isJobCreationPaused(
        wallet.address || undefined,
      );
      setIsPaused(paused);
    } catch {
      setIsPaused(false);
    }
  };

  const short = (addr: string, left = 10, right = 8) =>
    addr.length > left + right
      ? `${addr.slice(0, left)}…${addr.slice(-right)}`
      : addr;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: `${label} copied to clipboard` });
    } catch {
      toast({
        title: "Copy failed",
        description: "Clipboard permission denied",
        variant: "destructive",
      });
    }
  };

  const handleWhitelistToken = async () => {
    if (!tokenToWhitelist.trim()) return;
    setIsWhitelisting(true);
    try {
      await contractService.whitelistToken(tokenToWhitelist.trim());
      toast({
        title: "Token Whitelisted",
        description: `${short(tokenToWhitelist.trim())} is now available for escrow payments.`,
      });
      setTokenToWhitelist("");
      await fetchContractStats();
    } catch (error: any) {
      toast({
        title: "Whitelist Failed",
        description: error?.message || "Transaction failed.",
        variant: "destructive",
      });
    } finally {
      setIsWhitelisting(false);
    }
  };

  const handleQuickWhitelistUSDC = async () => {
    if (!USDC_ADDRESS) {
      toast({
        title: "USDC Not Configured",
        description: "Set VITE_USDC_TOKEN_CONTRACT in your .env file",
        variant: "destructive",
      });
      return;
    }
    setIsWhitelisting(true);
    try {
      await contractService.whitelistToken(USDC_ADDRESS);
      toast({
        title: "USDC Whitelisted",
        description: "Users can now create escrows with USDC.",
      });
      await fetchContractStats();
    } catch (error: any) {
      const msg = error?.message || "";
      if (
        msg.includes("AlreadyWhitelisted") ||
        msg.includes("already whitelisted")
      ) {
        toast({
          title: "USDC Already Whitelisted",
          description: "This token is already available for escrows.",
        });
      } else {
        toast({
          title: "Whitelist Failed",
          description: msg,
          variant: "destructive",
        });
      }
    } finally {
      setIsWhitelisting(false);
    }
  };

  const handleDelistToken = async (token: string) => {
    setDelistingToken(token);
    try {
      await contractService.delistToken(token);
      toast({
        title: "Token Delisted",
        description: `${short(token, 20, 14)} has been removed from the whitelist.`,
      });
      await fetchContractStats();
    } catch (error: any) {
      toast({
        title: "Delist Failed",
        description: error?.message || "Transaction failed.",
        variant: "destructive",
      });
    } finally {
      setDelistingToken(null);
    }
  };

  const handleSetPlatformFee = async () => {
    const pct = parseFloat(newFeePercent);
    if (isNaN(pct) || pct < 0 || pct > 10) {
      toast({
        title: "Invalid fee",
        description: "Enter a percentage between 0 and 10.",
        variant: "destructive",
      });
      return;
    }
    const bp = Math.round(pct * 100);
    setIsSettingFee(true);
    try {
      await contractService.setPlatformFeeBP(bp);
      setCurrentFeeBP(bp);
      setNewFeePercent("");
      toast({
        title: "Platform fee updated",
        description: `Fee set to ${pct}% (${bp} basis points).`,
      });
    } catch (error: any) {
      toast({
        title: "Failed to update fee",
        description: error?.message || "Transaction failed.",
        variant: "destructive",
      });
    } finally {
      setIsSettingFee(false);
    }
  };

  const handleDeleteEscrow = async () => {
    const raw = deleteInput.trim();
    if (!raw) return;
    const onChainId = parseInt(raw, 10);
    if (!Number.isFinite(onChainId) || onChainId <= 0) {
      toast({
        title: "Invalid ID",
        description: "Enter a valid numeric escrow ID.",
        variant: "destructive",
      });
      return;
    }
    setIsDeletingEscrow(true);
    try {
      await contractService.deleteEscrow(onChainId);
      toast({
        title: "Escrow deleted",
        description: `Escrow #${onChainId} has been permanently removed.`,
      });
      setDeleteInput("");
    } catch (error: any) {
      const msg: string = error?.message || "Transaction failed.";
      const friendly = msg.includes("InvalidEscrowStatus")
        ? "Escrow must be in a terminal state (released, refunded, expired, or cancelled) before deletion."
        : msg.includes("InvalidAmount")
          ? "Escrow still has funds. Ensure all funds are paid out first."
          : msg.includes("EscrowNotFound")
            ? "No escrow found with that ID."
            : msg;
      toast({
        title: "Delete failed",
        description: friendly,
        variant: "destructive",
      });
    } finally {
      setIsDeletingEscrow(false);
    }
  };

  const handlePauseAction = async () => {
    setPauseActionLoading(true);
    try {
      if (pauseAction === "pause") {
        await pauseJobCreation.mutateAsync();
      } else {
        await unpauseJobCreation.mutateAsync();
      }
      setPauseDialogOpen(false);
      window.location.reload();
    } catch (error: any) {
      toast({
        title: "Action failed",
        description: error?.message || "Transaction failed.",
        variant: "destructive",
      });
    } finally {
      setPauseActionLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawToken.trim() || !withdrawTo.trim() || !withdrawAmount.trim())
      return;
    setIsWithdrawing(true);
    try {
      await contractService.withdrawStuckFunds({
        token: withdrawToken.trim(),
        to: withdrawTo.trim(),
        amount: withdrawAmount.trim(),
      });
      toast({
        title: "Withdraw submitted",
        description:
          "Transaction sent. Funds will transfer after confirmation.",
      });
      setWithdrawAmount("");
    } catch (e: any) {
      toast({
        title: "Withdraw failed",
        description: e?.message || "Transaction failed",
        variant: "destructive",
      });
    } finally {
      setIsWithdrawing(false);
    }
  };

  const fetchFeeBalances = async () => {
    setFetchingFees(true);
    try {
      const xlmAddress = getNativeXLMSACAddress();
      const tokens = [
        { token: xlmAddress, label: "XLM" },
        ...(USDC_ADDRESS ? [{ token: USDC_ADDRESS, label: "USDC" }] : []),
      ];
      const results = await Promise.all(
        tokens.map(async ({ token, label }) => {
          const raw = await contractService.getWithdrawableFees(token);
          const stroops = BigInt(raw || "0");
          const display =
            stroops === 0n
              ? "0"
              : (Number(stroops) / 1e7).toFixed(7).replace(/\.?0+$/, "");
          return { token, label, raw: String(stroops), display };
        }),
      );
      setFeeBalances(results);
    } catch {
      // silently ignore
    } finally {
      setFetchingFees(false);
    }
  };

  const handleWithdrawFees = async (token: string, label: string) => {
    if (!wallet.address) return;
    setWithdrawingFeeToken(token);
    try {
      await contractService.withdrawFees(wallet.address, token);
      toast({
        title: "Fees withdrawn",
        description: `${label} platform fees sent to fee collector.`,
      });
      await fetchFeeBalances();
    } catch (e: any) {
      toast({
        title: "Withdraw failed",
        description: e?.message || "Transaction failed.",
        variant: "destructive",
      });
    } finally {
      setWithdrawingFeeToken(null);
    }
  };

  // ── Gate: wallet not connected ────────────────────────────────────────────────
  if (!wallet.isConnected) {
    return (
      <div className="min-h-screen py-12 gradient-mesh">
        <div className="container mx-auto px-4 max-w-4xl">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-6 w-6" />
                Admin Panel
              </CardTitle>
              <CardDescription>
                Manage SecureFlow contract settings
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Wallet not connected</AlertTitle>
                <AlertDescription>
                  Please connect your wallet to access the admin panel.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (adminLoading) {
    return (
      <div className="min-h-screen py-12 gradient-mesh flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Gate: not admin ───────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="min-h-screen py-12 gradient-mesh">
        <div className="container mx-auto px-4 max-w-4xl">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-6 w-6" />
                Admin Panel
              </CardTitle>
              <CardDescription>
                Manage SecureFlow contract settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Access Denied</AlertTitle>
                <AlertDescription>
                  You are not the contract owner or an authorized arbiter.
                </AlertDescription>
              </Alert>
              <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                <p className="text-sm font-medium">Troubleshooting:</p>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Make sure you're connected with the owner wallet</li>
                  <li>Check if the RPC connection is working</li>
                  <li>Try refreshing the page</li>
                </ul>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  <strong>Your Address:</strong>{" "}
                  <code className="bg-muted px-1 py-0.5 rounded">
                    {wallet.address}
                  </code>
                </p>
                {contractOwner && (
                  <p>
                    <strong>Contract Owner:</strong>{" "}
                    <code className="bg-muted px-1 py-0.5 rounded">
                      {contractOwner}
                    </code>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── Main admin UI ─────────────────────────────────────────────────────────────
  const usdcListed =
    !!USDC_ADDRESS && whitelistedTokenList.some((t) => t === USDC_ADDRESS);
  const tabs = isOwner
    ? ["settings", "tokens", "arbiters", "disputes", "danger"]
    : ["disputes"];

  return (
    <div className="min-h-screen py-10 gradient-mesh">
      <div className="container mx-auto px-4 max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
            <p className="text-sm text-muted-foreground">
              Contract settings, tokens, arbiters and disputes
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1.5 py-1">
              {isOwner ? (
                <Shield className="h-3.5 w-3.5" />
              ) : (
                <Scale className="h-3.5 w-3.5" />
              )}
              {isOwner ? "Contract owner" : "Arbiter"}
            </Badge>
            <Badge
              variant={isPaused ? "destructive" : "secondary"}
              className="gap-1.5 py-1"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${isPaused ? "bg-white" : "bg-emerald-500"}`}
              />
              {isPaused ? "Job creation paused" : "Live"}
            </Badge>
          </div>
        </div>

        {contractOwner === null && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading owner controls…
          </div>
        )}

        <Tabs defaultValue={tabs[0]} key={tabs.join(",")}>
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted/50 p-1">
            {isOwner && (
              <>
                <TabsTrigger value="settings" className="gap-1.5">
                  <Settings className="h-4 w-4" /> Settings
                </TabsTrigger>
                <TabsTrigger value="tokens" className="gap-1.5">
                  <Coins className="h-4 w-4" /> Tokens & fees
                </TabsTrigger>
                <TabsTrigger value="arbiters" className="gap-1.5">
                  <Users className="h-4 w-4" /> Arbiters
                </TabsTrigger>
              </>
            )}
            <TabsTrigger value="disputes" className="gap-1.5">
              <Scale className="h-4 w-4" /> Disputes
            </TabsTrigger>
            {isOwner && (
              <TabsTrigger value="danger" className="gap-1.5">
                <AlertTriangle className="h-4 w-4" /> Danger zone
              </TabsTrigger>
            )}
          </TabsList>

          {/* ── Settings ─────────────────────────────────────────────── */}
          {isOwner && (
            <TabsContent value="settings" className="mt-6 space-y-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Percent className="h-4 w-4" /> Platform fee
                    </CardTitle>
                    <CardDescription>
                      Now{" "}
                      {currentFeeBP === null ? (
                        <Loader2 className="inline h-3 w-3 animate-spin" />
                      ) : (
                        <strong>
                          {(currentFeeBP / 100).toFixed(2)}% ({currentFeeBP} bp)
                        </strong>
                      )}
                      , charged on top of new escrows
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2">
                      <Input
                        id="newFee"
                        type="number"
                        min="0"
                        max="10"
                        step="0.01"
                        placeholder="New fee %, 0–10"
                        value={newFeePercent}
                        onChange={(e) => setNewFeePercent(e.target.value)}
                      />
                      <Button
                        onClick={handleSetPlatformFee}
                        disabled={isSettingFee || !newFeePercent}
                        className="shrink-0"
                      >
                        {isSettingFee ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Set"
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {isPaused ? (
                        <Play className="h-4 w-4" />
                      ) : (
                        <Pause className="h-4 w-4" />
                      )}
                      Job creation
                    </CardTitle>
                    <CardDescription>
                      {isPaused
                        ? "Paused: nobody can post new jobs."
                        : "Live: anyone can post new jobs."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      onClick={() => {
                        setPauseAction(isPaused ? "unpause" : "pause");
                        setPauseDialogOpen(true);
                      }}
                      variant={isPaused ? "default" : "outline"}
                      className="w-full gap-2"
                      disabled={
                        pauseActionLoading ||
                        pauseJobCreation.isPending ||
                        unpauseJobCreation.isPending
                      }
                    >
                      {pauseActionLoading ||
                      pauseJobCreation.isPending ||
                      unpauseJobCreation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isPaused ? (
                        <Play className="h-4 w-4" />
                      ) : (
                        <Pause className="h-4 w-4" />
                      )}
                      {isPaused ? "Resume job creation" : "Pause job creation"}
                    </Button>
                  </CardContent>
                </Card>
              </div>

              {/* Yield */}
              <Card className="border-emerald-500/30">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sprout className="h-4 w-4 text-emerald-500" /> Yield on
                    idle funds
                  </CardTitle>
                  <CardDescription>
                    Clients can let unpaid budgets earn in Blend. On a job
                    completed without dispute the freelancer gets a tip; the
                    platform keeps the rest, and all of it otherwise.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      XLM pool
                    </p>
                    {yieldPool ? (
                      <button
                        type="button"
                        onClick={() => void copy(yieldPool, "Pool address")}
                        className="font-mono text-sm hover:underline"
                        title="Click to copy"
                      >
                        Blend · {short(yieldPool, 6, 6)}
                      </button>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Not configured
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Freelancer tip{" "}
                      {yieldShareBp !== null && (
                        <span className="normal-case tracking-normal">
                          · now {yieldShareBp / 100}%
                        </span>
                      )}
                    </p>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        placeholder="Tip %, 0–100"
                        value={newShare}
                        onChange={(e) => setNewShare(e.target.value)}
                      />
                      <Button
                        onClick={handleSetYieldShare}
                        disabled={savingShare || newShare === ""}
                        className="shrink-0"
                      >
                        {savingShare ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Set"
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Tokens & fees ────────────────────────────────────────── */}
          {isOwner && (
            <TabsContent value="tokens" className="mt-6 space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Coins className="h-4 w-4" /> Accepted tokens
                      </CardTitle>
                      <CardDescription>
                        Native XLM is always accepted.
                      </CardDescription>
                    </div>
                    {USDC_ADDRESS && !usdcListed && !loading && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleQuickWhitelistUSDC}
                        disabled={isWhitelisting}
                        className="gap-1.5"
                      >
                        {isWhitelisting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                        Add USDC
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {whitelistedTokenList.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-1 pl-3 pr-1 text-xs"
                        >
                          <button
                            type="button"
                            onClick={() => void copy(t, "Token address")}
                            className="font-mono hover:underline"
                            title={t}
                          >
                            {t === USDC_ADDRESS
                              ? "USDC"
                              : t === getNativeXLMSACAddress()
                                ? "XLM"
                                : short(t, 5, 5)}
                          </button>
                          <button
                            type="button"
                            title="Remove from the list"
                            disabled={delistingToken === t}
                            onClick={() => void handleDelistToken(t)}
                            className="rounded-full p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          >
                            {delistingToken === t ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <X className="h-3 w-3" />
                            )}
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      id="tokenAddress"
                      placeholder="Add a token contract (C…)"
                      value={tokenToWhitelist}
                      onChange={(e) => setTokenToWhitelist(e.target.value)}
                      className="font-mono text-sm"
                    />
                    <Button
                      onClick={handleWhitelistToken}
                      disabled={isWhitelisting || !tokenToWhitelist.trim()}
                      className="shrink-0"
                    >
                      {isWhitelisting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Add"
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Wallet className="h-4 w-4" /> Earned fees
                      </CardTitle>
                      <CardDescription>
                        Platform fees and the platform's share of yield, sent to
                        the fee collector. A tiny reserve stays behind to cover
                        yield rounding.
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={fetchFeeBalances}
                      disabled={fetchingFees}
                      className="shrink-0"
                    >
                      <RefreshCw
                        className={`h-4 w-4 ${fetchingFees ? "animate-spin" : ""}`}
                      />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {fetchingFees && feeBalances.length === 0 ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                    </div>
                  ) : feeBalances.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No fee data available.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {feeBalances.map(({ token, label, raw, display }) => {
                        const hasBalance = BigInt(raw) > 0n;
                        const isWithdrawingFee = withdrawingFeeToken === token;
                        return (
                          <div
                            key={token}
                            className="flex items-center justify-between rounded-lg border p-3"
                          >
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {label}
                              </p>
                              <p
                                className={`text-xl font-bold ${hasBalance ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
                              >
                                {display}
                              </p>
                            </div>
                            <Button
                              onClick={() => handleWithdrawFees(token, label)}
                              disabled={
                                !hasBalance ||
                                isWithdrawingFee ||
                                withdrawingFeeToken !== null
                              }
                              variant={hasBalance ? "default" : "outline"}
                              size="sm"
                            >
                              {isWithdrawingFee ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                "Collect"
                              )}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Arbiters ─────────────────────────────────────────────── */}
          {isOwner && (
            <TabsContent value="arbiters" className="mt-6">
              <ArbiterManagement
                onArbiterAdded={() => fetchContractStats()}
                onArbiterRemoved={() => fetchContractStats()}
              />
            </TabsContent>
          )}

          {/* ── Disputes ─────────────────────────────────────────────── */}
          <TabsContent value="disputes" className="mt-6">
            <Tabs defaultValue="milestone">
              <TabsList className="mb-4">
                <TabsTrigger value="milestone">Milestone disputes</TabsTrigger>
                <TabsTrigger value="overdue">Overdue jobs</TabsTrigger>
              </TabsList>
              <TabsContent value="milestone">
                <DisputeResolution onDisputeResolved={() => {}} />
              </TabsContent>
              <TabsContent value="overdue">
                <OverdueDisputeResolution />
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* ── Danger zone ──────────────────────────────────────────── */}
          {isOwner && (
            <TabsContent value="danger" className="mt-6 space-y-6">
              <Card className="border-red-500/30">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-red-600 dark:text-red-400">
                    <Trash2 className="h-4 w-4" /> Delete a finished escrow
                  </CardTitle>
                  <CardDescription>
                    Removes a released, refunded, expired or cancelled escrow
                    with nothing left in it from on-chain storage. Irreversible.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <Input
                      id="deleteId"
                      placeholder="Escrow number, e.g. 7"
                      value={deleteInput}
                      onChange={(e) => setDeleteInput(e.target.value)}
                      className="font-mono"
                    />
                    <Button
                      variant="destructive"
                      onClick={handleDeleteEscrow}
                      disabled={isDeletingEscrow || !deleteInput.trim()}
                      className="shrink-0"
                    >
                      {isDeletingEscrow ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Delete"
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-orange-500/30">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-orange-600 dark:text-orange-400">
                    <Scale className="h-4 w-4" /> Recover stuck funds
                  </CardTitle>
                  <CardDescription>
                    Only the surplus above everything owed to escrows, earned
                    fees and held yield can be taken. Active escrows can't be
                    drained.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <Input
                      id="withdraw-token"
                      value={withdrawToken}
                      onChange={(e) => setWithdrawToken(e.target.value)}
                      placeholder="Token (C…)"
                      className="font-mono"
                    />
                    <Input
                      id="withdraw-to"
                      value={withdrawTo}
                      onChange={(e) => setWithdrawTo(e.target.value)}
                      placeholder="Recipient (G…)"
                      className="font-mono"
                    />
                    <Input
                      id="withdraw-amount"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="Amount in stroops"
                      className="font-mono"
                    />
                  </div>
                  <Button
                    className="w-full gap-2"
                    variant="outline"
                    disabled={
                      isWithdrawing ||
                      !withdrawToken.trim() ||
                      !withdrawTo.trim() ||
                      !withdrawAmount.trim()
                    }
                    onClick={handleWithdraw}
                  >
                    {isWithdrawing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Scale className="h-4 w-4" />
                    )}
                    Withdraw surplus
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    1 XLM = 10,000,000 stroops.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Pause/Unpause confirmation dialog */}
      <Dialog open={pauseDialogOpen} onOpenChange={setPauseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pauseAction === "pause" ? (
                <>
                  <Pause className="h-5 w-5 text-destructive" />
                  Pause Contract
                </>
              ) : (
                <>
                  <Play className="h-5 w-5 text-primary" />
                  Unpause Contract
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {pauseAction === "pause"
                ? "This will halt all escrow operations. Users will not be able to create or interact with escrows until the contract is unpaused."
                : "This will resume all escrow operations. Users will be able to interact with escrows again."}
            </DialogDescription>
          </DialogHeader>
          <Alert variant={pauseAction === "pause" ? "destructive" : "default"}>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              This action will be recorded on the blockchain and cannot be
              undone.
            </AlertDescription>
          </Alert>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPauseDialogOpen(false)}
              disabled={pauseActionLoading}
            >
              Cancel
            </Button>
            <Button
              variant={pauseAction === "pause" ? "destructive" : "default"}
              onClick={handlePauseAction}
              disabled={pauseActionLoading}
            >
              {pauseActionLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : pauseAction === "pause" ? (
                "Pause Contract"
              ) : (
                "Unpause Contract"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
