import { useCallback, useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  ShieldQuestion,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { contractService } from "@/lib/web3/contract-service";
import {
  getIdentityVerificationStatus,
  isApiConfigured,
  startIdentityVerification,
  type VerificationState,
} from "@/lib/api";

const POLL_MS = 8_000;
const POLL_FOR_MS = 15 * 60_000;

const STATE_MESSAGES: Partial<Record<NonNullable<VerificationState>, string>> =
  {
    pending:
      "Finish the check in the Didit tab. This page updates by itself when it's done.",
    in_review:
      "Didit is reviewing your documents manually. This can take a little while.",
    declined:
      "Didit couldn't verify your identity. You can try again with a clearer photo or another document.",
    duplicate_identity:
      "Your identity is already verified on another wallet. Each person can verify one freelancer account.",
    wallet_bound:
      "This wallet is already verified as a different person. Contact support if that's wrong.",
    error:
      "Something went wrong recording your verification. Please try again.",
  };

/**
 * Lets a freelancer verify their identity with Didit. Clients then see a
 * Verified tag next to them. The result lives on-chain, one wallet per person.
 */
export function IdentityVerificationCard({ wallet }: { wallet: string }) {
  const { toast } = useToast();
  const [verified, setVerified] = useState<boolean | null>(null);
  const [state, setState] = useState<VerificationState>(null);
  const [starting, setStarting] = useState(false);
  const pollUntil = useRef(0);

  const refresh = useCallback(async () => {
    contractService.clearVerifiedCache(wallet);
    const onChain = await contractService.isFreelancerVerified(wallet);
    setVerified(onChain);
    if (onChain) {
      setState("approved");
      return true;
    }
    if (isApiConfigured()) {
      try {
        const status = await getIdentityVerificationStatus(wallet);
        setState(status.state);
        if (status.verified) setVerified(true);
        return status.verified;
      } catch {
        // backend unreachable: the on-chain answer above stands
      }
    }
    return false;
  }, [wallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // After starting a session, poll until verified (or give up quietly).
  useEffect(() => {
    const id = setInterval(async () => {
      if (Date.now() > pollUntil.current) return;
      if (await refresh()) {
        pollUntil.current = 0;
        toast({
          title: "Identity verified",
          description: "Clients will now see the Verified tag next to you.",
        });
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh, toast]);

  const start = async () => {
    setStarting(true);
    try {
      const session = await startIdentityVerification(wallet);
      if (session.verified) {
        setVerified(true);
        return;
      }
      if (session.url) {
        window.open(session.url, "_blank", "noopener,noreferrer");
        setState("pending");
        pollUntil.current = Date.now() + POLL_FOR_MS;
      }
    } catch (error) {
      toast({
        title: "Couldn't start verification",
        description:
          error instanceof Error ? error.message : "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setStarting(false);
    }
  };

  if (verified === null) return null;

  // Verified: one slim line, not a card. It says what verification is
  // buying them without taking a slab of the dashboard to do it.
  if (verified) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-emerald-500/30 bg-emerald-500/[0.07] px-4 py-2 text-sm w-fit max-w-full">
        <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
          <BadgeCheck className="h-4 w-4 shrink-0" />
          Identity verified
        </span>
        <span className="text-muted-foreground">
          Clients see your Verified tag · +10 when Autopilot ranks applicants
        </span>
      </div>
    );
  }

  const message = state ? STATE_MESSAGES[state] : undefined;
  const waiting = state === "pending" || state === "in_review";

  return (
    <Card className="glass border-primary/20 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <ShieldQuestion className="h-6 w-6 text-primary shrink-0" />
      <div className="text-sm flex-1">
        <p className="font-semibold">Get verified</p>
        <p className="text-muted-foreground">
          {message ??
            "Verify your identity with Didit (about 2 minutes, ID and a selfie). Verified freelancers stand out to clients."}
        </p>
      </div>
      <Button
        onClick={start}
        disabled={starting || !isApiConfigured()}
        variant={waiting ? "outline" : "default"}
        className="gap-2 shrink-0"
      >
        {starting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ExternalLink className="h-4 w-4" />
        )}
        {waiting ? "Reopen Didit" : "Verify identity"}
      </Button>
    </Card>
  );
}
