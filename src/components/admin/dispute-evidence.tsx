import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useWeb3 } from "@/contexts/web3-context";
import { useToast } from "@/hooks/use-toast";
import { FileText, Upload, ExternalLink, User, Clock, Loader2, MessageSquare } from "lucide-react";
import { motion } from "framer-motion";
import { contractService } from "@/lib/web3/contract-service";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface OnChainEvidence {
  submitter: string;
  cid: string;
  submitted_at: number; // ledger timestamp (seconds)
}

interface DisputeEvidenceProps {
  escrowId: string;
  milestoneIndex: number;
  clientAddress: string;
  freelancerAddress: string;
  onEvidenceSubmitted?: () => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseCidAndDescription(fullCid: string) {
  const idx = fullCid.indexOf("|");
  if (idx === -1) return { cid: fullCid, description: "" };
  return { cid: fullCid.slice(0, idx), description: fullCid.slice(idx + 1) };
}

function formatTimestamp(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function DisputeEvidence({
  escrowId,
  milestoneIndex,
  clientAddress,
  freelancerAddress,
  onEvidenceSubmitted,
}: DisputeEvidenceProps) {
  const { wallet } = useWeb3();
  const { toast } = useToast();

  const [evidence, setEvidence] = useState<OnChainEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [evidenceCid, setEvidenceCid] = useState("");
  const [evidenceDescription, setEvidenceDescription] = useState("");

  const fetchEvidence = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await contractService.getEvidence(
        Number(escrowId),
        milestoneIndex
      );
      setEvidence(entries);
    } catch {
      setEvidence([]);
    } finally {
      setLoading(false);
    }
  }, [escrowId, milestoneIndex]);

  useEffect(() => {
    void fetchEvidence();
  }, [fetchEvidence]);

  const handleSubmitEvidence = async () => {
    if (!evidenceCid.trim()) {
      toast({
        title: "Evidence required",
        description: "Please enter an IPFS CID or evidence link",
        variant: "destructive",
      });
      return;
    }

    if (!wallet.address) {
      toast({
        title: "Wallet required",
        description: "Please connect your wallet to submit evidence",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const fullCid = evidenceDescription.trim()
        ? `${evidenceCid.trim()}|${evidenceDescription.trim()}`
        : evidenceCid.trim();

      await contractService.submitEvidence(
        Number(escrowId),
        milestoneIndex,
        wallet.address,
        fullCid
      );

      toast({
        title: "Evidence submitted!",
        description: "Your evidence has been recorded on-chain for this dispute",
      });

      setEvidenceCid("");
      setEvidenceDescription("");
      onEvidenceSubmitted?.();
      // Refresh to show the new entry
      await fetchEvidence();
    } catch (error: any) {
      toast({
        title: "Failed to submit evidence",
        description: error?.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const getSubmitterRole = (address: string) => {
    if (address === clientAddress) return "Client";
    if (address === freelancerAddress) return "Freelancer";
    return "Arbiter";
  };

  const getSubmitterColor = (address: string) => {
    if (address === clientAddress)
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    if (address === freelancerAddress)
      return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
    return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
  };

  const isUserParty =
    wallet.address &&
    (wallet.address === clientAddress || wallet.address === freelancerAddress);

  return (
    <Card className="glass border-primary/20">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Dispute Evidence &amp; Communication
              <Badge variant="outline" className="ml-2">
                {evidence.length} Submissions
              </Badge>
            </CardTitle>
            <CardDescription>
              On-chain evidence for Escrow #{escrowId}, Milestone {milestoneIndex + 1}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchEvidence()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Evidence Feed */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-3">Loading evidence from Soroban...</span>
          </div>
        ) : evidence.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border rounded-lg">
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p>No evidence submitted yet</p>
            <p className="text-sm">Both parties can submit evidence to support their case</p>
          </div>
        ) : (
          <div className="space-y-3">
            {evidence.map((entry, idx) => {
              const { cid, description } = parseCidAndDescription(entry.cid);
              return (
                <motion.div
                  key={`${entry.submitted_at}-${idx}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <Card className="border-l-4 border-l-primary/50">
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4" />
                          <Badge className={getSubmitterColor(entry.submitter)}>
                            {getSubmitterRole(entry.submitter)}
                          </Badge>
                          <span className="text-xs font-mono text-muted-foreground">
                            {entry.submitter.slice(0, 8)}...{entry.submitter.slice(-6)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatTimestamp(entry.submitted_at)}
                        </div>
                      </div>

                      {description && (
                        <p className="text-sm mb-2 text-foreground">{description}</p>
                      )}

                      <div className="flex items-center gap-2 bg-muted/50 p-2 rounded">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <code className="text-xs flex-1 truncate">{cid}</code>
                        <Button variant="ghost" size="sm" asChild>
                          <a
                            href={cid.startsWith("http") ? cid : `https://ipfs.io/ipfs/${cid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Submit Evidence Form (only for parties) */}
        {isUserParty && (
          <div className="border-t pt-6 space-y-4">
            <h4 className="text-sm font-semibold">Submit Your Evidence</h4>

            <div className="space-y-2">
              <Label htmlFor="evidenceCid">Evidence Link or IPFS CID</Label>
              <Input
                id="evidenceCid"
                placeholder="QmXxx... or https://..."
                value={evidenceCid}
                onChange={(e) => setEvidenceCid(e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Upload files to IPFS (Pinata, NFT.Storage) and paste the CID, or provide a direct URL
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="evidenceDescription">Description (Optional)</Label>
              <Textarea
                id="evidenceDescription"
                placeholder="Explain what this evidence shows..."
                value={evidenceDescription}
                onChange={(e) => setEvidenceDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="bg-muted/50 p-3 rounded-lg text-xs space-y-1">
              <p className="font-semibold">IPFS Upload Services:</p>
              <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                <li>
                  <a href="https://pinata.cloud" target="_blank" rel="noopener noreferrer" className="underline">
                    Pinata.cloud
                  </a>{" "}
                  — Free IPFS pinning
                </li>
                <li>
                  <a href="https://nft.storage" target="_blank" rel="noopener noreferrer" className="underline">
                    NFT.Storage
                  </a>{" "}
                  — Free permanent storage
                </li>
                <li>Or use any direct URL to your evidence</li>
              </ul>
            </div>

            <Button
              onClick={handleSubmitEvidence}
              disabled={submitting || !evidenceCid.trim()}
              className="w-full"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting to Soroban...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Submit Evidence On-Chain
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
