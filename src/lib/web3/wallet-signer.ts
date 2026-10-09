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
  try {
    await wallet.getAddress();
  } catch (_) {
    /* ignore */
  }

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
  try {
    await wallet.getAddress();
  } catch (_) {
    /* ignore */
  }

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

/**
 * Sign a plain-text message (SEP-53) with the connected wallet. Returns the
 * signature as base64, whatever shape the wallet hands it back in.
 */
export const signMessage = async (
  message: string,
  address: string,
): Promise<string> => {
  const network = getCurrentNetwork();
  const walletId = storage.getItem("walletId");
  if (!walletId) throw new Error("Wallet not connected");
  wallet.setWallet(walletId);
  try {
    await wallet.getAddress();
  } catch (_) {
    /* ignore */
  }

  const result = await wallet.signMessage(message, {
    networkPassphrase: network.networkPassphrase,
    address,
  });
  const signed = (result as { signedMessage?: unknown })?.signedMessage;
  if (!signed) throw new Error("The wallet did not return a signature");
  if (typeof signed === "string") return signed;
  // Some Freighter versions return bytes rather than a base64 string.
  const bytes =
    signed instanceof Uint8Array
      ? signed
      : new Uint8Array(
          ((signed as { data?: number[] }).data ?? []) as number[],
        );
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
};
