/**
 * Contract Service Layer
 * Provides a clean interface for contract interactions
 * Following the pattern from Pacto P2P
 */

import {
  Contract,
  rpc,
  Address,
  nativeToScVal,
  scValToNative,
  TransactionBuilder,
  Operation,
  xdr,
} from "@stellar/stellar-sdk";
import { Client as SecureFlowClient } from "@/contracts/generated/src/index";
import { getCurrentNetwork, CONTRACTS } from "./stellar-config";
import { signTransaction, signAuthEntries } from "./wallet-signer";
import useWalletStore from "@/store/wallet.store";

export interface EscrowData {
  escrow_id: number;
  creator: string;
  freelancer?: string;
  status: number;
  token?: string;
  amount: string;
  paid_amount?: string;
  deadline: number;
  created_at: number;
  milestones?: any[];
  project_title?: string;
  project_description?: string;
}

export interface CreateEscrowParams {
  depositor: string;
  beneficiary?: string;
  arbiters: string[];
  required_confirmations: number;
  milestones: Array<[string, string]>; // [amount, description] tuples
  token?: string;
  total_amount: string;
  duration: number; // in seconds
  project_title: string;
  project_description: string;
}

export type EscrowContractHealth =
  | { ok: true; jobCreationPaused: boolean }
  | { ok: false; userMessage: string };

export class ContractService {
  private contractId: string;
  private network: ReturnType<typeof getCurrentNetwork>;
  private client: SecureFlowClient;
  private rpcServer: rpc.Server;

  constructor(contractId?: string) {
    this.contractId = contractId || CONTRACTS.SECUREFLOW_ESCROW;
    this.network = getCurrentNetwork();
    this.client = new SecureFlowClient({
      contractId: this.contractId,
      networkPassphrase: this.network.networkPassphrase,
      rpcUrl: this.network.rpcUrl,
    });
    this.rpcServer = new rpc.Server(this.network.rpcUrl);
  }

  private syncFromConfig() {
    const nextContractId = (CONTRACTS.SECUREFLOW_ESCROW || "").trim();
    const nextNetwork = getCurrentNetwork();

    const contractChanged = nextContractId !== this.contractId;
    const networkChanged =
      nextNetwork.rpcUrl !== this.network.rpcUrl ||
      nextNetwork.networkPassphrase !== this.network.networkPassphrase;

    if (!contractChanged && !networkChanged) return;

    this.contractId = nextContractId;
    this.network = nextNetwork;
    this.client = new SecureFlowClient({
      contractId: this.contractId,
      networkPassphrase: this.network.networkPassphrase,
      rpcUrl: this.network.rpcUrl,
    });
    this.rpcServer = new rpc.Server(this.network.rpcUrl);
  }

  private assertValidContractId() {
    // Soroban contract IDs are StrKey and start with C + 55 chars (total 56)
    if (!this.contractId || !/^C[A-Z2-7]{55}$/.test(this.contractId)) {
      throw new Error(`Invalid contract ID: ${this.contractId || "(empty)"}`);
    }
  }

  /**
   * Read operations - use client directly
   */
  async getEscrow(escrowId: number): Promise<EscrowData | null> {
    try {
      this.syncFromConfig();
      this.assertValidContractId();
      // Use the RPC server directly to avoid the generated client's type checking
      // The generated client expects Option<EscrowData> but the contract returns a map directly
      const contract = new Contract(this.contractId);

      // For view functions, we need a valid account address as the source
      // Use the wallet address if available, otherwise use a dummy account
      let sourceAddress: string;
      const walletAddress = useWalletStore.getState().address;
      if (
        walletAddress &&
        walletAddress.startsWith("G") &&
        walletAddress.length === 56
      ) {
        // Valid Stellar account address (starts with G and is 56 chars)
        sourceAddress = walletAddress;
      } else {
        // Use a dummy account for view functions (any valid account address works)
        // GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF is the zero account
        sourceAddress =
          "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
      }

      // For view functions, we can use a dummy account for simulation
      // The RPC server doesn't require a real account for simulation
      // Create a minimal account object directly to avoid "invalid version byte" errors
      const sourceAccount = {
        accountId: () => sourceAddress,
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {
          // No-op for simulation
        },
      } as any;

      // Build transaction for simulation using contract.call()
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call("get_escrow", nativeToScVal(escrowId, { type: "u32" }))
        )
        .setTimeout(30)
        .build();

      // Simulate to get the result
      const simulation = await this.rpcServer.simulateTransaction(tx);

      // Check for errors
      if ("errorResult" in simulation && simulation.errorResult) {
        const errorValue =
          (simulation.errorResult as any).value?.() || simulation.errorResult;
        // If error is about escrow not found, return null
        if (
          errorValue.toString().includes("not found") ||
          errorValue.toString().includes("does not exist")
        ) {
          return null;
        }
        throw new Error(
          `Transaction simulation failed: ${errorValue.toString()}`
        );
      }

      // Get the return value from simulation
      let escrowMap: any = null;
      if ("returnValue" in simulation && simulation.returnValue) {
        escrowMap = simulation.returnValue;
      } else if ("result" in simulation && (simulation as any).result) {
        const result = (simulation as any).result;
        // Check if result has retval (the actual return value)
        if (result.retval) {
          escrowMap = result.retval;
        } else {
          escrowMap = result;
        }
      }

      if (!escrowMap) {
        return null;
      }

      // Check if the contract returned Option::None (scvVoid)
      if (
        escrowMap &&
        escrowMap._switch &&
        escrowMap._switch.name === "scvVoid"
      ) {
        return null;
      }

      // If escrowMap is an ScVal map, extract fields directly
      // The map structure is: { _switch: { name: "scvMap" }, _value: [entries] }
      // Each entry has: { _attributes: { key: ScVal, val: ScVal } }
      let escrowDataMap: Record<string, any> = {};

      if (
        escrowMap &&
        escrowMap._switch &&
        escrowMap._switch.name === "scvMap" &&
        escrowMap._value
      ) {
        // It's an ScVal map, extract entries
        const entries = escrowMap._value;
        for (const entry of entries) {
          if (entry && entry._attributes) {
            const keyScVal = entry._attributes.key;
            const valScVal = entry._attributes.val;

            // Extract key string from ScVal symbol
            if (
              keyScVal &&
              keyScVal._switch &&
              keyScVal._switch.name === "scvSymbol"
            ) {
              const keyBuffer = keyScVal._value?.data || keyScVal._value;
              if (keyBuffer) {
                // Convert buffer to string - handle both Buffer and Uint8Array
                let keyStr: string;
                if (
                  keyBuffer instanceof Uint8Array ||
                  (keyBuffer.type === "Buffer" && keyBuffer.data)
                ) {
                  keyStr = String.fromCharCode(
                    ...(keyBuffer.data || keyBuffer)
                  );
                } else if (typeof keyBuffer === "string") {
                  keyStr = keyBuffer;
                } else {
                  const bufferArray = Array.isArray(keyBuffer)
                    ? keyBuffer
                    : Array.from(keyBuffer as ArrayLike<number>);
                  keyStr = String.fromCharCode(...bufferArray);
                }
                // Convert value ScVal to native - extract value safely
                try {
                  // Helper to safely extract value from ScVal
                  const extractValue = (scVal: any): any => {
                    if (!scVal) return undefined;

                    // If it's already a native value, return it
                    if (typeof scVal !== "object") {
                      return scVal;
                    }

                    // Check if it's a proper ScVal object with _switch property
                    if (scVal._switch && typeof scVal._switch === "object") {
                      try {
                        // It's a proper ScVal, convert it
                        return scValToNative(scVal);
                      } catch (e) {
                        // If conversion fails, try to extract value directly
                        if (scVal._value !== undefined) {
                          return scVal._value;
                        }
                        return scVal;
                      }
                    }

                    // Try to extract value from different possible structures
                    if (scVal._value !== undefined) {
                      return scVal._value;
                    } else if (scVal.value !== undefined) {
                      return scVal.value;
                    } else if (scVal._arm && scVal._value !== undefined) {
                      return scVal._value;
                    }

                    // Return as is if we can't extract
                    return scVal;
                  };

                  const val = extractValue(valScVal);
                  escrowDataMap[keyStr] = val;
                } catch (e) {
                  // Use the value as is if extraction fails
                  escrowDataMap[keyStr] = valScVal;
                }
              }
            }
          }
        }
      } else {
        // Try to convert using scValToNative
        try {
          if (escrowMap && escrowMap._switch) {
            const converted = scValToNative(escrowMap);
            if (converted && typeof converted === "object") {
              escrowDataMap = converted;
            }
          } else {
            // Already a native object
            escrowDataMap = escrowMap;
          }
        } catch (e) {
          // If conversion fails, try to use it as is
          if (escrowMap && typeof escrowMap === "object") {
            escrowDataMap = escrowMap;
          }
        }
      }

      // Extract fields from the map
      const getField = (key: string): any => {
        return escrowDataMap[key];
      };

      // Helper to convert ScVal to native value
      const getValue = (val: any): any => {
        if (!val) return undefined;
        // Check if it's an ScVal object
        if (val && typeof val === "object" && val._switch) {
          try {
            return scValToNative(val);
          } catch (e) {
            // If conversion fails, try to extract value directly
            if (val._value !== undefined) {
              return val._value;
            }
            return val;
          }
        }
        // Already a native value
        return val;
      };

      // Helper to convert i128 ScVal to BigInt string
      const getI128Value = (val: any): string => {
        if (!val) return "0";

        // If it's already a string or number, return it
        if (typeof val === "string") {
          return val;
        }
        if (typeof val === "number") {
          return val.toString();
        }
        if (typeof val === "bigint") {
          return val.toString();
        }

        // If it's an ScVal i128, extract hi and lo
        if (val && typeof val === "object") {
          // Try scValToNative first
          try {
            const converted = scValToNative(val);
            if (typeof converted === "bigint") {
              return converted.toString();
            }
            if (
              typeof converted === "string" ||
              typeof converted === "number"
            ) {
              return converted.toString();
            }
          } catch (e) {
            // Continue to manual extraction
          }

          // Manual extraction for i128 structure
          // i128 ScVal structure: { _switch: { name: "scvI128" }, _value: { _attributes: { hi: { _value: "0" }, lo: { _value: "10000000000" } } } }
          if (val._switch && val._switch.name === "scvI128" && val._value) {
            const i128Value = val._value;

            // Check if it has _attributes with hi and lo
            if (i128Value._attributes) {
              // Extract hi and lo values - they might be nested in _value
              const hiStr =
                i128Value._attributes.hi?._value ||
                i128Value._attributes.hi?.toString() ||
                (typeof i128Value._attributes.hi === "string"
                  ? i128Value._attributes.hi
                  : "0");
              const loStr =
                i128Value._attributes.lo?._value ||
                i128Value._attributes.lo?.toString() ||
                (typeof i128Value._attributes.lo === "string"
                  ? i128Value._attributes.lo
                  : "0");

              const hi = BigInt(hiStr);
              const lo = BigInt(loStr);
              // i128 = hi * 2^64 + lo
              const result = (hi << 64n) + lo;
              return result.toString();
            }

            // Alternative structure: direct hi and lo
            if (i128Value.hi !== undefined || i128Value.lo !== undefined) {
              const hiStr =
                i128Value.hi?._value ||
                i128Value.hi?.toString() ||
                (typeof i128Value.hi === "string" ? i128Value.hi : "0");
              const loStr =
                i128Value.lo?._value ||
                i128Value.lo?.toString() ||
                (typeof i128Value.lo === "string" ? i128Value.lo : "0");
              const hi = BigInt(hiStr);
              const lo = BigInt(loStr);
              const result = (hi << 64n) + lo;
              return result.toString();
            }
          }

          // Try to extract from _value directly
          if (val._value !== undefined) {
            if (
              typeof val._value === "object" &&
              (val._value.hi !== undefined || val._value.lo !== undefined)
            ) {
              const hiStr =
                val._value.hi?._value ||
                val._value.hi?.toString() ||
                (typeof val._value.hi === "string" ? val._value.hi : "0");
              const loStr =
                val._value.lo?._value ||
                val._value.lo?.toString() ||
                (typeof val._value.lo === "string" ? val._value.lo : "0");
              const hi = BigInt(hiStr);
              const lo = BigInt(loStr);
              const result = (hi << 64n) + lo;
              return result.toString();
            }
            if (typeof val._value === "object" && val._value._attributes) {
              // Try nested _attributes structure
              const hiStr =
                val._value._attributes.hi?._value ||
                val._value._attributes.hi?.toString() ||
                "0";
              const loStr =
                val._value._attributes.lo?._value ||
                val._value._attributes.lo?.toString() ||
                "0";
              const hi = BigInt(hiStr);
              const lo = BigInt(loStr);
              const result = (hi << 64n) + lo;
              return result.toString();
            }
            return val._value.toString();
          }
        }

        return "0";
      };

      // Helper to convert u32 ScVal to number
      const getU32Value = (val: any): number => {
        if (!val) return 0;

        // If it's already a number, return it
        if (typeof val === "number") {
          return val;
        }
        if (typeof val === "string") {
          return parseInt(val, 10) || 0;
        }
        if (typeof val === "bigint") {
          return Number(val);
        }

        // If it's an ScVal u32, extract value
        if (val && typeof val === "object") {
          // Try scValToNative first
          try {
            const converted = scValToNative(val);
            if (typeof converted === "number") {
              return converted;
            }
            if (typeof converted === "string") {
              return parseInt(converted, 10) || 0;
            }
            if (typeof converted === "bigint") {
              return Number(converted);
            }
          } catch (e) {
            // Continue to manual extraction
          }

          // Manual extraction for u32 structure
          // u32 ScVal has structure: { _switch: { name: "scvU32" }, _value: number }
          if (
            val._switch &&
            val._switch.name === "scvU32" &&
            val._value !== undefined
          ) {
            return Number(val._value) || 0;
          }

          // Try to extract from _value directly
          if (val._value !== undefined) {
            return Number(val._value) || 0;
          }
        }

        return 0;
      };

      // Extract all fields
      const depositor = getValue(getField("depositor"));
      const beneficiary = getValue(getField("beneficiary"));
      const status = getValue(getField("status"));
      const token = getValue(getField("token"));
      const totalAmount = getI128Value(getField("total_amount"));
      const paidAmount = getI128Value(getField("paid_amount"));
      const deadline = getU32Value(getField("deadline"));
      const createdAt = getU32Value(getField("created_at"));
      const projectTitle = getValue(getField("project_title"));
      const projectDescription = getValue(getField("project_description"));

      // Convert status enum to number
      let statusNumber = 0;
      if (status) {
        if (typeof status === "string") {
          // Status is an enum like "Pending", "Active", etc.
          switch (status.toLowerCase()) {
            case "pending":
              statusNumber = 0;
              break;
            case "inprogress":
            case "active":
              statusNumber = 1;
              break;
            case "released":
            case "completed":
              statusNumber = 2;
              break;
            case "disputed":
              statusNumber = 3;
              break;
            default:
              statusNumber = 0;
          }
        } else if (Array.isArray(status) && status.length > 0) {
          // Status might be an enum array
          const statusStr = status[0];
          if (typeof statusStr === "string") {
            switch (statusStr.toLowerCase()) {
              case "pending":
                statusNumber = 0;
                break;
              case "inprogress":
              case "active":
                statusNumber = 1;
                break;
              case "released":
              case "completed":
                statusNumber = 2;
                break;
              case "disputed":
                statusNumber = 3;
                break;
            }
          }
        } else if (
          status &&
          typeof status === "object" &&
          "variant" in status
        ) {
          // Status is an enum object with variant field
          const variant = (status as any).variant?.toLowerCase() || "";
          switch (variant) {
            case "pending":
              statusNumber = 0;
              break;
            case "inprogress":
              statusNumber = 1;
              break;
            case "released":
              statusNumber = 2;
              break;
            default:
              statusNumber = 0;
          }
        } else if (typeof status === "number") {
          statusNumber = status;
        }
      }

      // CRITICAL: Check if escrow actually exists
      // If the contract returns Option::None, the map will be empty or missing key fields
      // The depositor field is REQUIRED - if it doesn't exist, the escrow doesn't exist
      if (!depositor || depositor === "" || depositor === "0") {
        return null;
      }

      // Also check if escrowDataMap is empty (contract returned None)
      if (!escrowDataMap || Object.keys(escrowDataMap).length === 0) {
        return null;
      }

      // Check if the map represents Option::None (scvVoid or empty structure)
      if (
        escrowMap &&
        escrowMap._switch &&
        escrowMap._switch.name === "scvVoid"
      ) {
        return null;
      }

      // Debug logging disabled to reduce console noise
      // Uncomment for debugging:
      //
      return {
        escrow_id: escrowId,
        creator: depositor || "",
        freelancer: beneficiary || undefined,
        status: statusNumber,
        token: token || undefined,
        amount: totalAmount || "0", // Already a string from getI128Value
        paid_amount: paidAmount || "0", // Already a string from getI128Value
        deadline: deadline || 0,
        created_at: createdAt || 0,
        milestones: [],
        project_title: projectTitle || "",
        project_description: projectDescription || "",
      };
    } catch (error) {
      // If escrow doesn't exist or there's an error, return null instead of throwing
      // This allows getNextEscrowId to continue iterating
      return null;
    }
  }

  /**
   * Get milestones for an escrow
   */
  async getMilestones(escrowId: number): Promise<any[]> {
    try {
      const contract = new Contract(this.contractId);
      const sourceAddress =
        useWalletStore.getState().address ||
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

      const sourceAccount = {
        accountId: () => sourceAddress,
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {},
      } as any;

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "get_milestones",
            nativeToScVal(escrowId, { type: "u32" })
          )
        )
        .setTimeout(30)
        .build();

      const simulation = await this.rpcServer.simulateTransaction(tx);

      // Check for errors first
      if ("errorResult" in simulation && simulation.errorResult) {
        const errorValue =
          (simulation.errorResult as any).value?.() || simulation.errorResult;
        return [];
      }

      // Get the return value from simulation
      let returnValue: any = null;
      if ("returnValue" in simulation && simulation.returnValue) {
        returnValue = simulation.returnValue;
      } else if ("result" in simulation && (simulation as any).result) {
        const result = (simulation as any).result;
        if (result.retval) {
          returnValue = result.retval;
        } else {
          returnValue = result;
        }
      }

      if (returnValue) {
        try {
          const result = scValToNative(returnValue as xdr.ScVal);
          if (Array.isArray(result)) {
            return result.map((m: any) => ({
              description: m.description || m[0] || "",
              requirements: m.requirements || "",
              amount: m.amount || m[1] || "0",
              status: m.status || m[2] || 0,
              submitted_at: m.submitted_at || m[3] || 0,
              approved_at: m.approved_at || m[4] || 0,
              disputed_at: m.disputed_at || m[5] || 0,
              disputed_by: m.disputed_by || m[6] || undefined,
              dispute_reason: m.dispute_reason || m[7] || undefined,
              rejection_reason: m.rejection_reason || m[8] || undefined,
              resolved_at: m.resolved_at || 0,
              resolved_by: m.resolved_by || undefined,
              resolution_freelancer_amount: m.resolution_freelancer_amount?.toString() || "0",
              resolution_client_amount: m.resolution_client_amount?.toString() || "0",
              resolution_reason: m.resolution_reason || undefined,
            }));
          }
        } catch (e) {
        }
      }

      return [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Check if a user has applied to a job by reading applications from storage
   */
  async hasUserApplied(
    escrowId: number,
    userAddress: string
  ): Promise<boolean> {
    try {

      // Try using the contract's has_applied function first
      try {
        const contract = new Contract(this.contractId);
        const sourceAddress =
          useWalletStore.getState().address ||
          "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

        const sourceAccount = {
          accountId: () => sourceAddress,
          sequenceNumber: () => "0",
          incrementSequenceNumber: () => {},
        } as any;

        const tx = new TransactionBuilder(sourceAccount, {
          fee: "100",
          networkPassphrase: this.network.networkPassphrase,
        })
          .addOperation(
            contract.call(
              "has_applied",
              nativeToScVal(escrowId, { type: "u32" }),
              nativeToScVal(userAddress, { type: "address" })
            )
          )
          .setTimeout(30)
          .build();

        const simulation = await this.rpcServer.simulateTransaction(tx);

        // Check for errors first
        if ("errorResult" in simulation && simulation.errorResult) {
          const errorValue =
            (simulation.errorResult as any).value?.() || simulation.errorResult;
          throw new Error(`Simulation error: ${errorValue}`);
        }

        // Check multiple possible locations for the return value
        let returnValue: any = null;

        // Check result.retval (most common location)
        if ((simulation as any).result?.retval) {
          returnValue = (simulation as any).result.retval;
        }
        // Check transactionData.result.retval
        else if ((simulation as any).transactionData?.result?.retval) {
          returnValue = (simulation as any).transactionData.result.retval;
        }
        // Check returnValue directly
        else if ("returnValue" in simulation && simulation.returnValue) {
          returnValue = simulation.returnValue;
        }
        // Check result directly
        else if ((simulation as any).result) {
          returnValue = (simulation as any).result;
        }

        if (returnValue) {
          try {
            const result = scValToNative(returnValue as xdr.ScVal);
            const hasApplied = Boolean(result);
            return hasApplied;
          } catch (e) {
          }
        } else {
        }
      } catch (contractError) {
      }

      // Fallback: Use getApplications to get all applications and check if user is in the list
      const applications = await this.getApplications(escrowId);

      const hasApplied = applications.some(
        (app) =>
          app.freelancer &&
          app.freelancer.toLowerCase().trim() ===
            userAddress.toLowerCase().trim()
      );

      return hasApplied;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get badge for a freelancer
   */
  async getBadge(
    freelancerAddress: string
  ): Promise<"Beginner" | "Intermediate" | "Advanced" | "Expert"> {
    try {
      const contract = new Contract(this.contractId);
      const sourceAddress =
        useWalletStore.getState().address ||
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

      const sourceAccount = {
        accountId: () => sourceAddress,
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {},
      } as any;

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "get_badge",
            nativeToScVal(freelancerAddress, { type: "address" })
          )
        )
        .setTimeout(30)
        .build();

      const simulation = await this.rpcServer.simulateTransaction(tx);

      if ("errorResult" in simulation && simulation.errorResult) {
        return "Beginner"; // Default
      }

      if ("result" in simulation && simulation.result) {
        const retval = (simulation.result as any).retval;
        if (retval) {
          const badge = scValToNative(retval as xdr.ScVal);
          const badgeMap: Record<
            number,
            "Beginner" | "Intermediate" | "Advanced" | "Expert"
          > = {
            0: "Beginner",
            1: "Intermediate",
            2: "Advanced",
            3: "Expert",
          };
          return badgeMap[badge as number] || "Beginner";
        }
      }

      return "Beginner";
    } catch (error) {
      return "Beginner";
    }
  }

  /**
   * Get average rating for a freelancer
   */
  async getAverageRating(
    freelancerAddress: string
  ): Promise<{ average: number; count: number }> {
    try {
      const contract = new Contract(this.contractId);
      const sourceAddress =
        useWalletStore.getState().address ||
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

      const sourceAccount = {
        accountId: () => sourceAddress,
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {},
      } as any;

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "get_average_rating",
            nativeToScVal(freelancerAddress, { type: "address" })
          )
        )
        .setTimeout(30)
        .build();

      const simulation = await this.rpcServer.simulateTransaction(tx);

      if ("errorResult" in simulation && simulation.errorResult) {
        return { average: 0, count: 0 };
      }

      if ("result" in simulation && simulation.result) {
        const retval = (simulation.result as any).retval;
        if (retval) {
          const result = scValToNative(retval as xdr.ScVal) as [number, number];
          const [total, count] = result;
          return {
            average: count > 0 ? total / count : 0,
            count,
          };
        }
      }

      return { average: 0, count: 0 };
    } catch (error) {
      return { average: 0, count: 0 };
    }
  }

  /**
   * Submit a rating for a completed escrow
   */
  async submitRating(
    escrowId: number,
    rating: number,
    review: string,
    walletAddress?: string
  ): Promise<string> {
    try {
      // Use provided wallet address, or fallback to store
      let address = walletAddress;
      if (!address) {
        const walletState = useWalletStore.getState();
        address = walletState.address;
      }

      if (!address) {
        // Check localStorage for walletId as fallback
        const walletId =
          typeof window !== "undefined"
            ? localStorage.getItem("walletId")
            : null;
        if (!walletId) {
          throw new Error(
            "Wallet not connected. Please connect your wallet first."
          );
        }
        // If we have walletId but no address, try to get it from the wallet store
        // This is a fallback - ideally the address should be passed in
        throw new Error(
          "Wallet address not found. Please reconnect your wallet."
        );
      }

      const { Contract, nativeToScVal, TransactionBuilder, Operation, xdr } =
        await import("@stellar/stellar-sdk");
      const { signTransaction, signAuthEntries } = await import(
        "./wallet-signer"
      );

      const contract = new Contract(this.contractId);
      const sourceAccount = await this.rpcServer.getAccount(address);

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "submit_rating",
            nativeToScVal(escrowId, { type: "u32" }),
            nativeToScVal(rating, { type: "u32" }),
            nativeToScVal(review, { type: "string" }),
            nativeToScVal(address, { type: "address" })
          )
        )
        .setTimeout(30)
        .build();

      const simulation = await this.rpcServer.simulateTransaction(tx);

      const authEntries =
        "auth" in simulation && simulation.auth
          ? Array.isArray(simulation.auth)
            ? simulation.auth
            : []
          : [];

      if ("errorResult" in simulation && simulation.errorResult) {
        const errorValue =
          (simulation.errorResult as any).value?.() || simulation.errorResult;
        throw new Error(
          `Transaction simulation failed: ${errorValue.toString()}`
        );
      }

      const prepared = await this.rpcServer.prepareTransaction(tx);

      let signedTxXdr: string;

      if (authEntries && authEntries.length > 0) {
        const signedAuthEntries = await signAuthEntries(
          authEntries as any[],
          address
        );

        const parsedSignedAuth = signedAuthEntries.map((signed: string) =>
          xdr.SorobanAuthorizationEntry.fromXDR(signed, "base64")
        );

        const operations = prepared.operations;
        if (operations && operations.length > 0) {
          const op = operations[0];
          if (op.type === "invokeHostFunction") {
            const invokeOp = op as any;
            const hostFn = invokeOp.function || invokeOp.hostFunction;
            const newOp = Operation.invokeHostFunction({
              function: hostFn as xdr.HostFunction,
              auth: parsedSignedAuth,
            } as any);

            const freshAccount = await this.rpcServer.getAccount(address);
            const newTx = new TransactionBuilder(freshAccount, {
              fee: prepared.fee,
              networkPassphrase: this.network.networkPassphrase,
            })
              .addOperation(newOp)
              .setTimeout(30)
              .build();

            const newPrepared = await this.rpcServer.prepareTransaction(newTx);
            signedTxXdr = await signTransaction({
              unsignedTransaction: newPrepared.toXDR(),
              address: address,
            });
          } else {
            throw new Error("Expected invokeHostFunction operation");
          }
        } else {
          throw new Error("No operations found in prepared transaction");
        }
      } else {
        signedTxXdr = await signTransaction({
          unsignedTransaction: prepared.toXDR(),
          address: address,
        });
      }

      const signedTransaction = TransactionBuilder.fromXDR(
        signedTxXdr,
        this.network.networkPassphrase
      );

      const sendResponse =
        await this.rpcServer.sendTransaction(signedTransaction);

      if (sendResponse.status === "ERROR") {
        throw new Error("Transaction failed");
      }

      if (sendResponse.status === "PENDING" && sendResponse.hash) {
        return await this.waitForConfirmation(sendResponse.hash);
      }

      return sendResponse.hash || "";
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Get rating for an escrow
   */
  async getRating(escrowId: number): Promise<{
    escrowId: number;
    freelancer: string;
    client: string;
    rating: number;
    review: string;
    ratedAt: number;
  } | null> {
    try {
      const contract = new Contract(this.contractId);
      const sourceAddress =
        useWalletStore.getState().address ||
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

      const sourceAccount = {
        accountId: () => sourceAddress,
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {},
      } as any;

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call("get_rating", nativeToScVal(escrowId, { type: "u32" }))
        )
        .setTimeout(30)
        .build();

      const simulation = await this.rpcServer.simulateTransaction(tx);

      if ("errorResult" in simulation && simulation.errorResult) {
        return null;
      }

      if ("result" in simulation && simulation.result) {
        const retval = (simulation.result as any).retval;
        if (retval) {
          const rating = scValToNative(retval as xdr.ScVal) as any;
          if (!rating || rating === null) {
            return null;
          }
          return {
            escrowId: rating.escrow_id || rating.escrowId || escrowId,
            freelancer: rating.freelancer || "",
            client: rating.client || "",
            rating: rating.rating || 0,
            review: rating.review || "",
            ratedAt: rating.rated_at || rating.ratedAt || 0,
          };
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /** Submit a rating for the client (called by freelancer after completion) */
  async submitClientRating(params: {
    escrow_id: number;
    rating: number;
    review: string;
    freelancer: string;
  }): Promise<string> {
    return this.sendOwnerTransaction(
      "submit_client_rating",
      [
        nativeToScVal(params.escrow_id, { type: "u32" }),
        nativeToScVal(params.rating, { type: "u32" }),
        nativeToScVal(params.review, { type: "string" }),
        nativeToScVal(params.freelancer, { type: "address" }),
      ],
      params.freelancer
    );
  }

  /** Get client rating for an escrow (set by freelancer) */
  async getClientRating(escrowId: number): Promise<{
    escrowId: number;
    client: string;
    freelancer: string;
    rating: number;
    review: string;
    ratedAt: number;
  } | null> {
    try {
      const contract = new Contract(this.contractId);
      const sourceAddress =
        useWalletStore.getState().address ||
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
      const sourceAccount = {
        accountId: () => sourceAddress,
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {},
      } as any;
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call("get_client_rating", nativeToScVal(escrowId, { type: "u32" }))
        )
        .setTimeout(30)
        .build();
      const simulation = await this.rpcServer.simulateTransaction(tx);
      if ("errorResult" in simulation && simulation.errorResult) return null;
      const retval = ("result" in simulation && (simulation.result as any)?.retval)
        || ("returnValue" in simulation && simulation.returnValue);
      if (!retval) return null;
      const r = scValToNative(retval as xdr.ScVal) as any;
      if (!r) return null;
      return {
        escrowId: r.escrow_id ?? escrowId,
        client: r.client ?? "",
        freelancer: r.freelancer ?? "",
        rating: r.rating ?? 0,
        review: r.review ?? "",
        ratedAt: r.rated_at ?? 0,
      };
    } catch { return null; }
  }

  /** Get average client rating → { average, count } */
  async getAverageClientRating(clientAddress: string): Promise<{ average: number; count: number }> {
    try {
      const contract = new Contract(this.contractId);
      const sourceAddress =
        useWalletStore.getState().address ||
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
      const sourceAccount = {
        accountId: () => sourceAddress,
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {},
      } as any;
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "get_average_client_rating",
            nativeToScVal(clientAddress, { type: "address" })
          )
        )
        .setTimeout(30)
        .build();
      const simulation = await this.rpcServer.simulateTransaction(tx);
      if ("errorResult" in simulation && simulation.errorResult) return { average: 0, count: 0 };
      const retval = ("result" in simulation && (simulation.result as any)?.retval)
        || ("returnValue" in simulation && simulation.returnValue);
      if (!retval) return { average: 0, count: 0 };
      const tuple = scValToNative(retval as xdr.ScVal) as any;
      if (!tuple) return { average: 0, count: 0 };
      const total = Number(Array.isArray(tuple) ? tuple[0] : tuple[0] ?? 0);
      const count = Number(Array.isArray(tuple) ? tuple[1] : tuple[1] ?? 0);
      return { average: count > 0 ? Math.round((total / count) * 10) / 10 : 0, count };
    } catch { return { average: 0, count: 0 }; }
  }

  /**
   * Get all applications for a job by reading from storage
   * Now includes badge and rating information
   */
  async getApplications(escrowId: number): Promise<
    Array<{
      freelancer: string;
      cover_letter: string;
      proposed_timeline: number;
      applied_at: number;
      badge?: "Beginner" | "Intermediate" | "Advanced" | "Expert";
      averageRating?: number;
      ratingCount?: number;
    }>
  > {
    try {
      // Use manual simulation (get_applications is not in generated client)
      try {
        const contract = new Contract(this.contractId);
        const sourceAddress =
          useWalletStore.getState().address ||
          "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

        const sourceAccount = {
          accountId: () => sourceAddress,
          sequenceNumber: () => "0",
          incrementSequenceNumber: () => {},
        } as any;

        const tx = new TransactionBuilder(sourceAccount, {
          fee: "100",
          networkPassphrase: this.network.networkPassphrase,
        })
          .addOperation(
            contract.call(
              "get_applications",
              nativeToScVal(escrowId, { type: "u32" })
            )
          )
          .setTimeout(30)
          .build();

        const simulation = await this.rpcServer.simulateTransaction(tx);

        // Check for errors first
        if ("errorResult" in simulation && simulation.errorResult) {
          const errorValue =
            (simulation.errorResult as any).value?.() || simulation.errorResult;
          throw new Error(`Simulation error: ${errorValue}`);
        }

        // Check multiple possible locations for the return value
        let returnValue: any = null;

        // Check result.retval (most common location)
        if ((simulation as any).result?.retval) {
          returnValue = (simulation as any).result.retval;
        }
        // Check transactionData.result.retval
        else if ((simulation as any).transactionData?.result?.retval) {
          returnValue = (simulation as any).transactionData.result.retval;
        }
        // Check returnValue directly
        else if ("returnValue" in simulation && simulation.returnValue) {
          returnValue = simulation.returnValue;
        }
        // Check result directly
        else if ((simulation as any).result) {
          returnValue = (simulation as any).result;
        }

        if (returnValue) {
          try {
            const result = scValToNative(returnValue as xdr.ScVal);

            if (Array.isArray(result)) {
              const applications = result.map((app: any) => ({
                freelancer: String(app.freelancer || app[0] || ""),
                cover_letter: String(
                  app.cover_letter || app.coverLetter || app[1] || ""
                ),
                proposed_timeline: Number(
                  app.proposed_timeline || app.proposedTimeline || app[2] || 0
                ),
                applied_at: Number(
                  app.applied_at || app.appliedAt || app[3] || 0
                ),
              }));
              return applications;
            } else {
            }
          } catch (e) {
          }
        } else {
          // Log the simulation structure to debug (but don't stringify - might have circular refs)
          // Check if result exists but in a different structure
          if ((simulation as any).result) {
            const result = (simulation as any).result;
            // Try to extract from result.retval
            if (result && result.retval) {
              try {
                const retval = result.retval;
                const parsed = scValToNative(retval as xdr.ScVal);
                if (Array.isArray(parsed)) {
                  // Fetch badge and rating for each freelancer
                  const applicationsWithMetadata = await Promise.all(
                    parsed.map(async (app: any) => {
                      const freelancerAddress = String(
                        app.freelancer || app[0] || ""
                      );
                      const [badge, ratingInfo] = await Promise.all([
                        this.getBadge(freelancerAddress),
                        this.getAverageRating(freelancerAddress),
                      ]);

                      return {
                        freelancer: freelancerAddress,
                        cover_letter: String(
                          app.cover_letter || app.coverLetter || app[1] || ""
                        ),
                        proposed_timeline: Number(
                          app.proposed_timeline ||
                            app.proposedTimeline ||
                            app[2] ||
                            0
                        ),
                        applied_at: Number(
                          app.applied_at || app.appliedAt || app[3] || 0
                        ),
                        badge,
                        averageRating: ratingInfo.average,
                        ratingCount: ratingInfo.count,
                      };
                    })
                  );

                  return applicationsWithMetadata;
                }
              } catch (e) {
              }
            }
          }
          if ((simulation as any).transactionData) {
            const txData = (simulation as any).transactionData;
            if (txData && txData.result && txData.result.retval) {
              try {
                const retval = txData.result.retval;
                const parsed = scValToNative(retval as xdr.ScVal);
                if (Array.isArray(parsed)) {
                  const applications = parsed.map((app: any) => ({
                    freelancer: String(app.freelancer || app[0] || ""),
                    cover_letter: String(
                      app.cover_letter || app.coverLetter || app[1] || ""
                    ),
                    proposed_timeline: Number(
                      app.proposed_timeline ||
                        app.proposedTimeline ||
                        app[2] ||
                        0
                    ),
                    applied_at: Number(
                      app.applied_at || app.appliedAt || app[3] || 0
                    ),
                  }));
                  return applications;
                }
              } catch (e) {
              }
            }
          }
        }
      } catch (contractError) {
      }

      // Fallback: Read from storage directly
      const applications: Array<{
        freelancer: string;
        cover_letter: string;
        proposed_timeline: number;
        applied_at: number;
      }> = [];

      // Applications are stored with key DataKey::Application(escrow_id, application_index)
      // We need to check each application index until we hit a non-existent application (max 50 applications per job)
      const maxApplications = 50;

      for (let appIndex = 0; appIndex < maxApplications; appIndex++) {
        try {
          // Build the DataKey for this application
          // DataKey::Application(u32, u32) - enum variant
          // Soroban enum variants with tuple values are encoded as a vector: [symbol, ...values]
          // Use manual vector encoding (more reliable than nativeToScVal for enum variants)
          const applicationKey = xdr.ScVal.scvVec([
            nativeToScVal("Application", { type: "symbol" }),
            nativeToScVal(escrowId, { type: "u32" }),
            nativeToScVal(appIndex, { type: "u32" }),
          ]);

          // Read from contract storage
          // Applications are stored in INSTANCE storage
          // Instance storage uses persistent() durability when reading via getLedgerEntries
          const ledgerKey = xdr.LedgerKey.contractData(
            new xdr.LedgerKeyContractData({
              contract: Address.fromString(this.contractId).toScAddress(),
              key: applicationKey,
              durability: xdr.ContractDataDurability.persistent(),
            })
          );

          const entry = await this.rpcServer.getLedgerEntries(ledgerKey);

          if (entry && entry.entries && entry.entries.length > 0) {
            const entryData = entry.entries[0];
            if (entryData.val) {
              const val = entryData.val;
              if (val && val.contractData) {
                const valScVal = val.contractData().val();

                // Convert ScVal to native
                let applicationData: any;
                try {
                  applicationData = scValToNative(valScVal);
                } catch (e) {
                  // If conversion fails, try to extract manually
                  if (valScVal && typeof valScVal === "object") {
                    applicationData = valScVal;
                  } else {
                    continue;
                  }
                }

                // Extract application fields
                // Application structure: { freelancer: Address, cover_letter: String, proposed_timeline: u32, applied_at: u32 }
                let freelancerAddress = "";
                let coverLetter = "";
                let proposedTimeline = 0;
                let appliedAt = 0;

                if (applicationData && typeof applicationData === "object") {
                  // Try different ways to extract the data
                  if (applicationData.freelancer) {
                    freelancerAddress = String(applicationData.freelancer);
                    coverLetter = String(
                      applicationData.cover_letter ||
                        applicationData.coverLetter ||
                        ""
                    );
                    proposedTimeline = Number(
                      applicationData.proposed_timeline ||
                        applicationData.proposedTimeline ||
                        0
                    );
                    appliedAt = Number(
                      applicationData.applied_at ||
                        applicationData.appliedAt ||
                        0
                    );
                  } else if (
                    Array.isArray(applicationData) &&
                    applicationData.length >= 4
                  ) {
                    freelancerAddress = String(applicationData[0] || "");
                    coverLetter = String(applicationData[1] || "");
                    proposedTimeline = Number(applicationData[2] || 0);
                    appliedAt = Number(applicationData[3] || 0);
                  } else if (applicationData[0]) {
                    freelancerAddress = String(applicationData[0] || "");
                    coverLetter = String(applicationData[1] || "");
                    proposedTimeline = Number(applicationData[2] || 0);
                    appliedAt = Number(applicationData[3] || 0);
                  }
                }

                if (freelancerAddress) {
                  applications.push({
                    freelancer: freelancerAddress,
                    cover_letter: coverLetter,
                    proposed_timeline: proposedTimeline,
                    applied_at: appliedAt,
                  });
                }
              }
            }
          } else {
            // No more applications found, stop searching
            break;
          }
        } catch (error) {
          // Application doesn't exist at this index, stop searching
          break;
        }
      }

      return applications;
    } catch (error) {
      return [];
    }
  }

  async getNextEscrowId(): Promise<number> {
    try {

      // WORKAROUND: Since NextEscrowId is in instance storage and hard to read directly,
      // we'll count escrows by checking each ID until we find one that doesn't exist
      // This is the most reliable way to get the count from the blockchain

      let maxId = 0;
      const maxChecks = 50; // Increased limit to handle more escrows

      // Optimized approach: Use binary search to find the highest existing escrow ID
      // This is much faster than checking sequentially
      let lowerBound = 1;
      let upperBound = maxChecks;

      // Binary search to find the highest existing escrow
      while (lowerBound <= upperBound) {
        const mid = Math.floor((lowerBound + upperBound) / 2);
        try {
          const escrow = await this.getEscrow(mid);
          if (escrow) {
            maxId = Math.max(maxId, mid);
            lowerBound = mid + 1; // Check higher IDs
          } else {
            // Escrow doesn't exist, check lower IDs
            upperBound = mid - 1;
          }
        } catch (error) {
          // Error reading escrow, assume it doesn't exist
          upperBound = mid - 1;
        }
      }

      // Verify by checking sequentially from maxId down to 1 to catch any gaps
      if (maxId > 0) {
        for (let id = maxId; id >= 1; id--) {
          try {
            const escrow = await this.getEscrow(id);
            if (escrow) {
              maxId = id; // Found the highest existing escrow
              break;
            }
          } catch (error) {
            // Continue checking lower IDs
            continue;
          }
        }
      }

      // NextEscrowId = maxId + 1 (the next available ID)
      const nextId = maxId + 1;
      const actualCount = maxId;

      return nextId;
    } catch (error) {
      // Return a default value if there's an error
      return 1;
    }
  }

  async getUserEscrows(userAddress: string): Promise<number[]> {
    try {
      const result = await this.client.get_user_escrows({ user: userAddress });
      return result.result as number[];
    } catch (error) {
      throw error;
    }
  }

  async getReputation(userAddress: string): Promise<number> {
    try {
      const contract = new Contract(this.contractId);
      const sourceAddress =
        useWalletStore.getState().address ||
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
      const sourceAccount = {
        accountId: () => sourceAddress,
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {},
      } as any;

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "get_reputation",
            nativeToScVal(userAddress, { type: "address" })
          )
        )
        .setTimeout(30)
        .build();

      const simulation = await this.rpcServer.simulateTransaction(tx);

      if ("errorResult" in simulation && simulation.errorResult) {
        return 0;
      }

      if ("result" in simulation && simulation.result) {
        const retval = (simulation.result as any).retval;
        if (retval) {
          const value = scValToNative(retval as xdr.ScVal);
          return Number(value) || 0;
        }
      }
      // Also handle returnValue path
      if ("returnValue" in simulation && simulation.returnValue) {
        const value = scValToNative(simulation.returnValue as xdr.ScVal);
        return Number(value) || 0;
      }
      return 0;
    } catch (error) {
      return 0;
    }
  }

  async isJobCreationPaused(_address?: string): Promise<boolean> {
    this.syncFromConfig();
    const health = await this.probeEscrowContractHealth();
    if (!health.ok) {
      return false;
    }
    return health.jobCreationPaused;
  }

  /**
   * Returns whether the configured escrow contract responds on the current RPC.
   * Use this instead of swallowing errors in isJobCreationPaused when driving UX.
   */
  async probeEscrowContractHealth(): Promise<EscrowContractHealth> {
    this.syncFromConfig();
    if (!this.contractId?.trim()) {
      return {
        ok: false,
        userMessage:
          "No escrow contract ID is configured. Set VITE_SECUREFLOW_CONTRACT_ID in .env to the Contract ID from deploy, then run initialize once and rebuild.",
      };
    }

    const misconfiguredMessage =
      "The Soroban escrow contract is not usable on this network (missing ledger entry, uninitialized storage, or wrong contract ID). " +
      "Redeploy the WASM, invoke initialize(owner, fee_collector, platform_fee_bp) once, set VITE_SECUREFLOW_CONTRACT_ID to the new ID, and rebuild. " +
      "Soroban testnet resets remove older deployments.";

    try {
      this.assertValidContractId();
      const assembledTx = await this.client.is_job_creation_paused({
        simulate: true,
      });

      if (assembledTx.result !== undefined) {
        return { ok: true, jobCreationPaused: assembledTx.result as boolean };
      }

      const simData = assembledTx.simulationData as Record<string, unknown> | undefined;
      if (simData) {
        if (typeof simData.error === "string" && simData.error.length > 0) {
          return {
            ok: false,
            userMessage: this.mapHealthRpcMessage(
              simData.error,
              misconfiguredMessage
            ),
          };
        }
        if ("returnValue" in simData && simData.returnValue) {
          const paused = scValToNative(simData.returnValue as xdr.ScVal) as boolean;
          return { ok: true, jobCreationPaused: paused };
        }
      }

      const serialized = JSON.stringify(assembledTx);
      if (serialized.includes("MissingValue")) {
        return { ok: false, userMessage: misconfiguredMessage };
      }

      return { ok: true, jobCreationPaused: false };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        userMessage: this.mapHealthRpcMessage(msg, misconfiguredMessage),
      };
    }
  }

  private mapHealthRpcMessage(
    raw: string,
    misconfiguredMessage: string
  ): string {
    const m = raw.toLowerCase();
    if (
      m.includes("missingvalue") ||
      m.includes("not found") ||
      m.includes("non-existing value") ||
      m.includes("not initialized") ||
      m.includes("owner not found")
    ) {
      return misconfiguredMessage;
    }
    return `Cannot reach the escrow contract: ${raw}`;
  }

  async getOwner(): Promise<string> {
    try {
      this.syncFromConfig();
      this.assertValidContractId();
      // Call the contract's get_owner function via simulation
      const contract = new Contract(this.contractId);

      // Use a dummy account for simulation
      const sourceAddress =
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
      const sourceAccount = {
        accountId: () => sourceAddress,
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {},
      } as any;

      // Build transaction for simulation
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(contract.call("get_owner"))
        .setTimeout(30)
        .build();

      // Simulate to get the result
      const simulation = await this.rpcServer.simulateTransaction(tx);

      // Check for errors
      if ("errorResult" in simulation && simulation.errorResult) {
        const errorValue =
          (simulation.errorResult as any).value?.() || simulation.errorResult;
        throw new Error(`Contract get_owner failed: ${errorValue.toString()}`);
      }

      // Get the return value from simulation
      // The result is in simulation.result.retval (ScVal instance)
      let ownerAddress: any = null;
      let retval: xdr.ScVal | null = null;

      // Check result.retval first (simulation result structure)
      if ("result" in simulation && (simulation as any).result) {
        const result = (simulation as any).result;
        if (result.retval) {
          retval = result.retval;
        }
      } else if ("returnValue" in simulation && simulation.returnValue) {
        retval = simulation.returnValue as xdr.ScVal;
      }

      if (!retval) {
        throw new Error("Owner not found - contract may not be initialized");
      }

      // Convert ScVal to native format
      // scValToNative should handle Address ScVal conversion automatically
      try {
        ownerAddress = scValToNative(retval);

        // If ownerAddress is an Address object, convert to string
        if (ownerAddress && typeof ownerAddress === "object") {
          // Check if it's an Address instance from Stellar SDK
          const { Address } = await import("@stellar/stellar-sdk");
          if (ownerAddress instanceof Address) {
            ownerAddress = ownerAddress.toString();
          } else if (
            "toString" in ownerAddress &&
            typeof ownerAddress.toString === "function"
          ) {
            ownerAddress = ownerAddress.toString();
          } else if ("address" in ownerAddress) {
            ownerAddress = ownerAddress.address;
          }
        }
      } catch (e: any) {
        // If scValToNative fails, try manual extraction
        try {
          if (retval && typeof retval === "object" && "switch" in retval) {
            const scValType = retval.switch();
            if (scValType === xdr.ScValType.scvAddress()) {
              const addressObj = (retval as any).address();
              if (
                addressObj &&
                addressObj.switch() === xdr.ScAddressType.scAddressTypeAccount()
              ) {
                const accountId = addressObj.accountId();
                const pubKey = accountId.ed25519();
                const { Keypair } = await import("@stellar/stellar-sdk");
                ownerAddress = Keypair.fromPublicKey(
                  pubKey.toString("hex")
                ).publicKey();
              }
            }
          }
        } catch (e2: any) {
          throw new Error(
            `Failed to extract owner from contract result: ${e.message || e}`
          );
        }
      }

      if (!ownerAddress) {
        throw new Error("Owner not found - contract may not be initialized");
      }

      // Ensure ownerAddress is a string
      return String(ownerAddress);
    } catch (error) {
      throw error;
    }
  }

  private async simulateReadonly(method: string, args: any[] = []): Promise<xdr.ScVal> {
    this.syncFromConfig();
    this.assertValidContractId();
    const contract = new Contract(this.contractId);
    const sourceAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const sourceAccount = {
      accountId: () => sourceAddress,
      sequenceNumber: () => "0",
      incrementSequenceNumber: () => {},
    } as any;

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: this.network.networkPassphrase,
    })
      .addOperation((contract as any).call(method, ...args))
      .setTimeout(30)
      .build();

    const simulation = await this.rpcServer.simulateTransaction(tx);
    if ("errorResult" in simulation && (simulation as any).errorResult) {
      const errorValue =
        (simulation as any).errorResult?.value?.() || (simulation as any).errorResult;
      throw new Error(`Contract ${method} failed: ${errorValue.toString()}`);
    }

    let retval: xdr.ScVal | null = null;
    if ("result" in simulation && (simulation as any).result?.retval) {
      retval = (simulation as any).result.retval as xdr.ScVal;
    } else if ("returnValue" in simulation && (simulation as any).returnValue) {
      retval = (simulation as any).returnValue as xdr.ScVal;
    }
    if (!retval) throw new Error(`No return value from ${method}`);
    return retval;
  }

  async getPlatformFeeBP(): Promise<number> {
    const rv = await this.simulateReadonly("get_platform_fee_bp");
    const native = scValToNative(rv) as any;
    return Number(native ?? 0);
  }

  async getFeeCollector(): Promise<string> {
    const rv = await this.simulateReadonly("get_fee_collector");
    return String(scValToNative(rv));
  }

  async getTotalEscrows(): Promise<number> {
    try {
      const rv = await this.simulateReadonly("get_total_escrows");
      const native = scValToNative(rv) as any;
      return Number(native ?? 0);
    } catch {
      // Backward compatibility for older deployments: infer from next_escrow_id
      const next = await this.getNextEscrowId();
      return Math.max(0, Number(next) - 1);
    }
  }

  async getWhitelistedTokens(): Promise<string[]> {
    const rv = await this.simulateReadonly("get_whitelisted_tokens");
    const native = scValToNative(rv) as any;
    if (!Array.isArray(native)) return [];
    return native.map((a) => String(a));
  }

  async getAuthorizedArbiters(): Promise<string[]> {
    const rv = await this.simulateReadonly("get_authorized_arbiters");
    const native = scValToNative(rv) as any;
    if (!Array.isArray(native)) return [];
    return native.map((a) => String(a));
  }

  async getOverdueRequest(
    escrowId: number,
  ): Promise<{ requester: string; reason: string; requested_at: number } | null> {
    try {
      const rv = await this.simulateReadonly("get_overdue_request", [
        nativeToScVal(escrowId, { type: "u32" }),
      ]);
      const native = scValToNative(rv) as any;
      if (!native) return null;
      return {
        requester: String(native.requester ?? ""),
        reason: String(native.reason ?? ""),
        requested_at: Number(native.requested_at ?? 0),
      };
    } catch {
      return null;
    }
  }

  /**
   * Write operations - build, sign, and send transactions
   */
  async createEscrow(params: CreateEscrowParams): Promise<number> {
    // Use the depositor from params, or fall back to store if not provided
    const walletAddress = params.depositor || useWalletStore.getState().address;
    if (!walletAddress) {
      throw new Error("Wallet not connected");
    }

    try {
      // Convert milestones to tuples [i128, string]
      // The contract expects i128 (bigint) for amounts, so we need to convert strings to bigint
      const milestones: Array<[bigint, string]> = params.milestones.map(
        ([amount, description]) => [BigInt(amount), description]
      );

      // Build transaction manually with depositor as source account
      // This ensures the transaction is built with the correct source account
      const contract = new Contract(this.contractId);
      const sourceAccount = await this.rpcServer.getAccount(walletAddress);

      // Convert parameters to ScVal format
      const depositorScVal = nativeToScVal(walletAddress, { type: "address" });
      const beneficiaryScVal = params.beneficiary
        ? nativeToScVal(params.beneficiary, { type: "address" })
        : xdr.ScVal.scvVoid();

      // Convert arbiters array to ScVal vector
      const arbitersScVals = params.arbiters.map((arbiter) =>
        nativeToScVal(arbiter, { type: "address" })
      );
      const arbitersScVal = xdr.ScVal.scvVec(arbitersScVals);

      const requiredConfirmationsScVal = nativeToScVal(
        params.required_confirmations,
        { type: "u32" }
      );

      // lib.rs ABI: milestones: Vec<(i128, String)> — each milestone is a tuple serialised as scvVec([i128, String])
      const milestonesScVal = xdr.ScVal.scvVec(
        milestones.map(([amount, description]) =>
          xdr.ScVal.scvVec([
            nativeToScVal(amount, { type: "i128" }),
            nativeToScVal(description, { type: "string" }),
          ])
        )
      );

      const tokenScVal = params.token
        ? nativeToScVal(params.token, { type: "address" })
        : xdr.ScVal.scvVoid();
      const totalAmountScVal = nativeToScVal(BigInt(params.total_amount), {
        type: "i128",
      });
      const durationScVal = nativeToScVal(params.duration, { type: "u32" });
      const projectTitleScVal = nativeToScVal(params.project_title, {
        type: "string",
      });
      const projectDescriptionScVal = nativeToScVal(
        params.project_description,
        { type: "string" }
      );

      // Build transaction with depositor as source account
      const txBuilder = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      });

      // Note: Token transfer is now handled by the contract itself
      // The contract's create_escrow function will transfer tokens (including native XLM) from the depositor
      // No need to add a separate SAC transfer operation here

      // lib.rs ABI: 10 params — (depositor, beneficiary, arbiters, required_confirmations,
      //   milestones: Vec<(i128,String)>, token, total_amount, duration, project_title, project_description)
      txBuilder.addOperation(
        contract.call(
          "create_escrow",
          depositorScVal,
          beneficiaryScVal,
          arbitersScVal,
          requiredConfirmationsScVal,
          milestonesScVal,
          tokenScVal,
          totalAmountScVal,
          durationScVal,
          projectTitleScVal,
          projectDescriptionScVal
        )
      );

      const tx = txBuilder.setTimeout(30).build();

      // Simulate to check for errors and get auth entries
      // The contract will handle the token transfer (including native XLM) internally
      const simulation = await this.rpcServer.simulateTransaction(tx);

      // Check for auth entries
      const authEntries =
        "auth" in simulation && simulation.auth ? simulation.auth : [];

      // Check if simulation failed — SDK may surface as .error string or .errorResult
      const simError = (simulation as any).error ?? null;
      if (simError) throw new Error(`Simulation failed: ${simError}`);
      if ("errorResult" in simulation && simulation.errorResult) {
        const ev = (simulation.errorResult as any).value?.() ?? simulation.errorResult;
        throw new Error(`Simulation failed: ${ev.toString()}`);
      }

      // Get the escrow ID from simulation if available
      let escrowIdFromSimulation: number | undefined;

      // Check different possible locations for return value
      let returnValue: any = null;
      if ((simulation as any).result) {
        // Check if result has returnValue or is directly the ScVal
        const result = (simulation as any).result;
        if (result && typeof result === "object") {
          if ("returnValue" in result && result.returnValue) {
            returnValue = result.returnValue;
          } else if ("xdr" in result) {
            // Might be an XDR object
            returnValue = result;
          } else {
            // Try using result directly
            returnValue = result;
          }
        }
      } else if ("returnValue" in simulation && simulation.returnValue) {
        returnValue = simulation.returnValue;
      } else if (
        "transactionData" in simulation &&
        (simulation as any).transactionData
      ) {
        const txData = (simulation as any).transactionData;
        if ("returnValue" in txData && txData.returnValue) {
          returnValue = txData.returnValue;
        }
      }

      if (returnValue) {
        try {
          // Check if returnValue has a retval property (common in Stellar SDK)
          let scVal: xdr.ScVal;
          if (returnValue.retval) {
            // The actual return value is in retval property
            scVal = returnValue.retval;
          } else if (returnValue instanceof xdr.ScVal) {
            // Already an ScVal object
            scVal = returnValue;
          } else if (typeof returnValue === "string") {
            scVal = xdr.ScVal.fromXDR(returnValue, "base64");
          } else if (returnValue.xdr) {
            scVal = xdr.ScVal.fromXDR(returnValue.xdr, "base64");
          } else {
            // Try to use it as is
            scVal = returnValue as xdr.ScVal;
          }
          const result = scValToNative(scVal);
          if (typeof result === "number") {
            escrowIdFromSimulation = result;
          }
        } catch (e) {
        }
      } else {
        if ((simulation as any).result) {
        }
      }

      // Prepare transaction
      const prepared = await this.rpcServer.prepareTransaction(tx);

      // Sign auth entries if needed
      if (Array.isArray(authEntries) && authEntries.length > 0) {
        const signedAuthEntries = await signAuthEntries(
          authEntries as any[],
          walletAddress
        );
        // Rebuild transaction with signed auth entries
        const { xdr } = await import("@stellar/stellar-sdk");
        const parsedSignedAuth = signedAuthEntries.map((signed: string) =>
          xdr.SorobanAuthorizationEntry.fromXDR(signed, "base64")
        );

        const operations = prepared.operations;
        if (operations && operations.length > 0) {
          // Handle all operations, not just the first one
          // This is important when we have multiple operations (e.g., SAC transfer + create_escrow)
          const freshAccount = await this.rpcServer.getAccount(walletAddress);
          const newTxBuilder = new TransactionBuilder(freshAccount, {
            fee: prepared.fee,
            networkPassphrase: this.network.networkPassphrase,
          });

          // Add all operations with auth entries
          // For now, we'll attach auth entries to the first operation that needs them
          // In a multi-operation transaction, auth entries are typically for the first operation
          operations.forEach((op, idx) => {
            if (op.type === "invokeHostFunction") {
              const invokeOp = op as any;
              const hostFn = invokeOp.function || invokeOp.hostFunction;
              // Attach auth entries to the first operation that needs them
              const authForThisOp = idx === 0 ? parsedSignedAuth : [];
              const newOp = Operation.invokeHostFunction({
                function: hostFn as xdr.HostFunction,
                auth: authForThisOp,
              } as any);
              newTxBuilder.addOperation(newOp);
            } else {
              // For non-invokeHostFunction operations, add as-is
              newTxBuilder.addOperation(op as any);
            }
          });

          const newTx = newTxBuilder
            .setSorobanData((prepared as any).getSorobanData?.() ?? (prepared as any).sorobanData)
            .setTimeout(30)
            .build();

          const signedTxXdr = await signTransaction({
            unsignedTransaction: newTx.toXDR(),
            address: walletAddress,
          });

          const signedTransaction = TransactionBuilder.fromXDR(
            signedTxXdr,
            this.network.networkPassphrase
          );

          const sendResponse =
            await this.rpcServer.sendTransaction(signedTransaction);

          const txHash = sendResponse.hash || "";

          if (!txHash) {
            throw new Error("Transaction sent but no hash returned");
          }

          if (sendResponse.status === "PENDING" && txHash) {
            await this.waitForConfirmation(txHash);
          } else if (sendResponse.status === "DUPLICATE") {
          } else if (sendResponse.status === "TRY_AGAIN_LATER") {
            throw new Error("Transaction should be retried later");
          }

          // Return escrow ID from simulation if available
          if (escrowIdFromSimulation !== undefined) {
            return escrowIdFromSimulation;
          }

          // Otherwise, try to get it from the transaction result
          // Wait a bit more to ensure transaction is fully processed
          await new Promise((resolve) => setTimeout(resolve, 2000));

          let txResult = await this.rpcServer.getTransaction(txHash);
          const hasResultXdr = "resultXdr" in txResult && txResult.resultXdr;

          // If transaction is still NOT_FOUND, wait a bit more and retry
          if (txResult.status === "NOT_FOUND") {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            txResult = await this.rpcServer.getTransaction(txHash);
            const retryHasResultXdr =
              "resultXdr" in txResult && txResult.resultXdr;
          }

          if (
            txResult.status === "SUCCESS" &&
            "resultXdr" in txResult &&
            txResult.resultXdr
          ) {
            try {
              // resultXdr might be a string (base64) or already an ScVal object
              let resultScVal: xdr.ScVal;
              const resultXdr = txResult.resultXdr;
              if (typeof resultXdr === "string") {
                resultScVal = xdr.ScVal.fromXDR(resultXdr, "base64");
              } else if (resultXdr instanceof xdr.ScVal) {
                // Already an ScVal object
                resultScVal = resultXdr;
              } else if ((resultXdr as any).xdr) {
                // Has xdr property
                resultScVal = xdr.ScVal.fromXDR(
                  (resultXdr as any).xdr,
                  "base64"
                );
              } else {
                // Try to use it as is, but check if it has the right structure
                const resultXdrObj = resultXdr as any;
                // Check if it has a retval property (common in Stellar SDK)
                if (resultXdrObj.retval) {
                  resultScVal = resultXdrObj.retval;
                } else if (
                  resultXdrObj.switch ||
                  resultXdrObj._switch ||
                  resultXdrObj.value ||
                  resultXdrObj._value !== undefined
                ) {
                  // Might be an ScVal-like object
                  resultScVal = resultXdrObj as xdr.ScVal;
                } else {
                  // Try to access the value directly if it's a simple object
                  if (resultXdrObj._value !== undefined) {
                    // Create a new ScVal from the value
                    const value = resultXdrObj._value;
                    if (typeof value === "number") {
                      resultScVal = xdr.ScVal.scvU32(value);
                    } else {
                      throw new Error("resultXdr is not a valid ScVal");
                    }
                  } else {
                    throw new Error("resultXdr is not a valid ScVal");
                  }
                }
              }
              const result = scValToNative(resultScVal);
              if (typeof result === "number") {
                return result;
              }
            } catch (e) {
            }
          }

          throw new Error("Could not get escrow ID from transaction");
        }
      }

      // No auth entries, sign normally
      const signedTxXdr = await signTransaction({
        unsignedTransaction: prepared.toXDR(),
        address: walletAddress,
      });

      const signedTransaction = TransactionBuilder.fromXDR(
        signedTxXdr,
        this.network.networkPassphrase
      );

      const sendResponse =
        await this.rpcServer.sendTransaction(signedTransaction);

      const txHash = sendResponse.hash || "";

      if (!txHash) {
        throw new Error("Transaction sent but no hash returned");
      }

      if (sendResponse.status === "ERROR") {
        // Do NOT treat simulation as success if the real send failed
        const anyResp = sendResponse as any;
        const shortDetails =
          anyResp?.errorResultXdr ||
          anyResp?.errorResult ||
          anyResp?.resultXdr ||
          anyResp?.message ||
          undefined;
        const details = (() => {
          if (typeof shortDetails === "string" && shortDetails.trim()) {
            return shortDetails;
          }
          try {
            return JSON.stringify(sendResponse);
          } catch {
            return String(sendResponse);
          }
        })();
        throw new Error(
          `Transaction failed (sendTransaction: ERROR). ${details}. Tx: https://stellar.expert/explorer/testnet/tx/${txHash}`,
        );
      }

      if (sendResponse.status === "PENDING" && txHash) {
        await this.waitForConfirmation(txHash);
      } else if (sendResponse.status === "DUPLICATE") {
      } else if (sendResponse.status === "TRY_AGAIN_LATER") {
        throw new Error("Transaction should be retried later");
      }

      // Return escrow ID from simulation if available
      if (escrowIdFromSimulation !== undefined) {
        return escrowIdFromSimulation;
      }

      // Otherwise, try to get it from the transaction result
      // Wait a bit more to ensure transaction is fully processed
      await new Promise((resolve) => setTimeout(resolve, 2000));

      let txResult = await this.rpcServer.getTransaction(txHash);
      const hasResultXdr = "resultXdr" in txResult && txResult.resultXdr;

      // If transaction is still NOT_FOUND, wait a bit more and retry
      if (txResult.status === "NOT_FOUND") {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        txResult = await this.rpcServer.getTransaction(txHash);
        const retryHasResultXdr = "resultXdr" in txResult && txResult.resultXdr;
      }

      if (
        txResult.status === "SUCCESS" &&
        "resultXdr" in txResult &&
        txResult.resultXdr
      ) {
        try {
          // resultXdr might be a string (base64) or already an ScVal object
          let resultScVal: xdr.ScVal;
          const resultXdr = txResult.resultXdr;
          if (typeof resultXdr === "string") {
            resultScVal = xdr.ScVal.fromXDR(resultXdr, "base64");
          } else if (resultXdr instanceof xdr.ScVal) {
            // Already an ScVal object
            resultScVal = resultXdr;
          } else if ((resultXdr as any).xdr) {
            // Has xdr property
            resultScVal = xdr.ScVal.fromXDR((resultXdr as any).xdr, "base64");
          } else {
            // Try to use it as is, but check if it has the right structure
            const resultXdrObj = resultXdr as any;
            // Check if it has a retval property (common in Stellar SDK)
            if (resultXdrObj.retval) {
              resultScVal = resultXdrObj.retval;
            } else if (
              resultXdrObj.switch ||
              resultXdrObj._switch ||
              resultXdrObj.value ||
              resultXdrObj._value !== undefined
            ) {
              // Might be an ScVal-like object
              resultScVal = resultXdrObj as xdr.ScVal;
            } else {
              // Try to access the value directly if it's a simple object
              if (resultXdrObj._value !== undefined) {
                // Create a new ScVal from the value
                const value = resultXdrObj._value;
                if (typeof value === "number") {
                  resultScVal = xdr.ScVal.scvU32(value);
                } else {
                  throw new Error("resultXdr is not a valid ScVal");
                }
              } else {
                throw new Error("resultXdr is not a valid ScVal");
              }
            }
          }
          const result = scValToNative(resultScVal);
          if (typeof result === "number") {
            return result;
          }
        } catch (e) {
        }
      }

      throw new Error("Could not get escrow ID from transaction");
    } catch (error: any) {
      throw error;
    }
  }

  async startWork(escrowId: number, beneficiary: string): Promise<string> {
    // Use the beneficiary address from params - it's already the wallet address from the component
    // Don't rely on useWalletStore which might be out of sync
    if (!beneficiary) {
      throw new Error("Beneficiary address is required");
    }


    try {
      // Build transaction manually with beneficiary as source account
      // This ensures the simulation detects auth requirements
      const { Contract, nativeToScVal, TransactionBuilder, Operation, xdr } =
        await import("@stellar/stellar-sdk");
      const { signTransaction, signAuthEntries } = await import(
        "./wallet-signer"
      );

      const contract = new Contract(this.contractId);
      const sourceAccount = await this.rpcServer.getAccount(beneficiary);

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "start_work",
            nativeToScVal(escrowId, { type: "u32" }),
            nativeToScVal(beneficiary, { type: "address" })
          )
        )
        .setTimeout(30)
        .build();


      const simulation = await this.rpcServer.simulateTransaction(tx);

      const authEntries =
        "auth" in simulation && simulation.auth
          ? Array.isArray(simulation.auth)
            ? simulation.auth
            : []
          : [];


      if ("errorResult" in simulation && simulation.errorResult) {
        const errorValue =
          (simulation.errorResult as any).value?.() || simulation.errorResult;
        throw new Error(
          `Transaction simulation failed: ${errorValue.toString()}`
        );
      }

      const prepared = await this.rpcServer.prepareTransaction(tx);

      let signedTxXdr: string;

      if (authEntries && authEntries.length > 0) {
        const signedAuthEntries = await signAuthEntries(
          authEntries as any[],
          beneficiary
        );

        const parsedSignedAuth = signedAuthEntries.map((signed: string) =>
          xdr.SorobanAuthorizationEntry.fromXDR(signed, "base64")
        );

        const operations = prepared.operations;
        if (operations && operations.length > 0) {
          const op = operations[0];
          if (op.type === "invokeHostFunction") {
            const invokeOp = op as any;
            const hostFn = invokeOp.function || invokeOp.hostFunction;
            const newOp = Operation.invokeHostFunction({
              function: hostFn as xdr.HostFunction,
              auth: parsedSignedAuth,
            } as any);

            const freshAccount = await this.rpcServer.getAccount(beneficiary);
            const newTx = new TransactionBuilder(freshAccount, {
              fee: prepared.fee,
              networkPassphrase: this.network.networkPassphrase,
            })
              .addOperation(newOp)
              .setSorobanData((prepared as any).getSorobanData?.() ?? (prepared as any).sorobanData)
              .setTimeout(30)
              .build();

            signedTxXdr = await signTransaction({
              unsignedTransaction: newTx.toXDR(),
              address: beneficiary,
            });
          } else {
            throw new Error("Expected invokeHostFunction operation");
          }
        } else {
          throw new Error("No operations found in prepared transaction");
        }
      } else {
        signedTxXdr = await signTransaction({
          unsignedTransaction: prepared.toXDR(),
          address: beneficiary,
        });
      }


      const signedTransaction = TransactionBuilder.fromXDR(
        signedTxXdr,
        this.network.networkPassphrase
      );

      const sendResponse =
        await this.rpcServer.sendTransaction(signedTransaction);

      if (sendResponse.status === "ERROR") {
        throw new Error("Transaction failed");
      }

      if (sendResponse.status === "PENDING" && sendResponse.hash) {
        return await this.waitForConfirmation(sendResponse.hash);
      }

      return sendResponse.hash || "";
    } catch (error: any) {
      throw error;
    }
  }

  async submitMilestone(params: {
    escrow_id: number;
    milestone_index: number;
    description: string;
    beneficiary: string;
  }): Promise<string> {
    // Use the beneficiary address from params - it's already the wallet address from the component
    // Don't rely on useWalletStore which might be out of sync
    if (!params.beneficiary) {
      throw new Error("Beneficiary address is required");
    }


    try {
      // Build transaction manually with beneficiary as source account
      // This ensures the simulation detects auth requirements
      const { Contract, nativeToScVal, TransactionBuilder, Operation, xdr } =
        await import("@stellar/stellar-sdk");
      const { signTransaction, signAuthEntries } = await import(
        "./wallet-signer"
      );

      const contract = new Contract(this.contractId);
      const sourceAccount = await this.rpcServer.getAccount(params.beneficiary);

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "submit_milestone",
            nativeToScVal(params.escrow_id, { type: "u32" }),
            nativeToScVal(params.milestone_index, { type: "u32" }),
            nativeToScVal(params.description, { type: "string" }),
            nativeToScVal(params.beneficiary, { type: "address" })
          )
        )
        .setTimeout(30)
        .build();


      const simulation = await this.rpcServer.simulateTransaction(tx);

      const authEntries =
        "auth" in simulation && simulation.auth
          ? Array.isArray(simulation.auth)
            ? simulation.auth
            : []
          : [];


      if ("errorResult" in simulation && simulation.errorResult) {
        const errorValue =
          (simulation.errorResult as any).value?.() || simulation.errorResult;
        throw new Error(
          `Transaction simulation failed: ${errorValue.toString()}`
        );
      }

      const prepared = await this.rpcServer.prepareTransaction(tx);

      let signedTxXdr: string;

      if (authEntries && authEntries.length > 0) {
        const signedAuthEntries = await signAuthEntries(
          authEntries as any[],
          params.beneficiary
        );

        const parsedSignedAuth = signedAuthEntries.map((signed: string) =>
          xdr.SorobanAuthorizationEntry.fromXDR(signed, "base64")
        );

        const operations = prepared.operations;
        if (operations && operations.length > 0) {
          const op = operations[0];
          if (op.type === "invokeHostFunction") {
            const invokeOp = op as any;
            const hostFn = invokeOp.function || invokeOp.hostFunction;
            const newOp = Operation.invokeHostFunction({
              function: hostFn as xdr.HostFunction,
              auth: parsedSignedAuth,
            } as any);

            const freshAccount = await this.rpcServer.getAccount(
              params.beneficiary
            );
            const newTx = new TransactionBuilder(freshAccount, {
              fee: prepared.fee,
              networkPassphrase: this.network.networkPassphrase,
            })
              .addOperation(newOp)
              .setTimeout(30)
              .build();

            const newPrepared = await this.rpcServer.prepareTransaction(newTx);
            signedTxXdr = await signTransaction({
              unsignedTransaction: newPrepared.toXDR(),
              address: params.beneficiary,
            });
          } else {
            throw new Error("Expected invokeHostFunction operation");
          }
        } else {
          throw new Error("No operations found in prepared transaction");
        }
      } else {
        signedTxXdr = await signTransaction({
          unsignedTransaction: prepared.toXDR(),
          address: params.beneficiary,
        });
      }


      const signedTransaction = TransactionBuilder.fromXDR(
        signedTxXdr,
        this.network.networkPassphrase
      );

      const sendResponse =
        await this.rpcServer.sendTransaction(signedTransaction);

      if (sendResponse.status === "ERROR") {
        throw new Error("Transaction failed");
      }

      if (sendResponse.status === "PENDING" && sendResponse.hash) {
        return await this.waitForConfirmation(sendResponse.hash);
      }

      return sendResponse.hash || "";
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Resubmit a rejected milestone
   */
  async resubmitMilestone(params: {
    escrow_id: number;
    milestone_index: number;
    description: string;
    beneficiary: string;
  }): Promise<string> {
    if (!params.beneficiary) {
      throw new Error("Beneficiary address is required");
    }


    try {
      const { Contract, nativeToScVal, TransactionBuilder, Operation, xdr } =
        await import("@stellar/stellar-sdk");
      const { signTransaction, signAuthEntries } = await import(
        "./wallet-signer"
      );

      const contract = new Contract(this.contractId);
      const sourceAccount = await this.rpcServer.getAccount(params.beneficiary);

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "resubmit_milestone",
            nativeToScVal(params.escrow_id, { type: "u32" }),
            nativeToScVal(params.milestone_index, { type: "u32" }),
            nativeToScVal(params.description, { type: "string" }),
            nativeToScVal(params.beneficiary, { type: "address" })
          )
        )
        .setTimeout(30)
        .build();


      const simulation = await this.rpcServer.simulateTransaction(tx);

      const authEntries =
        "auth" in simulation && simulation.auth
          ? Array.isArray(simulation.auth)
            ? simulation.auth
            : []
          : [];


      if ("errorResult" in simulation && simulation.errorResult) {
        const errorValue =
          (simulation.errorResult as any).value?.() || simulation.errorResult;
        throw new Error(
          `Transaction simulation failed: ${errorValue.toString()}`
        );
      }

      const prepared = await this.rpcServer.prepareTransaction(tx);

      let signedTxXdr: string;

      if (authEntries && authEntries.length > 0) {
        const signedAuthEntries = await signAuthEntries(
          authEntries as any[],
          params.beneficiary
        );

        const parsedSignedAuth = signedAuthEntries.map((signed: string) =>
          xdr.SorobanAuthorizationEntry.fromXDR(signed, "base64")
        );

        const operations = prepared.operations;
        if (operations && operations.length > 0) {
          const op = operations[0];
          if (op.type === "invokeHostFunction") {
            const invokeOp = op as any;
            const hostFn = invokeOp.function || invokeOp.hostFunction;
            const newOp = Operation.invokeHostFunction({
              function: hostFn as xdr.HostFunction,
              auth: parsedSignedAuth,
            } as any);

            const newTx = new TransactionBuilder(sourceAccount, {
              fee: "100",
              networkPassphrase: this.network.networkPassphrase,
            })
              .addOperation(newOp)
              .setTimeout(30)
              .build();

            const newPrepared = await this.rpcServer.prepareTransaction(newTx);
            signedTxXdr = await signTransaction({
              unsignedTransaction: newPrepared.toXDR(),
              address: params.beneficiary,
            });
          } else {
            throw new Error("Expected invokeHostFunction operation");
          }
        } else {
          throw new Error("No operations found in prepared transaction");
        }
      } else {
        signedTxXdr = await signTransaction({
          unsignedTransaction: prepared.toXDR(),
          address: params.beneficiary,
        });
      }


      const signedTransaction = TransactionBuilder.fromXDR(
        signedTxXdr,
        this.network.networkPassphrase
      );

      const sendResponse =
        await this.rpcServer.sendTransaction(signedTransaction);

      if (sendResponse.status === "ERROR") {
        throw new Error("Transaction failed");
      }

      if (sendResponse.status === "PENDING" && sendResponse.hash) {
        return await this.waitForConfirmation(sendResponse.hash);
      }

      return sendResponse.hash || "";
    } catch (error: any) {
      throw error;
    }
  }

  async approveMilestone(params: {
    escrow_id: number;
    milestone_index: number;
    depositor: string;
  }): Promise<string> {
    if (!params.depositor) {
      throw new Error("Depositor address is required");
    }
    try {
      const { Contract, nativeToScVal, TransactionBuilder, Operation, xdr } =
        await import("@stellar/stellar-sdk");
      const { signTransaction, signAuthEntries } = await import(
        "./wallet-signer"
      );
      const contract = new Contract(this.contractId);
      const sourceAccount = await this.rpcServer.getAccount(params.depositor);
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "approve_milestone",
            nativeToScVal(params.escrow_id, { type: "u32" }),
            nativeToScVal(params.milestone_index, { type: "u32" }),
            nativeToScVal(params.depositor, { type: "address" })
          )
        )
        .setTimeout(30)
        .build();
      const simulation = await this.rpcServer.simulateTransaction(tx);
      const authEntries =
        "auth" in simulation && simulation.auth
          ? Array.isArray(simulation.auth)
            ? simulation.auth
            : []
          : [];
      if ("errorResult" in simulation && simulation.errorResult) {
        const errorValue =
          (simulation.errorResult as any).value?.() || simulation.errorResult;
        throw new Error(
          `Transaction simulation failed: ${errorValue.toString()}`
        );
      }
      const prepared = await this.rpcServer.prepareTransaction(tx);
      let signedTxXdr: string;
      if (authEntries && authEntries.length > 0) {
        const signedAuthEntries = await signAuthEntries(
          authEntries as any[],
          params.depositor
        );
        const parsedSignedAuth = signedAuthEntries.map((signed: string) =>
          xdr.SorobanAuthorizationEntry.fromXDR(signed, "base64")
        );
        const operations = prepared.operations;
        if (operations && operations.length > 0) {
          const op = operations[0];
          if (op.type === "invokeHostFunction") {
            const invokeOp = op as any;
            const hostFn = invokeOp.function || invokeOp.hostFunction;
            const newOp = Operation.invokeHostFunction({
              function: hostFn as xdr.HostFunction,
              auth: parsedSignedAuth,
            } as any);
            const freshAccount = await this.rpcServer.getAccount(
              params.depositor
            );
            const newTx = new TransactionBuilder(freshAccount, {
              fee: prepared.fee,
              networkPassphrase: this.network.networkPassphrase,
            })
              .addOperation(newOp)
              .setTimeout(30)
              .build();
            const newPrepared = await this.rpcServer.prepareTransaction(newTx);
            signedTxXdr = await signTransaction({
              unsignedTransaction: newPrepared.toXDR(),
              address: params.depositor,
            });
          } else {
            throw new Error("Expected invokeHostFunction operation");
          }
        } else {
          throw new Error("No operations found in prepared transaction");
        }
      } else {
        signedTxXdr = await signTransaction({
          unsignedTransaction: prepared.toXDR(),
          address: params.depositor,
        });
      }
      const signedTransaction = TransactionBuilder.fromXDR(
        signedTxXdr,
        this.network.networkPassphrase
      );
      const sendResponse =
        await this.rpcServer.sendTransaction(signedTransaction);
      if (sendResponse.status === "ERROR") {
        throw new Error("Transaction failed");
      }
      if (sendResponse.status === "PENDING" && sendResponse.hash) {
        return await this.waitForConfirmation(sendResponse.hash);
      }
      return sendResponse.hash || "";
    } catch (error: any) {
      throw error;
    }
  }

  async rejectMilestone(params: {
    escrow_id: number;
    milestone_index: number;
    reason: string;
    depositor: string;
  }): Promise<string> {
    if (!params.depositor) {
      throw new Error("Depositor address is required");
    }
    try {
      const { Contract, nativeToScVal, TransactionBuilder, Operation, xdr } =
        await import("@stellar/stellar-sdk");
      const { signTransaction, signAuthEntries } = await import(
        "./wallet-signer"
      );
      const contract = new Contract(this.contractId);
      const sourceAccount = await this.rpcServer.getAccount(params.depositor);
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "reject_milestone",
            nativeToScVal(params.escrow_id, { type: "u32" }),
            nativeToScVal(params.milestone_index, { type: "u32" }),
            nativeToScVal(params.reason, { type: "string" }),
            nativeToScVal(params.depositor, { type: "address" })
          )
        )
        .setTimeout(30)
        .build();
      const simulation = await this.rpcServer.simulateTransaction(tx);
      const authEntries =
        "auth" in simulation && simulation.auth
          ? Array.isArray(simulation.auth)
            ? simulation.auth
            : []
          : [];
      if ("errorResult" in simulation && simulation.errorResult) {
        const errorValue =
          (simulation.errorResult as any).value?.() || simulation.errorResult;
        throw new Error(
          `Transaction simulation failed: ${errorValue.toString()}`
        );
      }
      const prepared = await this.rpcServer.prepareTransaction(tx);
      let signedTxXdr: string;
      if (authEntries && authEntries.length > 0) {
        const signedAuthEntries = await signAuthEntries(
          authEntries as any[],
          params.depositor
        );
        const parsedSignedAuth = signedAuthEntries.map((signed: string) =>
          xdr.SorobanAuthorizationEntry.fromXDR(signed, "base64")
        );
        const operations = prepared.operations;
        if (operations && operations.length > 0) {
          const op = operations[0];
          if (op.type === "invokeHostFunction") {
            const invokeOp = op as any;
            const hostFn = invokeOp.function || invokeOp.hostFunction;
            const newOp = Operation.invokeHostFunction({
              function: hostFn as xdr.HostFunction,
              auth: parsedSignedAuth,
            } as any);
            const freshAccount = await this.rpcServer.getAccount(
              params.depositor
            );
            const newTx = new TransactionBuilder(freshAccount, {
              fee: prepared.fee,
              networkPassphrase: this.network.networkPassphrase,
            })
              .addOperation(newOp)
              .setTimeout(30)
              .build();
            const newPrepared = await this.rpcServer.prepareTransaction(newTx);
            signedTxXdr = await signTransaction({
              unsignedTransaction: newPrepared.toXDR(),
              address: params.depositor,
            });
          } else {
            throw new Error("Expected invokeHostFunction operation");
          }
        } else {
          throw new Error("No operations found in prepared transaction");
        }
      } else {
        signedTxXdr = await signTransaction({
          unsignedTransaction: prepared.toXDR(),
          address: params.depositor,
        });
      }
      const signedTransaction = TransactionBuilder.fromXDR(
        signedTxXdr,
        this.network.networkPassphrase
      );
      const sendResponse =
        await this.rpcServer.sendTransaction(signedTransaction);
      if (sendResponse.status === "ERROR") {
        throw new Error("Transaction failed");
      }
      if (sendResponse.status === "PENDING" && sendResponse.hash) {
        return await this.waitForConfirmation(sendResponse.hash);
      }
      return sendResponse.hash || "";
    } catch (error: any) {
      throw error;
    }
  }

  async disputeMilestone(params: {
    escrow_id: number;
    milestone_index: number;
    reason: string;
    disputer: string;
  }): Promise<string> {
    if (!params.disputer) {
      throw new Error("Disputer address is required");
    }
    try {
      const { Contract, nativeToScVal, TransactionBuilder, Operation, xdr } =
        await import("@stellar/stellar-sdk");
      const { signTransaction, signAuthEntries } = await import(
        "./wallet-signer"
      );
      const contract = new Contract(this.contractId);
      const sourceAccount = await this.rpcServer.getAccount(params.disputer);
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "dispute_milestone",
            nativeToScVal(params.escrow_id, { type: "u32" }),
            nativeToScVal(params.milestone_index, { type: "u32" }),
            nativeToScVal(params.reason, { type: "string" }),
            nativeToScVal(params.disputer, { type: "address" })
          )
        )
        .setTimeout(30)
        .build();
      const simulation = await this.rpcServer.simulateTransaction(tx);
      const authEntries =
        "auth" in simulation && simulation.auth
          ? Array.isArray(simulation.auth)
            ? simulation.auth
            : []
          : [];
      if ("errorResult" in simulation && simulation.errorResult) {
        const errorValue =
          (simulation.errorResult as any).value?.() || simulation.errorResult;
        throw new Error(
          `Transaction simulation failed: ${errorValue.toString()}`
        );
      }
      const prepared = await this.rpcServer.prepareTransaction(tx);
      let signedTxXdr: string;
      if (authEntries && authEntries.length > 0) {
        const signedAuthEntries = await signAuthEntries(
          authEntries as any[],
          params.disputer
        );
        const parsedSignedAuth = signedAuthEntries.map((signed: string) =>
          xdr.SorobanAuthorizationEntry.fromXDR(signed, "base64")
        );
        const operations = prepared.operations;
        if (operations && operations.length > 0) {
          const op = operations[0];
          if (op.type === "invokeHostFunction") {
            const invokeOp = op as any;
            const hostFn = invokeOp.function || invokeOp.hostFunction;
            const newOp = Operation.invokeHostFunction({
              function: hostFn as xdr.HostFunction,
              auth: parsedSignedAuth,
            } as any);
            const freshAccount = await this.rpcServer.getAccount(
              params.disputer
            );
            const newTx = new TransactionBuilder(freshAccount, {
              fee: prepared.fee,
              networkPassphrase: this.network.networkPassphrase,
            })
              .addOperation(newOp)
              .setTimeout(30)
              .build();
            const newPrepared = await this.rpcServer.prepareTransaction(newTx);
            signedTxXdr = await signTransaction({
              unsignedTransaction: newPrepared.toXDR(),
              address: params.disputer,
            });
          } else {
            throw new Error("Expected invokeHostFunction operation");
          }
        } else {
          throw new Error("No operations found in prepared transaction");
        }
      } else {
        signedTxXdr = await signTransaction({
          unsignedTransaction: prepared.toXDR(),
          address: params.disputer,
        });
      }
      const signedTransaction = TransactionBuilder.fromXDR(
        signedTxXdr,
        this.network.networkPassphrase
      );
      const sendResponse =
        await this.rpcServer.sendTransaction(signedTransaction);
      if (sendResponse.status === "ERROR") {
        throw new Error("Transaction failed");
      }
      if (sendResponse.status === "PENDING" && sendResponse.hash) {
        return await this.waitForConfirmation(sendResponse.hash);
      }
      return sendResponse.hash || "";
    } catch (error: any) {
      throw error;
    }
  }

  async refundEscrow(escrowId: number, depositor: string): Promise<string> {
    const { address } = useWalletStore.getState();
    if (!address) {
      throw new Error("Wallet not connected");
    }

    const walletAddress = address;

    try {
      const assembledTx = await this.client.refund_escrow({
        escrow_id: escrowId,
        depositor,
      });

      return await this.sendTransactionWithAuth(assembledTx, walletAddress);
    } catch (error: any) {
      throw error;
    }
  }

  async applyToJob(params: {
    escrow_id: number;
    cover_letter: string;
    proposed_timeline: number;
    freelancer: string;
  }): Promise<string> {
    const { address } = useWalletStore.getState();
    if (!address) {
      throw new Error("Wallet not connected");
    }

    const walletAddress = address;

    try {
      const assembledTx = await this.client.apply_to_job({
        escrow_id: params.escrow_id,
        cover_letter: params.cover_letter,
        proposed_timeline: params.proposed_timeline,
        freelancer: params.freelancer,
      });

      return await this.sendTransactionWithAuth(assembledTx, walletAddress);
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Gasless variant of applyToJob.
   *
   * The user's wallet signs the inner Soroban transaction but DOES NOT pay
   * fees.  Instead the signed XDR is sent to the backend which wraps it in a
   * Stellar fee-bump transaction (admin wallet is the fee source) and submits
   * it.  Applicants therefore need zero XLM for gas.
   */
  /**
   * Gasless variant of applyToJob.
   *
   * Builds the apply_to_job transaction manually (matching the pattern already
   * used by web3-context.tsx) so the source account is always the user's wallet.
   * After signing, the XDR is sent to the backend which wraps it in a Stellar
   * fee-bump transaction — admin wallet pays all fees.
   */
  async applyToJobGasless(params: {
    escrow_id: number;
    cover_letter: string;
    proposed_timeline: number;
    freelancer: string;
  }): Promise<string> {
    const { address } = useWalletStore.getState();
    if (!address) throw new Error("Wallet not connected");

    // Build the transaction manually so the source account is the user's wallet
    const contract = new Contract(this.contractId);
    const sourceAccount = await this.rpcServer.getAccount(address);

    const escrowIdScVal   = nativeToScVal(params.escrow_id,         { type: "u32" });
    const coverLetterScVal = nativeToScVal(params.cover_letter,     { type: "string" });
    const timelineScVal    = nativeToScVal(params.proposed_timeline, { type: "u32" });
    const freelancerScVal  = nativeToScVal(params.freelancer,        { type: "address" });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: this.network.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "apply_to_job",
          escrowIdScVal,
          coverLetterScVal,
          timelineScVal,
          freelancerScVal
        )
      )
      .setTimeout(30)
      .build();

    // Simulate
    const simulation = await this.rpcServer.simulateTransaction(tx);

    if ("errorResult" in simulation && simulation.errorResult) {
      const val =
        (simulation.errorResult as any).value?.() ?? simulation.errorResult;
      throw new Error(`Simulation failed: ${String(val)}`);
    }

    const prepared = await this.rpcServer.prepareTransaction(tx);

    const authEntries =
      "auth" in simulation && Array.isArray(simulation.auth)
        ? simulation.auth
        : [];

    let signedTxXdr: string;

    if (authEntries.length > 0) {
      const signedAuth = await signAuthEntries(authEntries as any[], address);
      const parsedSignedAuth = signedAuth.map((s) =>
        xdr.SorobanAuthorizationEntry.fromXDR(s, "base64")
      );

      const preparedOps = prepared.operations;
      if (!preparedOps?.length) throw new Error("No operations in prepared tx");

      const op = preparedOps[0] as any;
      const hostFn = op.function || op.hostFunction;
      const newOp = Operation.invokeHostFunction({
        function: hostFn as xdr.HostFunction,
        auth: parsedSignedAuth,
      } as any);

      const freshAccount = await this.rpcServer.getAccount(address);
      const newTx = new TransactionBuilder(freshAccount, {
        fee: prepared.fee,
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(newOp)
        .setSorobanData(
          (prepared as any).getSorobanData?.() ?? (prepared as any).sorobanData
        )
        .setTimeout(30)
        .build();

      signedTxXdr = await signTransaction({
        unsignedTransaction: newTx.toXDR(),
        address,
      });
    } else {
      signedTxXdr = await signTransaction({
        unsignedTransaction: prepared.toXDR(),
        address,
      });
    }

    // Send to backend for fee-bump wrapping and submission
    const { submitGaslessTransaction } = await import("@/lib/api");
    const result = await submitGaslessTransaction({ signedTxXdr });
    return result.txHash;
  }

  async acceptFreelancer(params: {
    escrow_id: number;
    freelancer: string;
    depositor: string;
  }): Promise<string> {
    // Use the depositor address from params - it's already the wallet address from the component
    // Don't rely on useWalletStore which might be out of sync
    if (!params.depositor) {
      throw new Error("Depositor address is required");
    }

    const depositorAddress = params.depositor;


    try {
      // Build transaction manually with depositor as source account
      // This ensures the simulation detects auth requirements
      const { Contract, nativeToScVal } = await import("@stellar/stellar-sdk");
      const { TransactionBuilder } = await import("@stellar/stellar-sdk");

      const contract = new Contract(this.contractId);
      const sourceAccount = await this.rpcServer.getAccount(depositorAddress);

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "accept_freelancer",
            nativeToScVal(params.escrow_id, { type: "u32" }),
            nativeToScVal(params.freelancer, { type: "address" }),
            nativeToScVal(params.depositor, { type: "address" })
          )
        )
        .setTimeout(30)
        .build();

      // Simulate to check for errors and get auth entries
      const simulation = await this.rpcServer.simulateTransaction(tx);

      // Check for auth entries
      const authEntries =
        "auth" in simulation && simulation.auth
          ? Array.isArray(simulation.auth)
            ? simulation.auth
            : []
          : [];


      // Check if simulation failed
      if ("errorResult" in simulation && simulation.errorResult) {
        const errorValue =
          (simulation.errorResult as any).value?.() || simulation.errorResult;
        throw new Error(
          `Transaction simulation failed: ${errorValue.toString()}`
        );
      }

      // Prepare transaction
      const prepared = await this.rpcServer.prepareTransaction(tx);

      // Sign auth entries if needed
      if (authEntries && authEntries.length > 0) {
        const signedAuthEntries = await signAuthEntries(
          authEntries as any[],
          depositorAddress
        );

        // Rebuild transaction with signed auth entries
        const { xdr } = await import("@stellar/stellar-sdk");
        const parsedSignedAuth = signedAuthEntries.map((signed: string) =>
          xdr.SorobanAuthorizationEntry.fromXDR(signed, "base64")
        );

        const operations = prepared.operations;
        if (operations && operations.length > 0) {
          const op = operations[0];
          if (op.type === "invokeHostFunction") {
            const invokeOp = op as any;
            const hostFn = invokeOp.function || invokeOp.hostFunction;
            const newOp = Operation.invokeHostFunction({
              function: hostFn as xdr.HostFunction,
              auth: parsedSignedAuth,
            } as any);

            const freshAccount =
              await this.rpcServer.getAccount(depositorAddress);
            const newTx = new TransactionBuilder(freshAccount, {
              fee: prepared.fee,
              networkPassphrase: this.network.networkPassphrase,
            })
              .addOperation(newOp)
              .setTimeout(30)
              .build();

            const newPrepared = await this.rpcServer.prepareTransaction(newTx);
            const signedTxXdr = await signTransaction({
              unsignedTransaction: newPrepared.toXDR(),
              address: depositorAddress,
            });

            const signedTransaction = TransactionBuilder.fromXDR(
              signedTxXdr,
              this.network.networkPassphrase
            );

            const sendResponse =
              await this.rpcServer.sendTransaction(signedTransaction);

            if (sendResponse.status === "ERROR") {
              throw new Error("Transaction failed");
            }

            if (sendResponse.status === "PENDING" && sendResponse.hash) {
              return await this.waitForConfirmation(sendResponse.hash);
            }

            return sendResponse.hash || "";
          }
        }
      }

      // No auth entries, sign normally
      const signedTxXdr = await signTransaction({
        unsignedTransaction: prepared.toXDR(),
        address: depositorAddress,
      });

      const signedTransaction = TransactionBuilder.fromXDR(
        signedTxXdr,
        this.network.networkPassphrase
      );

      const sendResponse =
        await this.rpcServer.sendTransaction(signedTransaction);

      if (sendResponse.status === "ERROR") {
        throw new Error("Transaction failed");
      }

      if (sendResponse.status === "PENDING" && sendResponse.hash) {
        return await this.waitForConfirmation(sendResponse.hash);
      }

      return sendResponse.hash || "";
    } catch (error: any) {
      throw error;
    }
  }

  async emergencyRefundAfterDeadline(
    escrowId: number,
    depositor: string
  ): Promise<string> {
    const { address } = useWalletStore.getState();
    if (!address) {
      throw new Error("Wallet not connected");
    }

    const walletAddress = address;

    try {
      const assembledTx = await this.client.emergency_refund_after_deadline({
        escrow_id: escrowId,
        depositor,
      });

      return await this.sendTransactionWithAuth(assembledTx, walletAddress);
    } catch (error: any) {
      throw error;
    }
  }

  async extendDeadline(params: {
    escrow_id: number;
    extra_seconds: number;
    depositor: string;
  }): Promise<string> {
    const { address } = useWalletStore.getState();
    if (!address) {
      throw new Error("Wallet not connected");
    }

    const walletAddress = address;

    try {
      const assembledTx = await this.client.extend_deadline({
        escrow_id: params.escrow_id,
        extra_seconds: params.extra_seconds,
        depositor: params.depositor,
      });

      return await this.sendTransactionWithAuth(assembledTx, walletAddress);
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Raise an overdue dispute after the project deadline (client or freelancer).
   */
  async raiseOverdueDispute(params: {
    escrow_id: number;
    requester: string;
    reason: string;
  }): Promise<string> {
    const { address } = useWalletStore.getState();
    if (!address) throw new Error("Wallet not connected");
    try {
      const assembledTx = await this.client.raise_overdue_dispute({
        escrow_id: params.escrow_id,
        requester: params.requester,
        reason: params.reason,
      });
      return await this.sendTransactionWithAuth(assembledTx, address);
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Arbiter: approve full refund to the client.
   */
  async arbiterApproveRefund(params: {
    escrow_id: number;
    arbiter: string;
  }): Promise<string> {
    const { address } = useWalletStore.getState();
    if (!address) throw new Error("Wallet not connected");
    try {
      const assembledTx = await this.client.arbiter_approve_refund({
        escrow_id: params.escrow_id,
        arbiter: params.arbiter,
      });
      return await this.sendTransactionWithAuth(assembledTx, address);
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Arbiter: award a specific amount to the freelancer, return rest to client.
   */
  async arbiterAwardFreelancer(params: {
    escrow_id: number;
    arbiter: string;
    freelancer_amount: bigint;
  }): Promise<string> {
    const { address } = useWalletStore.getState();
    if (!address) throw new Error("Wallet not connected");
    try {
      const assembledTx = await this.client.arbiter_award_freelancer({
        escrow_id: params.escrow_id,
        arbiter: params.arbiter,
        freelancer_amount: params.freelancer_amount,
      });
      return await this.sendTransactionWithAuth(assembledTx, address);
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Admin operations - require owner authorization
   */
  async pauseJobCreation(address?: string): Promise<string> {
    const walletAddress = address || useWalletStore.getState().address;
    if (!walletAddress) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction("pause_job_creation", [], walletAddress);
  }

  async unpauseJobCreation(address?: string): Promise<string> {
    const walletAddress = address || useWalletStore.getState().address;
    if (!walletAddress) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction("unpause_job_creation", [], walletAddress);
  }

  async setPlatformFeeBP(feeBP: number): Promise<string> {
    const { address } = useWalletStore.getState();
    if (!address) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction(
      "set_platform_fee_bp",
      [nativeToScVal(feeBP, { type: "u32" })],
      address
    );
  }

  async setFeeCollector(feeCollector: string): Promise<string> {
    const { address } = useWalletStore.getState();
    if (!address) {
      throw new Error("Wallet not connected");
    }

    const walletAddress = address;

    try {
      const assembledTx = await this.client.set_fee_collector({
        fee_collector: feeCollector,
      });

      const signedTxXdr = await signTransaction({
        unsignedTransaction: assembledTx.toXDR(),
        address: walletAddress,
      });

      const signedTransaction = TransactionBuilder.fromXDR(
        signedTxXdr,
        this.network.networkPassphrase
      );

      const sendResponse =
        await this.rpcServer.sendTransaction(signedTransaction);

      if (sendResponse.status === "ERROR") {
        throw new Error("Transaction failed");
      }

      if (sendResponse.status === "PENDING" && sendResponse.hash) {
        return await this.waitForConfirmation(sendResponse.hash);
      }

      return sendResponse.hash || "";
    } catch (error: any) {
      throw error;
    }
  }

  async whitelistToken(token: string): Promise<string> {
    const { address } = useWalletStore.getState();
    if (!address) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction(
      "whitelist_token",
      [nativeToScVal(token, { type: "address" })],
      address,
    );
  }

  async delistToken(token: string): Promise<string> {
    const { address } = useWalletStore.getState();
    if (!address) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction(
      "delist_token",
      [nativeToScVal(token, { type: "address" })],
      address,
    );
  }

  async authorizeArbiter(arbiter: string): Promise<string> {
    const { address } = useWalletStore.getState();
    if (!address) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction(
      "authorize_arbiter",
      [nativeToScVal(arbiter, { type: "address" })],
      address,
    );
  }

  async removeArbiter(arbiter: string): Promise<string> {
    const { address } = useWalletStore.getState();
    if (!address) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction(
      "remove_arbiter",
      [nativeToScVal(arbiter, { type: "address" })],
      address,
    );
  }

  /**
   * Helper for owner-only admin transactions.
   * Mirrors the pauseJobCreation pattern exactly:
   *   simulate → (sign auth entries if address-type) → setSorobanData → sign envelope → send
   */
  private async sendOwnerTransaction(
    fnName: string,
    args: any[],
    ownerAddress: string,
  ): Promise<string> {
    const { xdr: stellarXdr } = await import("@stellar/stellar-sdk");
    const contract = new Contract(this.contractId);
    const sourceAccount = await this.rpcServer.getAccount(ownerAddress);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: this.network.networkPassphrase,
    })
      .addOperation((contract as any).call(fnName, ...args))
      .setTimeout(30)
      .build();

    // Simulate first to detect auth entries and errors
    const simulation = await this.rpcServer.simulateTransaction(tx);

    if ("errorResult" in simulation && simulation.errorResult) {
      const errVal = (simulation.errorResult as any).value?.() ?? simulation.errorResult;
      throw new Error(`Simulation failed: ${errVal.toString()}`);
    }
    if ("error" in simulation && (simulation as any).error) {
      throw new Error(`Simulation error: ${(simulation as any).error}`);
    }

    const authEntries: any[] =
      "auth" in simulation && Array.isArray((simulation as any).auth)
        ? (simulation as any).auth
        : [];

    // Prepare the base transaction (attaches soroban data, fees, etc.)
    const prepared = await this.rpcServer.prepareTransaction(tx);

    // If there are address-type auth entries that need explicit signing, sign them
    const addressTypeEntries = authEntries.filter((e: any) => {
      try {
        return e.credentials().switch().value !==
          stellarXdr.SorobanCredentialsType.sorobanCredentialsSourceAccount().value;
      } catch {
        return false;
      }
    });

    let finalPrepared = prepared;
    if (addressTypeEntries.length > 0) {
      const signedAuthEntries = await signAuthEntries(addressTypeEntries, ownerAddress);
      const parsedSignedAuth = signedAuthEntries.map((s: string) =>
        stellarXdr.SorobanAuthorizationEntry.fromXDR(s, "base64"),
      );

      const operations = prepared.operations;
      if (operations.length > 0 && operations[0].type === "invokeHostFunction") {
        const invokeOp = operations[0] as any;
        const hostFn = invokeOp.function || invokeOp.hostFunction;
        const newOp = Operation.invokeHostFunction({
          function: hostFn as any,
          auth: parsedSignedAuth,
        } as any);

        const freshAccount = await this.rpcServer.getAccount(ownerAddress);
        // Reuse soroban data from the already-prepared tx — do NOT call prepareTransaction
        // again or it will overwrite the signed auth entries.
        finalPrepared = new TransactionBuilder(freshAccount, {
          fee: prepared.fee,
          networkPassphrase: this.network.networkPassphrase,
        })
          .addOperation(newOp)
          .setSorobanData(
            (prepared as any).getSorobanData?.() ?? (prepared as any).sorobanData,
          )
          .setTimeout(30)
          .build() as any;
      }
    }

    const signedXdr = await signTransaction({
      unsignedTransaction: (finalPrepared as any).toXDR(),
      address: ownerAddress,
    });

    const signedTx = TransactionBuilder.fromXDR(signedXdr, this.network.networkPassphrase);
    const sendResponse = await this.rpcServer.sendTransaction(signedTx);

    if (sendResponse.status === "ERROR") {
      let errMsg = "Transaction failed";
      try {
        errMsg = `Transaction failed: ${(sendResponse as any).errorResult?.toXDR("base64") ?? "unknown"}`;
      } catch {
        errMsg = `Transaction failed (status ERROR)`;
      }
      throw new Error(errMsg);
    }

    if (sendResponse.hash) {
      return await this.waitForConfirmation(sendResponse.hash);
    }
    return (sendResponse as any).hash ?? "";
  }

  async withdrawStuckFunds(params: {
    token: string;
    to: string;
    amount: string;
  }): Promise<string> {
    const { address } = useWalletStore.getState();
    if (!address) {
      throw new Error("Wallet not connected");
    }
    const walletAddress = address;

    try {
      const contract = new Contract(this.contractId);
      const sourceAccount = await this.rpcServer.getAccount(walletAddress);

      const tokenScVal = nativeToScVal(params.token, { type: "address" });
      const toScVal = nativeToScVal(params.to, { type: "address" });
      const amountScVal = nativeToScVal(params.amount, { type: "i128" });

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          (contract as any).call("withdraw_stuck_funds", tokenScVal, toScVal, amountScVal),
        )
        .setTimeout(30)
        .build();

      const prepared = await this.rpcServer.prepareTransaction(tx);
      const signedTxXdr = await signTransaction({
        unsignedTransaction: prepared.toXDR(),
        address: walletAddress,
      });

      const signedTransaction = TransactionBuilder.fromXDR(
        signedTxXdr,
        this.network.networkPassphrase,
      );

      const sendResponse = await this.rpcServer.sendTransaction(signedTransaction);
      if (sendResponse.status === "ERROR") {
        throw new Error("Transaction failed");
      }
      if (sendResponse.status === "PENDING" && sendResponse.hash) {
        return await this.waitForConfirmation(sendResponse.hash);
      }
      return sendResponse.hash || "";
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Check if an address is an authorized arbiter
   */
  async isAuthorizedArbiter(arbiterAddress: string): Promise<boolean> {
    try {
      const contract = new Contract(this.contractId);
      const sourceAddress =
        useWalletStore.getState().address ||
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

      const sourceAccount = {
        accountId: () => sourceAddress,
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {},
      } as any;

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "is_authorized_arbiter",
            nativeToScVal(arbiterAddress, { type: "address" })
          )
        )
        .setTimeout(30)
        .build();

      const simulation = await this.rpcServer.simulateTransaction(tx);

      if ("errorResult" in simulation && simulation.errorResult) {
        return false;
      }

      if ("result" in simulation && simulation.result) {
        const retval = (simulation.result as any).retval;
        if (retval) {
          const isAuthorized = scValToNative(retval as xdr.ScVal) as boolean;
          return isAuthorized;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Helper function to handle auth entries and send transaction
   */
  private async sendTransactionWithAuth(
    assembledTx: any,
    walletAddress: string,
    sourceAddress?: string
  ): Promise<string> {

    // Simulate to check for errors and get auth entries
    const tx = TransactionBuilder.fromXDR(
      assembledTx.toXDR(),
      this.network.networkPassphrase
    );

    // If sourceAddress is provided, rebuild the transaction with that source account
    // This is needed when the depositor needs to sign auth entries (even if same as walletAddress)
    // The transaction must be built with the depositor as the source for auth to be detected
    let transactionToSimulate = tx;
    if (sourceAddress) {
      const sourceAccount = await this.rpcServer.getAccount(sourceAddress);
      const operations = tx.operations;
      if (operations && operations.length > 0) {
        const newTx = new TransactionBuilder(sourceAccount, {
          fee: tx.fee,
          networkPassphrase: this.network.networkPassphrase,
        });
        operations.forEach((op) => newTx.addOperation(op as any));
        const timeout = (tx as any).timeout || 30;
        transactionToSimulate = newTx.setTimeout(timeout).build();
      } else {
      }
    } else {
    }

    const simulation = await this.rpcServer.simulateTransaction(
      transactionToSimulate
    );

    // Check for auth entries
    const authEntries =
      "auth" in simulation && simulation.auth
        ? Array.isArray(simulation.auth)
          ? simulation.auth
          : []
        : [];


    // Check if simulation failed
    if ("errorResult" in simulation && simulation.errorResult) {
      const errorValue =
        (simulation.errorResult as any).value?.() || simulation.errorResult;
      throw new Error(
        `Transaction simulation failed: ${errorValue.toString()}`
      );
    }

    // Prepare transaction
    const prepared = await this.rpcServer.prepareTransaction(
      transactionToSimulate
    );

    // Sign auth entries if needed
    if (authEntries && authEntries.length > 0) {
      // Use sourceAddress if provided, otherwise use walletAddress
      // For create_escrow, we need to sign auth entries for the depositor
      const authSignerAddress = sourceAddress || walletAddress;
      const signedAuthEntries = await signAuthEntries(
        authEntries as any[],
        authSignerAddress
      );
      // Rebuild transaction with signed auth entries
      const { xdr } = await import("@stellar/stellar-sdk");
      const parsedSignedAuth = signedAuthEntries.map((signed: string) =>
        xdr.SorobanAuthorizationEntry.fromXDR(signed, "base64")
      );

      const operations = prepared.operations;
      if (operations && operations.length > 0) {
        const op = operations[0];
        if (op.type === "invokeHostFunction") {
          const invokeOp = op as any;
          const hostFn = invokeOp.function || invokeOp.hostFunction;
          const newOp = Operation.invokeHostFunction({
            function: hostFn as xdr.HostFunction,
            auth: parsedSignedAuth,
          } as any);

          // Use sourceAddress if provided, otherwise use walletAddress
          const signerAddress = sourceAddress || walletAddress;
          const freshAccount = await this.rpcServer.getAccount(signerAddress);

          // Rebuild with the already-prepared soroban data but signed auth entries.
          // Do NOT call prepareTransaction again — it would re-simulate and overwrite
          // the signed auth entries with fresh unsigned ones.
          const newTx = new TransactionBuilder(freshAccount, {
            fee: prepared.fee,
            networkPassphrase: this.network.networkPassphrase,
          })
            .addOperation(newOp)
            .setSorobanData((prepared as any).getSorobanData?.() ?? (prepared as any).sorobanData)
            .setTimeout(30)
            .build();

          const signedTxXdr = await signTransaction({
            unsignedTransaction: newTx.toXDR(),
            address: signerAddress,
          });

          const signedTransaction = TransactionBuilder.fromXDR(
            signedTxXdr,
            this.network.networkPassphrase
          );

          const sendResponse =
            await this.rpcServer.sendTransaction(signedTransaction);

          if (sendResponse.status === "ERROR") {
            throw new Error("Transaction failed");
          }

          if (sendResponse.status === "PENDING" && sendResponse.hash) {
            return await this.waitForConfirmation(sendResponse.hash);
          }

          return sendResponse.hash || "";
        }
      }
    }

    // No auth entries, sign normally
    // Use sourceAddress if provided, otherwise use walletAddress
    const signerAddress = sourceAddress || walletAddress;
    const signedTxXdr = await signTransaction({
      unsignedTransaction: prepared.toXDR(),
      address: signerAddress,
    });

    const signedTransaction = TransactionBuilder.fromXDR(
      signedTxXdr,
      this.network.networkPassphrase
    );

    const sendResponse =
      await this.rpcServer.sendTransaction(signedTransaction);

    if (sendResponse.status === "ERROR") {
      throw new Error("Transaction failed");
    }

    if (sendResponse.status === "PENDING" && sendResponse.hash) {
      return await this.waitForConfirmation(sendResponse.hash);
    }

    return sendResponse.hash || "";
  }

  /**
   * Wait for transaction confirmation
   */
  private async waitForConfirmation(hash: string): Promise<string> {
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        const txStatus = await this.rpcServer.getTransaction(hash);
        const status = txStatus.status as string;

        if (status === "SUCCESS") {
          return hash;
        }

        if (status === "FAILED") {
          throw new Error("Transaction failed");
        }

        // If status is NOT_FOUND, transaction might still be processing
        // Continue waiting
        if (status === "NOT_FOUND") {
          attempts++;
          continue;
        }

        // If status is PENDING, continue waiting
        if (status === "PENDING") {
          attempts++;
          continue;
        }

        attempts++;
      } catch (error) {
        // If error is about transaction not found, continue waiting
        if (error instanceof Error && error.message.includes("not found")) {
          attempts++;
          continue;
        }
        attempts++;
      }
    }

    throw new Error("Transaction still pending after waiting");
  }

  // ─── Evidence ─────────────────────────────────────────────────────────────

  /**
   * Read all on-chain evidence entries for an escrow/milestone pair.
   * Returns an array of { submitter, cid, submitted_at } objects.
   */
  async getEvidence(
    escrowId: number,
    milestoneIndex: number
  ): Promise<Array<{ submitter: string; cid: string; submitted_at: number }>> {
    this.syncFromConfig();
    this.assertValidContractId();

    const contract = new Contract(this.contractId);
    const sourceAddress =
      useWalletStore.getState().address ||
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

    const sourceAccount = {
      accountId: () => sourceAddress,
      sequenceNumber: () => "0",
      incrementSequenceNumber: () => {},
    } as any;

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: this.network.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "get_evidence",
          nativeToScVal(escrowId, { type: "u32" }),
          nativeToScVal(milestoneIndex, { type: "u32" })
        )
      )
      .setTimeout(30)
      .build();

    const simulation = await this.rpcServer.simulateTransaction(tx);

    if ("errorResult" in simulation && simulation.errorResult) {
      return [];
    }

    const result = (simulation as any).result?.retval;
    if (!result) return [];

    try {
      const native = scValToNative(result);
      if (!Array.isArray(native)) return [];
      return native.map((entry: any) => ({
        submitter: String(entry.submitter ?? ""),
        cid: String(entry.cid ?? ""),
        submitted_at: Number(entry.submitted_at ?? 0),
      }));
    } catch {
      return [];
    }
  }

  // ─── Emergency pause ─────────────────────────────────────────────────────────

  async isContractPaused(): Promise<boolean> {
    try {
      const rv = await this.simulateReadonly("is_contract_paused");
      return Boolean(scValToNative(rv));
    } catch {
      return false;
    }
  }

  async pauseContract(address?: string): Promise<string> {
    const walletAddress = address || useWalletStore.getState().address;
    if (!walletAddress) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction("pause_contract", [], walletAddress);
  }

  async unpauseContract(address?: string): Promise<string> {
    const walletAddress = address || useWalletStore.getState().address;
    if (!walletAddress) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction("unpause_contract", [], walletAddress);
  }

  // ─── Token blacklist ──────────────────────────────────────────────────────────

  async getBlacklistedTokens(): Promise<string[]> {
    try {
      const rv = await this.simulateReadonly("get_blacklisted_tokens");
      const native = scValToNative(rv) as any;
      if (!Array.isArray(native)) return [];
      return native.map((a) => String(a));
    } catch {
      return [];
    }
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      const rv = await this.simulateReadonly("is_token_blacklisted", [
        nativeToScVal(token, { type: "address" }),
      ]);
      return Boolean(scValToNative(rv));
    } catch {
      return false;
    }
  }

  async blacklistToken(token: string, address?: string): Promise<string> {
    const walletAddress = address || useWalletStore.getState().address;
    if (!walletAddress) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction(
      "blacklist_token",
      [nativeToScVal(token, { type: "address" })],
      walletAddress
    );
  }

  async unblacklistToken(token: string, address?: string): Promise<string> {
    const walletAddress = address || useWalletStore.getState().address;
    if (!walletAddress) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction(
      "unblacklist_token",
      [nativeToScVal(token, { type: "address" })],
      walletAddress
    );
  }

  // ─── Fee withdrawal ───────────────────────────────────────────────────────────

  async getWithdrawableFees(token?: string): Promise<string> {
    try {
      const tokenScVal = token
        ? nativeToScVal(token, { type: "address" })
        : xdr.ScVal.scvVoid();
      const rv = await this.simulateReadonly("get_withdrawable_fees", [tokenScVal]);
      const native = scValToNative(rv) as any;
      return String(native ?? "0");
    } catch {
      return "0";
    }
  }

  async withdrawFees(caller: string, token?: string): Promise<string> {
    if (!caller) throw new Error("Wallet not connected");
    const tokenScVal = token
      ? nativeToScVal(token, { type: "address" })
      : xdr.ScVal.scvVoid();
    return this.sendOwnerTransaction(
      "withdraw_fees",
      [tokenScVal, nativeToScVal(caller, { type: "address" })],
      caller
    );
  }

  // ─── Paginated applications ───────────────────────────────────────────────────

  async getApplicationsPage(
    escrowId: number,
    offset: number,
    limit: number
  ): Promise<Array<{ freelancer: string; cover_letter: string; proposed_timeline: number; applied_at: number }>> {
    try {
      const rv = await this.simulateReadonly("get_applications_page", [
        nativeToScVal(escrowId, { type: "u32" }),
        nativeToScVal(offset, { type: "u32" }),
        nativeToScVal(limit, { type: "u32" }),
      ]);
      const native = scValToNative(rv) as any;
      if (!Array.isArray(native)) return [];
      return native.map((a: any) => ({
        freelancer: String(a.freelancer ?? ""),
        cover_letter: String(a.cover_letter ?? ""),
        proposed_timeline: Number(a.proposed_timeline ?? 0),
        applied_at: Number(a.applied_at ?? 0),
      }));
    } catch {
      return [];
    }
  }

  async getApplicationCount(escrowId: number): Promise<number> {
    try {
      const rv = await this.simulateReadonly("get_application_count", [
        nativeToScVal(escrowId, { type: "u32" }),
      ]);
      return Number(scValToNative(rv) ?? 0);
    } catch {
      return 0;
    }
  }

  // ─── Milestone management ─────────────────────────────────────────────────────

  async addMilestone(
    escrowId: number,
    amount: string,
    description: string,
    depositor: string
  ): Promise<string> {
    if (!depositor) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction(
      "add_milestone",
      [
        nativeToScVal(escrowId, { type: "u32" }),
        nativeToScVal(BigInt(amount), { type: "i128" }),
        nativeToScVal(description, { type: "string" }),
        nativeToScVal(depositor, { type: "address" }),
      ],
      depositor
    );
  }

  async removeMilestone(
    escrowId: number,
    milestoneIndex: number,
    depositor: string
  ): Promise<string> {
    if (!depositor) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction(
      "remove_milestone",
      [
        nativeToScVal(escrowId, { type: "u32" }),
        nativeToScVal(milestoneIndex, { type: "u32" }),
        nativeToScVal(depositor, { type: "address" }),
      ],
      depositor
    );
  }

  /**
   * Submit on-chain evidence for a disputed milestone.
   * `submitter` must be the depositor, beneficiary, or an arbiter for the escrow.
   * `cid` is an IPFS CID, optionally suffixed with `|description`.
   */
  async submitEvidence(
    escrowId: number,
    milestoneIndex: number,
    submitter: string,
    cid: string
  ): Promise<string> {
    if (!submitter) throw new Error("Wallet not connected");
    if (!cid || cid.trim() === "") throw new Error("CID is required");

    const contract = new Contract(this.contractId);
    const sourceAccount = await this.rpcServer.getAccount(submitter);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: this.network.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "submit_evidence",
          nativeToScVal(escrowId, { type: "u32" }),
          nativeToScVal(milestoneIndex, { type: "u32" }),
          nativeToScVal(submitter, { type: "address" }),
          nativeToScVal(cid, { type: "string" })
        )
      )
      .setTimeout(30)
      .build();

    const simulation = await this.rpcServer.simulateTransaction(tx);

    if ("errorResult" in simulation && simulation.errorResult) {
      const errVal =
        (simulation.errorResult as any).value?.() ?? simulation.errorResult;
      throw new Error(`Simulation failed: ${errVal.toString()}`);
    }

    const authEntries =
      "auth" in simulation && Array.isArray((simulation as any).auth)
        ? (simulation as any).auth
        : [];

    const prepared = await this.rpcServer.prepareTransaction(tx);

    let finalTx: any = prepared;

    if (authEntries.length > 0) {
      const signedAuthEntries = await signAuthEntries(authEntries, submitter);
      const parsedAuth = signedAuthEntries.map((s: string) =>
        xdr.SorobanAuthorizationEntry.fromXDR(s, "base64")
      );

      const op = prepared.operations[0] as any;
      const hostFn = op.function || op.hostFunction;
      const newOp = Operation.invokeHostFunction({
        function: hostFn as xdr.HostFunction,
        auth: parsedAuth,
      } as any);

      const freshAccount = await this.rpcServer.getAccount(submitter);
      finalTx = new TransactionBuilder(freshAccount, {
        fee: prepared.fee,
        networkPassphrase: this.network.networkPassphrase,
      })
        .addOperation(newOp)
        .setSorobanData(
          (prepared as any).getSorobanData?.() ?? (prepared as any).sorobanData
        )
        .setTimeout(30)
        .build();
    }

    const signedXdr = await signTransaction({
      unsignedTransaction: (finalTx as any).toXDR(),
      address: submitter,
    });

    const signedTx = TransactionBuilder.fromXDR(
      signedXdr,
      this.network.networkPassphrase
    );
    const sendResponse = await this.rpcServer.sendTransaction(signedTx);

    if (sendResponse.status === "ERROR") {
      throw new Error(
        `Transaction failed: ${
          (sendResponse as any).errorResult?.toXDR("base64") ?? "unknown"
        }`
      );
    }

    return sendResponse.hash;
  }

  // ─── Job cancellation & fund management ──────────────────────────────────────

  async cancelJob(escrowId: number, depositor: string): Promise<string> {
    if (!depositor) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction(
      "cancel_job",
      [
        nativeToScVal(escrowId, { type: "u32" }),
        nativeToScVal(depositor, { type: "address" }),
      ],
      depositor
    );
  }

  async addJobFunds(
    escrowId: number,
    depositor: string,
    additionalAmount: string,
    milestoneIndex: number
  ): Promise<string> {
    if (!depositor) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction(
      "add_job_funds",
      [
        nativeToScVal(escrowId, { type: "u32" }),
        nativeToScVal(depositor, { type: "address" }),
        nativeToScVal(BigInt(additionalAmount), { type: "i128" }),
        nativeToScVal(milestoneIndex, { type: "u32" }),
      ],
      depositor
    );
  }

  async withdrawJobFunds(
    escrowId: number,
    depositor: string,
    withdrawAmount: string,
    milestoneIndex: number
  ): Promise<string> {
    if (!depositor) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction(
      "withdraw_job_funds",
      [
        nativeToScVal(escrowId, { type: "u32" }),
        nativeToScVal(depositor, { type: "address" }),
        nativeToScVal(BigInt(withdrawAmount), { type: "i128" }),
        nativeToScVal(milestoneIndex, { type: "u32" }),
      ],
      depositor
    );
  }

  // ─── Milestone negotiation ────────────────────────────────────────────────────

  async proposeMilestoneChange(
    escrowId: number,
    milestoneIndex: number,
    proposedAmount: string,
    proposedDescription: string | null,
    freelancer: string
  ): Promise<string> {
    if (!freelancer) throw new Error("Wallet not connected");
    const descScVal = proposedDescription
      ? nativeToScVal(proposedDescription, { type: "string" })
      : xdr.ScVal.scvVoid();
    return this.sendOwnerTransaction(
      "propose_milestone_change",
      [
        nativeToScVal(escrowId, { type: "u32" }),
        nativeToScVal(milestoneIndex, { type: "u32" }),
        nativeToScVal(BigInt(proposedAmount), { type: "i128" }),
        descScVal,
        nativeToScVal(freelancer, { type: "address" }),
      ],
      freelancer
    );
  }

  async approveMilestoneProposal(
    escrowId: number,
    milestoneIndex: number,
    depositor: string
  ): Promise<string> {
    if (!depositor) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction(
      "approve_milestone_proposal",
      [
        nativeToScVal(escrowId, { type: "u32" }),
        nativeToScVal(milestoneIndex, { type: "u32" }),
        nativeToScVal(depositor, { type: "address" }),
      ],
      depositor
    );
  }

  async rejectMilestoneProposal(
    escrowId: number,
    milestoneIndex: number,
    depositor: string
  ): Promise<string> {
    if (!depositor) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction(
      "reject_milestone_proposal",
      [
        nativeToScVal(escrowId, { type: "u32" }),
        nativeToScVal(milestoneIndex, { type: "u32" }),
        nativeToScVal(depositor, { type: "address" }),
      ],
      depositor
    );
  }

  // ─── Per-milestone multi-sig dispute resolution ───────────────────────────────

  async resolveDispute(
    escrowId: number,
    milestoneIndex: number,
    arbiter: string,
    freelancerAmount: string,
    clientAmount: string,
    reason: string
  ): Promise<string> {
    if (!arbiter) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction(
      "resolve_dispute",
      [
        nativeToScVal(escrowId, { type: "u32" }),
        nativeToScVal(milestoneIndex, { type: "u32" }),
        nativeToScVal(arbiter, { type: "address" }),
        nativeToScVal(BigInt(freelancerAmount), { type: "i128" }),
        nativeToScVal(BigInt(clientAmount), { type: "i128" }),
        nativeToScVal(reason, { type: "string" }),
      ],
      arbiter
    );
  }

  // ─── Escrow deletion ──────────────────────────────────────────────────────────

  async deleteEscrow(escrowId: number, ownerAddress?: string): Promise<string> {
    const walletAddress = ownerAddress || useWalletStore.getState().address;
    if (!walletAddress) throw new Error("Wallet not connected");
    return this.sendOwnerTransaction(
      "delete_escrow",
      [nativeToScVal(escrowId, { type: "u32" })],
      walletAddress
    );
  }

  // ─── Dispute vote & cancellation views ───────────────────────────────────────

  async getDisputeVoteCount(escrowId: number): Promise<number> {
    try {
      const rv = await this.simulateReadonly("get_dispute_vote_count", [
        nativeToScVal(escrowId, { type: "u32" }),
      ]);
      return Number(scValToNative(rv) ?? 0);
    } catch {
      return 0;
    }
  }

  async hasDisputeVoted(escrowId: number, arbiter: string): Promise<boolean> {
    try {
      const rv = await this.simulateReadonly("has_dispute_voted", [
        nativeToScVal(escrowId, { type: "u32" }),
        nativeToScVal(arbiter, { type: "address" }),
      ]);
      return Boolean(scValToNative(rv));
    } catch {
      return false;
    }
  }

  async getUserCancellations(user: string): Promise<number> {
    try {
      const rv = await this.simulateReadonly("get_user_cancellations", [
        nativeToScVal(user, { type: "address" }),
      ]);
      return Number(scValToNative(rv) ?? 0);
    } catch {
      return 0;
    }
  }
}

// Export singleton instance
export const contractService = new ContractService();
