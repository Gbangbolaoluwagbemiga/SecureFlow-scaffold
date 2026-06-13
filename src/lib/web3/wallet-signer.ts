/**
 * Centralized wallet signing utility
 * Handles transaction signing with any wallet supported by StellarWalletsKit.
 */

import { TransactionBuilder } from "@stellar/stellar-sdk";
import { wallet } from "@/util/wallet";
import { getCurrentNetwork } from "./stellar-config";
import storage from "@/util/storage";

interface SignTransactionProps {
  unsignedTransaction: string | TransactionBuilder;
  address: string;
}

export const signTransaction = async ({
  unsignedTransaction,
  address,
}: SignTransactionProps): Promise<string> => {
  const network = getCurrentNetwork();

  // Convert TransactionBuilder to XDR if needed
  let txXdr: string;
  if (typeof unsignedTransaction === "string") {
    txXdr = unsignedTransaction;
  } else {
    // TransactionBuilder has toXDR() method
    txXdr = (unsignedTransaction as any).toXDR();
  }

  // Get wallet ID from storage
  const walletId = storage.getItem("walletId");
  if (!walletId) {
    throw new Error("Wallet not connected");
  }

  wallet.setWallet(walletId);

  // Wake up the wallet extension's service worker (fixes Chrome MV3 termination)
  try { await wallet.getAddress(); } catch (_) { /* ignore */ }

  const signResult = await wallet.signTransaction(txXdr, {
    networkPassphrase: network.networkPassphrase,
    address,
  });

  if (!signResult || !signResult.signedTxXdr) {
    throw new Error(
      "Transaction signing failed - no signed transaction received",
    );
  }

  return signResult.signedTxXdr;
};

/**
 * Sign auth entries for contract invocations.
 * Uses StellarWalletsKit so any connected wallet (Freighter, XBULL, Lobstr, etc.)
 * is supported — no Freighter-specific API is imported directly.
 */
export const signAuthEntries = async (
  authEntries: any[],
  address: string,
): Promise<string[]> => {
  const network = getCurrentNetwork();

  const walletId = storage.getItem("walletId");
  if (!walletId) throw new Error("Wallet not connected");
  wallet.setWallet(walletId);

  // Wake up the wallet extension's service worker (fixes Chrome MV3 termination)
  try { await wallet.getAddress(); } catch (_) { /* ignore */ }

  const signedAuthEntries = await Promise.all(
    authEntries.map(async (entry: any) => {
      const entryXdr = entry.toXDR("base64");

      const signed = await wallet.signAuthEntry(entryXdr, {
        networkPassphrase: network.networkPassphrase,
        address,
      });

      const signedEntry =
        (signed as any).signedAuthEntry ?? (signed as any).signedAuthEntryXdr;
      if (!signedEntry) {
        throw new Error("Auth entry signing failed — no signed entry returned");
      }
      return signedEntry;
    }),
  );

  return signedAuthEntries;
};
