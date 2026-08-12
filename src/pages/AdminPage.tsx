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
} from "lucide-react";
import { ArbiterManagement } from "@/components/admin/arbiter-management";

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
  return (
    <div className="min-h-screen py-12 gradient-mesh">
      <div className="container mx-auto px-4 max-w-6xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold mb-2">Admin Panel</h1>
          <p className="text-muted-foreground">
            Manage SecureFlow contract settings and configurations
          </p>
        </div>

        {/* Role + Status alerts */}
        <div className="space-y-3">
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>
              {isOwner ? "Owner Access Confirmed" : "Arbiter Access Confirmed"}
            </AlertTitle>
            <AlertDescription className="flex items-center gap-2">
              You are connected as{" "}
              <Badge
                variant={isOwner ? "default" : "secondary"}
                className="gap-1"
              >
                {isOwner ? (
                  <Shield className="h-3 w-3" />
                ) : (
                  <Scale className="h-3 w-3" />
                )}
                {isOwner ? "Contract Owner" : "Authorized Arbiter"}
              </Badge>
            </AlertDescription>
          </Alert>

          {isPaused && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Contract Paused</AlertTitle>
              <AlertDescription>
                All escrow operations are currently paused. Users cannot create
                or interact with escrows.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Platform Stats Overview */}
        {isOwner && !loading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {contractStats.totalEscrows}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Total Escrows
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                    <Percent className="h-5 w-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {(contractStats.platformFeeBP / 100).toFixed(2)}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Platform Fee
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                    <Users className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {contractStats.authorizedArbiters}
                    </p>
                    <p className="text-xs text-muted-foreground">Arbiters</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                    <BarChart3 className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {contractStats.whitelistedTokens}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Tokens Listed
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Owner-only sections ─────────────────────────────────────────────── */}
        {contractOwner === null && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading owner controls…
          </div>
        )}
        {isOwner && (
          <>
            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lock className="h-5 w-5" />
                  Quick Actions
                </CardTitle>
                <CardDescription>Common administrative tasks</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  onClick={handleQuickWhitelistUSDC}
                  disabled={isWhitelisting || !USDC_ADDRESS}
                  className="w-full bg-linear-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800"
                  size="lg"
                >
                  {isWhitelisting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Whitelisting USDC...
                    </>
                  ) : (
                    <>
                      <Lock className="mr-2 h-4 w-4" />
                      Whitelist USDC Token
                    </>
                  )}
                </Button>
                {USDC_ADDRESS && (
                  <p className="text-xs text-muted-foreground text-center">
                    Enable USDC ({short(USDC_ADDRESS, 10, 8)}) for escrow
                    payments
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Token Management + Whitelisted Tokens */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Coins className="h-5 w-5" />
                    Add Custom Token
                  </CardTitle>
                  <CardDescription>
                    Whitelist a Soroban token contract (C...)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="tokenAddress">Token Contract Address</Label>
                    <Input
                      id="tokenAddress"
                      placeholder="C..."
                      value={tokenToWhitelist}
                      onChange={(e) => setTokenToWhitelist(e.target.value)}
                      className="font-mono text-sm"
                    />
                  </div>
                  <Button
                    onClick={handleWhitelistToken}
                    disabled={isWhitelisting || !tokenToWhitelist.trim()}
                    className="w-full"
                  >
                    {isWhitelisting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Whitelisting...
                      </>
                    ) : (
                      "Whitelist Token"
                    )}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    Whitelisted Tokens
                  </CardTitle>
                  <CardDescription>Active tokens in the system</CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                    </div>
                  ) : whitelistedTokenList.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No tokens whitelisted yet. Native XLM is always available.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                        <p className="text-sm font-semibold text-green-900 dark:text-green-100">
                          {whitelistedTokenList.length} Token
                          {whitelistedTokenList.length !== 1 ? "s" : ""}{" "}
                          Whitelisted
                        </p>
                      </div>
                      <div className="space-y-1">
                        {whitelistedTokenList.slice(0, 5).map((t) => (
                          <div key={t} className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void copy(t, "Token address")}
                              className="flex-1 text-left text-xs font-mono bg-muted p-2 rounded hover:bg-muted/80 transition-colors truncate"
                              title="Click to copy"
                            >
                              {short(t, 20, 14)}
                            </button>
                            <button
                              type="button"
                              title="Delist token"
                              disabled={delistingToken === t}
                              onClick={() => void handleDelistToken(t)}
                              className="shrink-0 p-1.5 rounded text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                            >
                              {delistingToken === t ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Platform Fee + Contract Controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Platform Fee */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Percent className="h-5 w-5" />
                    Platform Fee
                  </CardTitle>
                  <CardDescription>
                    Current fee:{" "}
                    {currentFeeBP === null ? (
                      <Loader2 className="inline h-3 w-3 animate-spin" />
                    ) : (
                      <strong>
                        {(currentFeeBP / 100).toFixed(2)}% ({currentFeeBP} bp)
                      </strong>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="newFee">New Fee (%)</Label>
                    <div className="flex gap-2">
                      <Input
                        id="newFee"
                        type="number"
                        min="0"
                        max="10"
                        step="0.01"
                        placeholder="e.g. 2.5"
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
                          "Set Fee"
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Enter 0–10%. Stored as basis points (1% = 100 bp). Applies
                      to future deposits.
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Pause / Unpause */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {isPaused ? (
                      <Play className="h-5 w-5" />
                    ) : (
                      <Pause className="h-5 w-5" />
                    )}
                    Contract Controls
                  </CardTitle>
                  <CardDescription>
                    Status:{" "}
                    <Badge
                      variant={isPaused ? "destructive" : "default"}
                      className="gap-1"
                    >
                      {isPaused ? (
                        <Pause className="h-3 w-3" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      {isPaused ? "Paused" : "Active"}
                    </Badge>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {isPaused
                      ? "The contract is paused. Resume operations to allow users to create and interact with escrows."
                      : "Temporarily halt all escrow operations for maintenance or emergency situations."}
                  </p>
                  <Button
                    onClick={() => {
                      setPauseAction(isPaused ? "unpause" : "pause");
                      setPauseDialogOpen(true);
                    }}
                    variant={isPaused ? "default" : "destructive"}
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
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : isPaused ? (
                      <>
                        <Play className="h-4 w-4" />
                        Unpause Contract
                      </>
                    ) : (
                      <>
                        <Pause className="h-4 w-4" />
                        Pause Contract
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Platform Fees */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Wallet className="h-5 w-5" />
                      Platform Fees
                    </CardTitle>
                    <CardDescription>
                      Accumulated fees ready to collect. Sent to the fee
                      collector address on withdrawal.
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
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading
                    balances...
                  </div>
                ) : feeBalances.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No fee data available.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {feeBalances.map(({ token, label, raw, display }) => {
                      const hasBalance = BigInt(raw) > 0n;
                      const isWithdrawing = withdrawingFeeToken === token;
                      return (
                        <div
                          key={token}
                          className="flex items-center justify-between rounded-lg border p-3"
                        >
                          <div>
                            <p className="font-semibold text-sm">{label}</p>
                            <p
                              className={`text-2xl font-bold ${hasBalance ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
                            >
                              {display}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {raw} stroops
                            </p>
                          </div>
                          <Button
                            onClick={() => handleWithdrawFees(token, label)}
                            disabled={
                              !hasBalance ||
                              isWithdrawing ||
                              withdrawingFeeToken !== null
                            }
                            variant={hasBalance ? "default" : "outline"}
                            size="sm"
                          >
                            {isWithdrawing ? (
                              <>
                                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                Withdrawing...
                              </>
                            ) : (
                              <>
                                <Wallet className="mr-2 h-3 w-3" />
                                Collect {label}
                              </>
                            )}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Delete Escrow */}
            <Card className="border-red-200 dark:border-red-900/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
                  <Trash2 className="h-5 w-5" />
                  Delete Escrow
                </CardTitle>
                <CardDescription>
                  Permanently removes an escrow record from on-chain storage.
                  The escrow must be in a terminal state (released, refunded,
                  expired, or cancelled) with zero remaining funds.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="deleteId">Escrow ID</Label>
                  <div className="flex gap-2">
                    <Input
                      id="deleteId"
                      placeholder="e.g. 7"
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
                  <p className="text-xs text-muted-foreground">
                    Enter the raw on-chain escrow number. This action is
                    irreversible.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Withdraw Stuck Funds */}
            <Card className="border-orange-200 dark:border-orange-900/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                  <Scale className="h-5 w-5" />
                  Withdraw Stuck Funds
                </CardTitle>
                <CardDescription>
                  Emergency recovery for tokens accidentally transferred to the
                  contract. Only withdraws the <strong>excess</strong> above
                  what's currently escrowed — cannot drain active escrows.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="withdraw-token">
                      Token Contract (C...)
                    </Label>
                    <Input
                      id="withdraw-token"
                      value={withdrawToken}
                      onChange={(e) => setWithdrawToken(e.target.value)}
                      placeholder="C..."
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="withdraw-to">Recipient (G...)</Label>
                    <Input
                      id="withdraw-to"
                      value={withdrawTo}
                      onChange={(e) => setWithdrawTo(e.target.value)}
                      placeholder="G..."
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="withdraw-amount">Amount (stroops)</Label>
                    <Input
                      id="withdraw-amount"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="10000000"
                      className="font-mono"
                    />
                  </div>
                </div>
                <Button
                  className="w-full gap-2"
                  variant="destructive"
                  disabled={
                    isWithdrawing ||
                    !withdrawToken.trim() ||
                    !withdrawTo.trim() ||
                    !withdrawAmount.trim()
                  }
                  onClick={handleWithdraw}
                >
                  {isWithdrawing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Scale className="h-4 w-4" />
                      Withdraw Excess
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Amount is in base units (stroops). For 7-decimal tokens: 1.00
                  XLM = 10,000,000 stroops.
                </p>
              </CardContent>
            </Card>
          </>
        )}

        {/* Arbiter Management — owner only */}
        {isOwner && (
          <ArbiterManagement
            onArbiterAdded={() => fetchContractStats()}
            onArbiterRemoved={() => fetchContractStats()}
          />
        )}

        {/* Dispute Management — all admins */}
        <Card className="border-orange-200 bg-orange-50/50 dark:bg-orange-900/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-orange-600" />
              Dispute Management
            </CardTitle>
            <CardDescription>
              View and resolve disputes on a dedicated page for better
              performance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => navigate("/disputes")}
              className="w-full bg-orange-600 hover:bg-orange-700"
              size="lg"
            >
              Open Dispute Management Page
            </Button>
            <p className="text-xs text-muted-foreground mt-3 text-center">
              Manage active disputes, review evidence, and communicate with
              parties
            </p>
          </CardContent>
        </Card>
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
