import { useEffect, useState } from "react";
import { BadgeCheck } from "lucide-react";
import { contractService } from "@/lib/web3/contract-service";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * "Verified" tag for a freelancer whose identity was checked with Didit.
 * Read from the contract, so it can't be faked in the UI or the backend.
 * Renders nothing for unverified addresses.
 */
export function VerifiedBadge({
  address,
  className = "",
}: {
  address?: string | null;
  className?: string;
}) {
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!address) return;
    contractService
      .isFreelancerVerified(address)
      .then((v) => !cancelled && setVerified(v))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!verified) return null;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 ${className}`}
          >
            <BadgeCheck className="h-3.5 w-3.5" />
            Verified
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Identity verified with Didit. One verified account per person.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
