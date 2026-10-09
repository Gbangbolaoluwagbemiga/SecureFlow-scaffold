import { useState, useEffect, useCallback } from "react";
import { useWeb3 } from "@/contexts/web3-context";
import { contractService } from "@/lib/web3/contract-service";

/**
 * Is this wallet acting as a freelancer: has it applied to a job, or been
 * named as the freelancer on one (direct hires never apply)?
 *
 * Two index reads instead of probing escrow ids one call at a time. Re-checks
 * when `recheckKey` changes, so the navbar picks up a first application as
 * soon as the user navigates.
 */
export function useFreelancerStatus(recheckKey?: string) {
  const { wallet } = useWeb3();
  const [isFreelancer, setIsFreelancer] = useState(false);
  const [loading, setLoading] = useState(false);

  const check = useCallback(async () => {
    if (!wallet.isConnected || !wallet.address) {
      setIsFreelancer(false);
      return;
    }
    setLoading(true);
    try {
      const me = wallet.address;
      const [applied, myEscrowIds] = await Promise.all([
        contractService.getFreelancerApplicationIds(me),
        contractService.getUserEscrows(me),
      ]);
      if (applied.length > 0) {
        setIsFreelancer(true);
        return;
      }
      const escrows = await contractService.getEscrowsBatch(
        myEscrowIds.map(Number),
      );
      setIsFreelancer(escrows.some((e) => e.freelancer === me));
    } catch {
      setIsFreelancer(false);
    } finally {
      setLoading(false);
    }
  }, [wallet.isConnected, wallet.address]);

  useEffect(() => {
    void check();
  }, [check, recheckKey]);

  return { isFreelancer, loading };
}
