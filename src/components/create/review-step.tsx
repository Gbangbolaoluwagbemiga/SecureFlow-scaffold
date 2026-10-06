import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Clock, DollarSign, User, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { WHITELISTED_TOKENS } from "./project-details-step";
import { contractService } from "@/lib/web3/contract-service";
// Stellar doesn't use smart accounts - removed useSmartAccount import

interface Milestone {
  description: string;
  amount: string;
}

interface ReviewStepProps {
  formData: {
    projectTitle: string;
    projectDescription: string;
    duration: string;
    totalBudget: string;
    beneficiary: string;
    token: string;
    useNativeToken: boolean;
    isOpenJob: boolean;
    milestones: Milestone[];
  };
  onConfirm: () => void;
  isSubmitting: boolean;
  isContractPaused: boolean;
  isOnCorrectNetwork?: boolean;
  walletBalance?: string;
}

export function ReviewStep({
  formData,
  onConfirm,
  isSubmitting,
  isContractPaused,
  isOnCorrectNetwork = true,
  walletBalance,
}: ReviewStepProps) {
  // Stellar doesn't use smart accounts
  const isSmartAccountReady = false;
  const totalMilestoneAmount = formData.milestones.reduce(
    (sum, milestone) => sum + Number.parseFloat(milestone.amount || "0"),
    0,
  );

  const isTotalValid =
    Math.abs(totalMilestoneAmount - Number.parseFloat(formData.totalBudget)) <
    0.01;

  // The platform fee is charged ON TOP of the budget, so the client sees the
  // full amount leaving their wallet before confirming.
  const [feeBp, setFeeBp] = useState<number | null>(null);
  useEffect(() => {
    contractService
      .getPlatformFeeBP()
      .then(setFeeBp)
      .catch(() => setFeeBp(null));
  }, []);

  const budget = totalMilestoneAmount;
  const fee = feeBp !== null ? (budget * feeBp) / 10_000 : 0;
  const deposit = budget + fee;
  const balance = Number.parseFloat(walletBalance || "0");
  const hasInsufficientBalance =
    formData.useNativeToken && balance > 0 && deposit > balance;

  const tokenSymbol = formData.useNativeToken
    ? "Native XLM"
    : WHITELISTED_TOKENS.find((t) => t.address === formData.token)?.symbol ||
      formData.token ||
      "Not selected";

  return (
    <Card className="glass border-primary/20 p-6">
      <CardHeader>
        <CardTitle>Review & Confirm</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-5">
          <div className="space-y-2">
            <h3 className="font-semibold text-lg">{formData.projectTitle}</h3>
            <p className="text-muted-foreground">
              {formData.projectDescription}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{formData.duration} days</span>
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                {Number(formData.totalBudget || 0).toFixed(2)} {tokenSymbol}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                {formData.isOpenJob ? "Open Job" : "Direct Assignment"}
              </span>
            </div>
          </div>

          {formData.beneficiary && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Beneficiary:</p>
              <p className="font-mono text-sm">{formData.beneficiary}</p>
            </div>
          )}

          <div className="space-y-3">
            <h4 className="font-medium">
              Milestones ({formData.milestones.length})
            </h4>
            <div className="space-y-2">
              {formData.milestones.map((milestone, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 bg-muted/20 rounded"
                >
                  <span className="text-sm">{milestone.description}</span>
                  <span className="text-sm font-medium">
                    {Number(milestone.amount || 0).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">Total Milestone Amount:</span>
              <span className="font-semibold">
                {totalMilestoneAmount.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium">Project Budget:</span>
              <span className="font-semibold">
                {Number(formData.totalBudget || 0).toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Platform fee
                {feeBp !== null ? ` (${(feeBp / 100).toFixed(2)}%)` : ""}:
              </span>
              <span>{feeBp !== null ? fee.toFixed(4) : "…"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium">Total deposit:</span>
              <span className="font-semibold">
                {deposit.toFixed(4)} {tokenSymbol}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              The fee is refunded in full if you cancel before work starts, and
              in proportion to any money returned to you later.
            </p>
            {!isTotalValid && (
              <p className="text-sm text-destructive mt-3">
                ⚠️ Milestone amounts don't match project budget
              </p>
            )}
            {hasInsufficientBalance && (
              <p className="text-sm text-destructive mt-3 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Insufficient balance — you have {balance.toFixed(2)} XLM but
                need {deposit.toFixed(2)} XLM (budget + fee)
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-4">
          <button
            type="button"
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (
                !isSubmitting &&
                !isContractPaused &&
                isTotalValid &&
                isOnCorrectNetwork &&
                !hasInsufficientBalance
              ) {
                try {
                  await onConfirm();
                } catch (error) {}
              }
            }}
            disabled={
              isSubmitting ||
              isContractPaused ||
              !isTotalValid ||
              !isOnCorrectNetwork ||
              hasInsufficientBalance
            }
            className="flex-1 bg-primary text-primary-foreground px-6 py-3 rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              "Creating Escrow..."
            ) : isSmartAccountReady ? (
              <>
                <Zap className="h-4 w-4" />
                Create Gasless Escrow
              </>
            ) : (
              "Create Escrow"
            )}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
