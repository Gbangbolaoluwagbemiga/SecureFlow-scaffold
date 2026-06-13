/**
 * Recover original milestone requirement descriptions from the Stellar ledger.
 *
 * When a freelancer submits a milestone the contract overwrites the milestone's
 * description field with the submission response, losing the original requirements.
 * This utility fetches the payer's transaction history via Horizon and parses the
 * original create_escrow invocation arguments to recover the descriptions.
 */

import { xdr, scValToNative } from "@stellar/stellar-sdk";
import { getCurrentNetwork, CONTRACTS } from "./stellar-config";

/**
 * Extract the inner V1 transaction body from any envelope type
 * (handles plain V1, legacy V0, and fee-bump outer envelopes).
 */
function extractTxBody(envelopeB64: string): any | null {
  try {
    const envelope = xdr.TransactionEnvelope.fromXDR(envelopeB64, "base64");
    const sw = envelope.switch().value;

    if (sw === xdr.EnvelopeType.envelopeTypeTx().value) {
      return envelope.v1().tx();
    }
    if (sw === xdr.EnvelopeType.envelopeTypeTxV0().value) {
      return envelope.v0().tx();
    }
    if (sw === xdr.EnvelopeType.envelopeTypeFeeBump().value) {
      // The inner transaction is always V1 inside a fee-bump
      return envelope.feeBump().tx().innerTx().v1().tx();
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Try to read the Soroban return value (escrow ID) from result_meta_xdr.
 * Returns null if the field is absent or unparseable.
 */
function extractSorobanReturnValue(resultMetaB64: string | undefined): bigint | null {
  if (!resultMetaB64) return null;
  try {
    const txMeta = xdr.TransactionMeta.fromXDR(resultMetaB64, "base64");
    if (txMeta.switch().value !== 3) return null; // Must be V3 for Soroban
    const sorobanMeta = (txMeta as any).v3().sorobanMeta();
    if (!sorobanMeta) return null;
    const raw = scValToNative(sorobanMeta.returnValue() as xdr.ScVal);
    // Escrow ID is returned as u32/i128 — normalise to bigint for comparison
    return BigInt(String(raw));
  } catch { /* ignore */ }
  return null;
}

/**
 * Returns the original milestone requirement strings for an escrow, or null
 * entries for any that cannot be determined.  Results are best-effort.
 *
 * Matching strategy (in order):
 * 1. Soroban return value from result_meta_xdr matches escrowId
 * 2. All milestone amounts from the transaction match the current amounts
 */
export async function recoverOriginalMilestoneRequirements(
  escrowId: string,
  payerAddress: string,
  currentMilestoneAmounts: string[]
): Promise<(string | null)[]> {
  const count = currentMilestoneAmounts.length;
  const empty: (string | null)[] = new Array(count).fill(null);

  try {
    const { horizonUrl } = getCurrentNetwork();
    const contractId = CONTRACTS.SECUREFLOW_ESCROW;
    console.log("[recover-req] start — escrowId:", escrowId, "contractId:", contractId, "payerAddress:", payerAddress, "horizonUrl:", horizonUrl);
    if (!contractId || !payerAddress) {
      console.log("[recover-req] aborting: missing contractId or payerAddress");
      return empty;
    }

    const { StrKey } = await import("@stellar/stellar-sdk");

    // Fetch payer's transactions — ascending so earliest (= lowest escrow IDs) come first
    const url = `${horizonUrl}/accounts/${payerAddress}/transactions?limit=200&order=asc`;
    console.log("[recover-req] fetching:", url);
    const resp = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    console.log("[recover-req] fetch status:", resp.status, resp.statusText);
    if (!resp.ok) {
      console.log("[recover-req] fetch not ok — aborting");
      return empty;
    }

    const json = await resp.json();
    const records: any[] = json._embedded?.records ?? [];
    console.log(`[recover-req] escrow ${escrowId}: fetched ${records.length} txs for ${payerAddress}`);

    const candidates: Array<{ descriptions: string[]; confidence: "high" | "low" }> = [];

    for (const tx of records) {
      if (!tx.envelope_xdr) continue;

      const txBody = extractTxBody(tx.envelope_xdr);
      if (!txBody) continue;

      for (const op of txBody.operations()) {
        try {
          const body = op.body();
          if (body.switch().value !== xdr.OperationType.invokeHostFunction().value) continue;

          const hostFn = body.invokeHostFunction().hostFunction();
          if (hostFn.switch().value !== xdr.HostFunctionType.hostFunctionTypeInvokeContract().value) continue;

          const invokeArgs = hostFn.invokeContract();

          // Verify it targets our contract
          let txContractId: string;
          try {
            txContractId = StrKey.encodeContract(invokeArgs.contractAddress().contractId());
          } catch { continue; }
          if (txContractId !== contractId) continue;

          // Verify function name is create_escrow
          const fnName = Buffer.from(invokeArgs.functionName()).toString("utf8");
          if (fnName !== "create_escrow") continue;

          // Extract milestones from args[4]
          const callArgs = invokeArgs.args();
          if (callArgs.length < 5) continue;

          const milestonesNative: any[] = scValToNative(callArgs[4] as xdr.ScVal) as any[];
          if (!Array.isArray(milestonesNative) || milestonesNative.length !== count) continue;

          const descriptions = milestonesNative.map((m: any) => {
            if (Array.isArray(m)) return String(m[1] ?? "");
            if (m && typeof m === "object") return String(m[1] ?? m.description ?? "");
            return "";
          });

          const txAmounts = milestonesNative.map((m: any) => {
            const raw = Array.isArray(m) ? m[0] : (m?.[0] ?? 0);
            return String(BigInt(String(raw)));
          });

          // Check if amounts match current escrow milestones
          const amountsMatch = txAmounts.every(
            (a, i) => a === String(BigInt(currentMilestoneAmounts[i] ?? "0"))
          );

          // Check Soroban return value for high-confidence match
          const returnedId = extractSorobanReturnValue(tx.result_meta_xdr);
          const idMatches = returnedId !== null && String(returnedId) === String(escrowId);

          console.log(`[recover-req] tx ${tx.id}: idMatches=${idMatches} amountsMatch=${amountsMatch} descs=`, descriptions);

          if (idMatches) {
            // High confidence — return immediately
            return descriptions.map(d => d || null);
          }

          if (amountsMatch) {
            candidates.push({ descriptions, confidence: "low" });
          }
        } catch { continue; }
      }
    }

    console.log("[recover-req] done scanning. candidates:", candidates.length);

    // Use best low-confidence candidate (last one wins if multiple match by amounts)
    if (candidates.length > 0) {
      const best = candidates[candidates.length - 1];
      return best.descriptions.map(d => d || null);
    }
  } catch (err) {
    console.error("[recover-req] outer catch:", err);
  }

  return empty;
}
