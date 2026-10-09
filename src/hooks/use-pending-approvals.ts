import { useState, useEffect } from "react";
import { useWeb3 } from "@/contexts/web3-context";
import { contractService } from "@/lib/web3/contract-service";

export function usePendingApprovals() {
  const { wallet } = useWeb3();
  const [hasPendingApprovals, setHasPendingApprovals] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!wallet.isConnected || !wallet.address) {
      setHasPendingApprovals(false);
      return;
    }

    checkPendingApprovals();
  }, [wallet.isConnected, wallet.address]);

  const checkPendingApprovals = async () => {
    setLoading(true);
    try {
      if (!wallet.address) {
        setHasPendingApprovals(false);
        return;
      }

      // My open jobs in one batch read, then their application counts in
      // parallel (previously one sequential read per escrow).
      const me = wallet.address.toLowerCase().trim();
      const escrowIds = await contractService.getUserEscrows(wallet.address);
      const escrows = await contractService.getEscrowsBatch(
        escrowIds.map(Number),
      );
      const myOpenJobs = escrows.filter(
        (e) =>
          e.creator.toLowerCase().trim() === me &&
          !e.freelancer &&
          e.status === 0,
      );
      const counts = await Promise.all(
        myOpenJobs.map((e) => contractService.getApplicationCount(e.escrow_id)),
      );
      if (counts.some((c) => c > 0)) {
        setHasPendingApprovals(true);
        return;
      }

      setHasPendingApprovals(false);
    } catch (error) {
      setHasPendingApprovals(false);
    } finally {
      setLoading(false);
    }
  };

  return {
    hasPendingApprovals,
    loading,
    refreshApprovals: checkPendingApprovals,
  };
}
