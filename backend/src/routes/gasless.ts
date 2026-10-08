/**
 * Gasless transaction endpoint.
 *
 * The frontend builds and signs the inner Soroban transaction (user pays
 * nothing — their wallet only provides auth / authentication).  This route
 * wraps it in a Stellar fee-bump transaction signed by the admin wallet so
 * that the admin account pays all network fees.
 *
 * Required env vars:
 *   ADMIN_SECRET_KEY          – secret key of the fee-sponsor account
 *   STELLAR_RPC_URL           – Soroban RPC endpoint (default: testnet)
 *   STELLAR_NETWORK_PASSPHRASE – network passphrase (default: testnet)
 */

import { Router } from "express";
import {
  Keypair,
  TransactionBuilder,
  Networks,
  Transaction,
} from "@stellar/stellar-sdk";
import { Server as RpcServer } from "@stellar/stellar-sdk/rpc";

export const gaslessRouter = Router();

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_PASSPHRASE = Networks.TESTNET;

/**
 * Wallets / JSON sometimes deliver XDR with whitespace, PEM-style line breaks,
 * or URL-safe base64. Stellar RPC expects canonical base64.
 */
function normalizeSignedTxXdr(raw: string): string {
  let s = String(raw).trim();
  s = s.replace(/\s/g, "");
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  return s;
}

function getAdminKeypair(): Keypair {
  const secret = process.env.ADMIN_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error(
      "ADMIN_SECRET_KEY is not configured — set it in backend/.env",
    );
  }
  return Keypair.fromSecret(secret);
}

function getRpcServer(): RpcServer {
  return new RpcServer(process.env.STELLAR_RPC_URL ?? DEFAULT_RPC_URL);
}

function getNetworkPassphrase(): string {
  return (process.env.STELLAR_NETWORK_PASSPHRASE ?? DEFAULT_PASSPHRASE).trim();
}

/** buildFeeBumpTransaction requires a plain Transaction, not a FeeBumpTransaction. */
function requireInnerTransaction(
  parsed: ReturnType<typeof TransactionBuilder.fromXDR>,
): Transaction {
  const maybeBump = parsed as Transaction & {
    innerTransaction?: Transaction;
  };
  if (maybeBump.innerTransaction) {
    return maybeBump.innerTransaction;
  }
  return parsed as Transaction;
}

gaslessRouter.post("/apply", async (req, res) => {
  try {
    const { signedTxXdr } = req.body ?? {};

    if (!signedTxXdr || typeof signedTxXdr !== "string") {
      res.status(400).json({ error: "signedTxXdr is required" });
      return;
    }

    const normalizedXdr = normalizeSignedTxXdr(signedTxXdr);
    if (normalizedXdr.length < 48) {
      res
        .status(400)
        .json({ error: "signedTxXdr is too short to be valid XDR" });
      return;
    }

    const adminKeypair = getAdminKeypair();
    const networkPassphrase = getNetworkPassphrase();
    const rpcServer = getRpcServer();

    const parsed = TransactionBuilder.fromXDR(normalizedXdr, networkPassphrase);
    const innerTx = requireInnerTransaction(parsed);

    const innerFeeRaw = innerTx.fee ?? "100";
    const innerFee = Number.parseInt(String(innerFeeRaw), 10);
    const innerFeeSafe = Number.isFinite(innerFee) ? innerFee : 100;
    const bumpBaseFee = Math.max(innerFeeSafe, 500_000).toString();

    const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
      adminKeypair.publicKey(),
      bumpBaseFee,
      innerTx,
      networkPassphrase,
    );

    feeBumpTx.sign(adminKeypair);

    const sendResponse = await rpcServer.sendTransaction(feeBumpTx as any);

    // Only a confirmed SUCCESS is reported as success. The old loop exited as
    // soon as RPC said NOT_FOUND (normal for the first seconds after
    // submission) and returned the hash as if it had worked, and
    // TRY_AGAIN_LATER / DUPLICATE fell through to "success" too — so the UI
    // showed "Applied" for applications that never reached the chain.
    if (sendResponse.status !== "PENDING" || !sendResponse.hash) {
      const detail =
        (sendResponse as any).errorResult?.result?.()?.switch?.()?.name ??
        sendResponse.status;
      res.status(502).json({
        error: `Transaction was not accepted by the network (${detail}). Please try again.`,
      });
      return;
    }

    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      let result: Awaited<ReturnType<typeof rpcServer.getTransaction>>;
      try {
        result = await rpcServer.getTransaction(sendResponse.hash);
      } catch {
        continue; // transient RPC error: keep polling
      }
      if (result.status === "SUCCESS") {
        res.json({ txHash: sendResponse.hash });
        return;
      }
      if (result.status === "FAILED") {
        const code = (result as any).resultXdr?.result?.()?.switch?.()?.name;
        res.status(502).json({
          error: `Transaction failed on-chain${code ? ` (${code})` : ""}.`,
          txHash: sendResponse.hash,
        });
        return;
      }
      // NOT_FOUND: not in a ledger yet; keep waiting.
    }

    res.status(504).json({
      error:
        "The network didn't confirm the transaction in time. It may still land; refresh in a minute before retrying.",
      txHash: sendResponse.hash,
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Gasless transaction failed";
    console.error("[gasless]", msg);
    if (err instanceof Error && err.stack) console.error(err.stack);
    res.status(500).json({ error: msg });
  }
});
