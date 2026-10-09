import { useState, useEffect, useCallback } from "react";
import { useWeb3 } from "@/contexts/web3-context";
import { contractService } from "@/lib/web3/contract-service";

/**
 * Has this wallet created any escrow? One index read plus one batch read,
 * instead of probing escrow ids 1..20 one network call at a time (which ran
 * on every page via the navbar and missed anything past id 20).
 */
export function useJobCreatorStatus() {
  const { wallet } = useWeb3();
  const [isJobCreator, setIsJobCreator] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkJobCreatorStatus = useCallback(async () => {
    if (!wallet.isConnected || !wallet.address) {
      setIsJobCreator(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const me = wallet.address.toLowerCase().trim();
      const ids = await contractService.getUserEscrows(wallet.address);
      const escrows = await contractService.getEscrowsBatch(ids.map(Number));
      setIsJobCreator(
        escrows.some((e) => e.creator.toLowerCase().trim() === me),
      );
    } catch {
      setIsJobCreator(false);
    } finally {
      setLoading(false);
    }
  }, [wallet.isConnected, wallet.address]);

  useEffect(() => {
    void checkJobCreatorStatus();
  }, [checkJobCreatorStatus]);

  return { isJobCreator, loading };
}
