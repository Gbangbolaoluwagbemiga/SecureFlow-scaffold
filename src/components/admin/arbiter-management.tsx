import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { contractService } from "@/lib/web3/contract-service";
import {
  Shield,
  UserPlus,
  UserMinus,
  Loader2,
  CheckCircle2,
} from "lucide-react";

interface ArbiterManagementProps {
  onArbiterAdded?: () => void;
  onArbiterRemoved?: () => void;
}

// Stellar public key: starts with G, 56 chars total
const isStellarAddress = (addr: string) => /^G[A-Z2-7]{55}$/.test(addr.trim());

export function ArbiterManagement({
  onArbiterAdded,
  onArbiterRemoved,
}: ArbiterManagementProps) {
  const { wallet } = useWeb3();
  const { toast } = useToast();
  const [arbiters, setArbiters] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [newArbiterAddress, setNewArbiterAddress] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [removingArbiter, setRemovingArbiter] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [arbiterToRemove, setArbiterToRemove] = useState<string | null>(null);

  useEffect(() => {
    if (wallet.isConnected) void fetchArbiters();
  }, [wallet.isConnected]);

  const fetchArbiters = async () => {
    setLoading(true);
    try {
      const arbiterList = await contractService.getAuthorizedArbiters();
      setArbiters(arbiterList);
    } catch {
      toast({
        title: "Error",
        description: "Failed to fetch arbiters",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddArbiter = async () => {
    const trimmed = newArbiterAddress.trim();
    if (!isStellarAddress(trimmed)) {
      toast({
        title: "Invalid address",
        description:
          "Please enter a valid Stellar public key (starts with G, 56 chars)",
        variant: "destructive",
      });
      return;
    }

    if (arbiters.some((a) => a === trimmed)) {
      toast({
        title: "Already authorized",
        description: "This address is already an authorized arbiter",
        variant: "destructive",
      });
      return;
    }

    setIsAdding(true);
    try {
      await contractService.authorizeArbiter(trimmed);

      toast({
        title: "Arbiter authorized!",
        description: `${trimmed.slice(0, 10)}... can now resolve disputes`,
      });

      setNewArbiterAddress("");
      await fetchArbiters();
      onArbiterAdded?.();
    } catch (error: any) {
      toast({
        title: "Failed to authorize arbiter",
        description: error?.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsAdding(false);
    }
  };

  const openRemoveDialog = (arbiter: string) => {
    setArbiterToRemove(arbiter);
    setDialogOpen(true);
  };

  const handleRemoveArbiter = async () => {
    if (!arbiterToRemove) return;

    setRemovingArbiter(arbiterToRemove);
    try {
      await contractService.removeArbiter(arbiterToRemove);

      toast({
        title: "Arbiter removed",
        description: `${arbiterToRemove.slice(0, 10)}... can no longer resolve disputes`,
      });

      setDialogOpen(false);
      setArbiterToRemove(null);
      await fetchArbiters();
      onArbiterRemoved?.();
    } catch (error: any) {
      toast({
        title: "Failed to remove arbiter",
        description: error?.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setRemovingArbiter(null);
    }
  };

  if (loading) {
    return (
      <Card className="glass border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Arbiter Management
          </CardTitle>
          <CardDescription>Manage authorized dispute arbiters</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-3">Loading arbiters...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="glass border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Arbiter Management
            <Badge variant="outline" className="ml-auto">
              {arbiters.length} Authorized
            </Badge>
          </CardTitle>
          <CardDescription>
            Authorize trusted Stellar addresses to resolve disputes and manage
            escrow conflicts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Add Arbiter */}
          <div className="space-y-3">
            <Label htmlFor="arbiterAddress">Authorize New Arbiter</Label>
            <div className="flex gap-2">
              <Input
                id="arbiterAddress"
                placeholder="GABC... (Stellar public key)"
                value={newArbiterAddress}
                onChange={(e) => setNewArbiterAddress(e.target.value)}
                className="font-mono"
              />
              <Button
                onClick={handleAddArbiter}
                disabled={isAdding || !newArbiterAddress}
              >
                {isAdding ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Authorize
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Arbiters can resolve disputes and award funds to either party
            </p>
          </div>

          {/* Arbiters List */}
          <div className="space-y-3">
            <Label>Authorized Arbiters</Label>
            {arbiters.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border rounded-lg">
                <Shield className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p>No arbiters authorized yet</p>
                <p className="text-sm">
                  Add trusted Stellar addresses to resolve disputes
                </p>
              </div>
            ) : (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Address</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {arbiters.map((arbiter) => (
                      <TableRow key={arbiter}>
                        <TableCell className="font-mono text-sm">
                          {arbiter.slice(0, 10)}...{arbiter.slice(-8)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Active
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => openRemoveDialog(arbiter)}
                            disabled={removingArbiter === arbiter}
                          >
                            {removingArbiter === arbiter ? (
                              <>
                                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                Removing...
                              </>
                            ) : (
                              <>
                                <UserMinus className="mr-2 h-3 w-3" />
                                Remove
                              </>
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="bg-muted/50 p-4 rounded-lg text-sm space-y-2">
            <p className="font-semibold">Arbiter Responsibilities:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Review dispute evidence from both parties</li>
              <li>Make fair decisions on fund distribution</li>
              <li>Resolve disputes in a timely manner</li>
              <li>Maintain neutrality and professionalism</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Remove Confirmation Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Arbiter</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this arbiter? They will no longer
              be able to resolve disputes.
            </DialogDescription>
          </DialogHeader>
          {arbiterToRemove && (
            <div className="bg-muted/50 p-3 rounded-lg">
              <p className="text-sm font-mono">
                {arbiterToRemove.slice(0, 10)}...{arbiterToRemove.slice(-8)}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemoveArbiter}
              disabled={!!removingArbiter}
            >
              {removingArbiter ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing...
                </>
              ) : (
                "Remove Arbiter"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
