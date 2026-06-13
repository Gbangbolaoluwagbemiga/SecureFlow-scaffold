import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { getCurrentNetwork } from "@/lib/web3/stellar-config";
import type { WalletState } from "@/lib/web3/types";
import useWalletStore from "@/store/wallet.store";
import { useToast } from "@/hooks/use-toast";
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
import {
  wallet,
  connectWallet as connectWalletUtil,
  disconnectWallet as disconnectWalletUtil,
} from "@/util/wallet";
import { useWallet } from "@/hooks/useWallet";
import storage from "@/util/storage";
import { Client as SecureFlowClient } from "@/contracts/generated/src/index";

interface Web3ContextType {
  wallet: WalletState;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  switchNetwork: (network: "testnet" | "mainnet" | "local") => Promise<void>;
  getContract: (contractId: string) => any;
  isOwner: boolean;
  network: ReturnType<typeof getCurrentNetwork>;
  refreshBalance: () => Promise<void>;
}

const Web3Context = createContext<Web3ContextType | undefined>(undefined);

export function Web3Provider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const { signTransaction: walletSignTransaction } = useWallet();
  const [walletState, setWalletState] = useState<WalletState>({
    address: null,
    chainId: null,
    isConnected: false,
    balance: "0",
  });
  const [isOwner, setIsOwner] = useState(false);
  const network = getCurrentNetwork();

  // Keep Zustand wallet store in sync with context state so contract-service
  // methods that call useWalletStore.getState().address always get a valid address.
  useEffect(() => {
    const { connectWalletStore, disconnectWalletStore } =
      useWalletStore.getState();
    const networkName = (import.meta.env.VITE_STELLAR_NETWORK || "testnet") as
      | "testnet"
      | "mainnet"
      | "local";
    if (walletState.address && walletState.isConnected) {
      connectWalletStore(
        walletState.address,
        networkName,
        "",
        walletState.address,
      );
    } else {
      disconnectWalletStore();
    }
  }, [walletState.address, walletState.isConnected]);

  // Lazy initialization of RPC server to avoid undefined errors
  const getRpcServer = useMemo(() => {
    if (!rpc || !rpc.Server) {
      return null;
    }
    return () => new rpc.Server(network.rpcUrl);
  }, [network.rpcUrl]);

  const createRpcServer = () => {
    if (!getRpcServer) {
      throw new Error(
        "rpc.Server is not available. Please check @stellar/stellar-sdk installation.",
      );
    }
    return getRpcServer();
  };

  useEffect(() => {
    checkConnection();

    // Periodically refresh balance from Horizon (avoids stale closure — reads from storage directly)
    const interval = setInterval(async () => {
      const walletId = storage.getItem("walletId");
      const walletAddr = storage.getItem("walletAddress");
      if (!walletId || !walletAddr) return;
      try {
        const { Horizon } = await import("@stellar/stellar-sdk");
        const horizonUrl = network.horizonUrl || "https://horizon-testnet.stellar.org";
        const horizon = new Horizon.Server(horizonUrl);
        const account = await horizon.accounts().accountId(walletAddr).call();
        const nativeBalance = account.balances.find((b: any) => b.asset_type === "native");
        if (nativeBalance) {
          setWalletState((prev) => ({
            ...prev,
            address: walletAddr,
            isConnected: true,
            balance: parseFloat(nativeBalance.balance).toFixed(7),
          }));
        }
      } catch {
        // Network error — keep existing balance, ensure connection state is set
        const walletAddr2 = storage.getItem("walletAddress");
        if (walletAddr2) {
          setWalletState((prev) => ({
            ...prev,
            address: walletAddr2,
            isConnected: true,
          }));
        }
      }
    }, 30000); // Every 30 seconds

    return () => {
      clearInterval(interval);
    };
  }, []);

  const checkConnection = async () => {
    try {
      const walletId = storage.getItem("walletId");
      const walletAddr = storage.getItem("walletAddress");

      if (walletId && walletAddr) {
        // If we already have the address in storage and state matches,
        // just fetch balance without calling wallet.getAddress() (which opens popup)
        if (walletState.isConnected && walletState.address === walletAddr) {
          // Just refresh balance, don't call wallet methods
          // Only refresh if we don't already have a valid balance
          // This prevents unnecessary API calls and balance resets
          if (!walletState.balance || walletState.balance === "0") {
            try {
              const { Horizon } = await import("@stellar/stellar-sdk");
              const horizonUrl =
                network.horizonUrl || "https://horizon-testnet.stellar.org";
              const horizon = new Horizon.Server(horizonUrl);

              const account = await horizon
                .accounts()
                .accountId(walletAddr)
                .call();
              const nativeBalance = account.balances.find(
                (b: any) => b.asset_type === "native",
              );

              const fullBalance = nativeBalance
                ? parseFloat(nativeBalance.balance)
                : null;

              // Only update balance if we successfully fetched it
              // If nativeBalance is not found, keep existing balance
              if (fullBalance !== null) {
                setWalletState((prev) => ({
                  ...prev,
                  balance: fullBalance.toFixed(7),
                }));
              }
              // If nativeBalance is null, keep existing balance (don't reset to 0)
            } catch (error: any) {
              // Balance fetch failed, but keep connection state and existing balance
              // Don't reset balance to 0 if fetch fails - keep existing balance
            }
          }
          return;
        }

        // Only call wallet.getAddress() if we don't have state or it doesn't match
        try {
          wallet.setWallet(walletId);
          const addressResult = await wallet.getAddress();
          const publicKey = addressResult.address;

          if (publicKey) {
            // Get balance from Horizon API (more reliable than RPC)
            try {
              const { Horizon } = await import("@stellar/stellar-sdk");
              const horizonUrl =
                network.horizonUrl || "https://horizon-testnet.stellar.org";
              const horizon = new Horizon.Server(horizonUrl);

              const account = await horizon
                .accounts()
                .accountId(publicKey)
                .call();
              const nativeBalance = account.balances.find(
                (b: any) => b.asset_type === "native",
              );

              // Get full precision balance from blockchain
              const fullBalance = nativeBalance
                ? parseFloat(nativeBalance.balance)
                : null;

              // Only set balance if we successfully fetched it
              // If nativeBalance is not found, keep existing balance or use 0 as fallback
              setWalletState((prev) => ({
                address: publicKey,
                chainId: null, // Stellar doesn't use chain IDs
                isConnected: true,
                balance:
                  fullBalance !== null
                    ? fullBalance.toFixed(7)
                    : prev.balance || "0", // Use 7 decimals for XLM (full precision)
              }));

              await checkOwnerStatus(publicKey);
            } catch (error: any) {
              // If account doesn't exist yet, still set connected
              // Keep existing balance if available, don't reset to 0
              setWalletState((prev) => ({
                address: publicKey,
                chainId: null,
                isConnected: true,
                balance: prev.balance || "0", // Keep existing balance if fetch fails
              }));
              await checkOwnerStatus(publicKey);
            }
          }
        } catch (error) {
          // Wallet not connected
        }
      }
    } catch (error) {
      // Wallet not available or not connected
    }
  };

  const checkOwnerStatus = async (address: string) => {
    try {
      // Check if address matches known owner
      // This should be set from environment or contract
      const knownOwner = import.meta.env.VITE_OWNER_ADDRESS || "";
      setIsOwner(address === knownOwner);
    } catch (error) {
      setIsOwner(false);
    }
  };

  const connectWallet = async () => {
    try {
      // Use Stellar Wallets Kit to connect
      await connectWalletUtil();

      // Wait a bit for storage to update
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check connection
      const walletId = storage.getItem("walletId");
      const walletAddr = storage.getItem("walletAddress");

      if (walletId && walletAddr) {
        wallet.setWallet(walletId);
        // Avoid calling `getAddress()` again here (it may re-open a wallet popup,
        // and some wallets intermittently fail during HMR / tab focus changes).
        // `connectWalletUtil()` already populated storage once the user approved.
        const publicKey = walletAddr;

        if (!publicKey) {
          toast({
            title: "Connection failed",
            description: "Could not get wallet address",
            variant: "destructive",
          });
          return;
        }

        // Get balance from Horizon API (more reliable than RPC)
        try {
          const { Horizon } = await import("@stellar/stellar-sdk");
          const horizonUrl =
            network.horizonUrl || "https://horizon-testnet.stellar.org";
          const horizon = new Horizon.Server(horizonUrl);

          const account = await horizon.accounts().accountId(publicKey).call();
          const nativeBalance = account.balances.find(
            (b: any) => b.asset_type === "native",
          );

          // Get full precision balance from blockchain
          const fullBalance = nativeBalance
            ? parseFloat(nativeBalance.balance)
            : null;

          // Only set balance if we successfully fetched it
          // If nativeBalance is not found, keep existing balance or use 0 as fallback
          setWalletState((prev) => ({
            address: publicKey,
            chainId: null,
            isConnected: true,
            balance:
              fullBalance !== null
                ? fullBalance.toFixed(7)
                : prev.balance || "0", // Use 7 decimals for XLM (full precision)
          }));

          await checkOwnerStatus(publicKey);

          toast({
            title: "Wallet connected",
            description: `Connected to ${publicKey.slice(
              0,
              6,
            )}...${publicKey.slice(-4)}`,
          });
        } catch (error: any) {
          // Account might not exist yet
          // Keep existing balance if available, don't reset to 0
          setWalletState((prev) => ({
            address: publicKey,
            chainId: null,
            isConnected: true,
            balance: prev.balance || "0", // Keep existing balance if fetch fails
          }));
          await checkOwnerStatus(publicKey);

          toast({
            title: "Wallet connected",
            description: `Connected to ${publicKey.slice(
              0,
              6,
            )}...${publicKey.slice(-4)}`,
          });
        }
      } else {
        toast({
          title: "Connection cancelled",
          description: "Please connect your wallet to continue",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Connection failed",
        description:
          error.message ||
          "Failed to connect wallet. Please install a Stellar wallet.",
        variant: "destructive",
      });
    }
  };

  const disconnectWallet = async () => {
    await disconnectWalletUtil();
    setWalletState({
      address: null,
      chainId: null,
      isConnected: false,
      balance: "0",
    });
    setIsOwner(false);
    toast({
      title: "Wallet disconnected",
      description: "Your wallet has been disconnected",
    });
  };

  const switchNetwork = async (
    targetNetwork: "testnet" | "mainnet" | "local",
  ) => {
    // Stellar networks are handled via environment variables
    // This is mainly for UI feedback
    toast({
      title: "Network switch",
      description: `Switching to ${targetNetwork}. Please update VITE_STELLAR_NETWORK in .env`,
    });
  };

  const getContract = (contractId: string) => {
    if (!contractId || contractId === "") {
      return null;
    }

    // Use the generated contract client for type-safe contract interactions
    const client = new SecureFlowClient({
      contractId,
      networkPassphrase: network.networkPassphrase,
      rpcUrl: network.rpcUrl,
    });

    // Return a wrapper that provides both the generated client and a compatible interface
    return {
      // Generated client with all typed methods
      client,

      // Legacy call interface for backward compatibility
      async call(method: string, ...args: any[]) {
        try {
          // Use the generated client's methods for read operations
          if (method === "get_escrow" && args[0] !== undefined) {
            const assembledTx = await client.get_escrow({ escrow_id: args[0] });
            // The client automatically simulates, so we can access the result directly
            return assembledTx.result;
          }

          if (method === "get_user_escrows" && args[0] !== undefined) {
            const assembledTx = await client.get_user_escrows({
              user: args[0],
            });
            return assembledTx.result;
          }

          if (method === "get_reputation" && args[0] !== undefined) {
            const assembledTx = await client.get_reputation({ user: args[0] });
            return assembledTx.result;
          }

          if (method === "owner" || method === "get_owner") {
            // Use ContractService to read owner from contract storage
            const { ContractService } = await import(
              "@/lib/web3/contract-service"
            );
            const contractService = new ContractService(contractId);
            return await contractService.getOwner();
          }

          if (method === "next_escrow_id") {
            // The contract stores NextEscrowId in instance storage with DataKey::NextEscrowId
            // For now, return a default value (1 means no escrows created yet)
            // In production, this should be read from contract storage
            // TODO: Implement proper contract storage reading for NextEscrowId
            try {
              // Try to read from contract storage if possible
              // For now, return 1 as default (no escrows created)
              return 1;
            } catch (error) {
              return 1;
            }
          }

          if (method === "paused" || method === "is_job_creation_paused") {
            // Check if job creation is paused
            try {
              // Use the contract directly since the generated client might not have this method yet
              const contract = new Contract(contractId);
              const server = createRpcServer();

              // Build a transaction with the contract call
              const sourceAccount = await server.getAccount(
                walletState.address ||
                  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
              );
              const op = contract.call("is_job_creation_paused");
              const tx = new TransactionBuilder(sourceAccount, {
                fee: "100",
                networkPassphrase: network.networkPassphrase,
              })
                .addOperation(op)
                .setTimeout(30)
                .build();

              // Call is_job_creation_paused method
              const result = await server.simulateTransaction(tx);

              // Check if simulation failed
              if ("errorResult" in result && result.errorResult) {
                return false; // Default to not paused
              }

              // Check if simulation succeeded
              if ("returnValue" in result && result.returnValue) {
                try {
                  // Check if returnValue is a valid ScVal (has switch method)
                  const returnVal = result.returnValue as any;
                  if (
                    returnVal &&
                    typeof returnVal === "object" &&
                    typeof returnVal.switch === "function"
                  ) {
                    return scValToNative(returnVal as any);
                  }
                  return result.returnValue;
                } catch {
                  return result.returnValue;
                }
              }

              return false; // Default to not paused
            } catch (error) {
              return false; // Default to not paused
            }
          }

          // Fallback for methods not in the map
          // Some methods like next_escrow_id don't exist as contract methods
          // They should be handled above, but if we get here, return a safe default
          if (method === "next_escrow_id") {
            return 1; // Default: no escrows created yet
          }

          try {
            const contract = new Contract(contractId);
            const server = createRpcServer();

            const methodArgs = args.map((arg) => {
              if (typeof arg === "string") {
                try {
                  return Address.fromString(arg).toScVal();
                } catch {
                  return nativeToScVal(arg, { type: "string" });
                }
              } else if (typeof arg === "number") {
                return nativeToScVal(arg, { type: "i128" });
              } else if (typeof arg === "boolean") {
                return nativeToScVal(arg, { type: "bool" });
              }
              return nativeToScVal(arg);
            });

            // Build a transaction with the contract call
            const sourceAccount = await server.getAccount(
              walletState.address ||
                "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
            );
            const op = contract.call(method, ...methodArgs);
            const tx = new TransactionBuilder(sourceAccount, {
              fee: "100",
              networkPassphrase: network.networkPassphrase,
            })
              .addOperation(op)
              .setTimeout(30)
              .build();

            const result = await server.simulateTransaction(tx);

            // Check if simulation failed
            if ("errorResult" in result && result.errorResult) {
              const errorValue =
                (result.errorResult as any).value?.() || result.errorResult;
              throw new Error(errorValue.toString());
            }

            // Check if simulation succeeded
            if ("returnValue" in result && result.returnValue) {
              try {
                // Check if returnValue is a valid ScVal (has switch method)
                const returnVal = result.returnValue as any;
                if (
                  returnVal &&
                  typeof returnVal === "object" &&
                  typeof returnVal.switch === "function"
                ) {
                  return scValToNative(returnVal as any);
                }
                return result.returnValue;
              } catch {
                return result.returnValue;
              }
            }

            return result;
          } catch (fallbackError: any) {
            // If fallback also fails, return a safe default for known methods
            if (method === "next_escrow_id") {
              return 1;
            }
            throw fallbackError;
          }
        } catch (error) {
          throw error;
        }
      },

      // Legacy send interface for backward compatibility
      async send(method: string, ...args: any[]) {
        try {
          if (!walletState.isConnected || !walletState.address) {
            throw new Error("Wallet not connected");
          }

          // Use the generated client's methods for sending transactions
          let assembledTx: any;

          if (method === "create_escrow" && args[0]) {
            try {
              // Convert null to undefined for Option types
              // The generated client expects Option<string> which uses undefined for None
              const createArgs = {
                ...args[0],
                beneficiary: args[0].beneficiary ?? undefined,
                token: args[0].token ?? undefined,
              };
              assembledTx = await client.create_escrow(createArgs);
            } catch (createError: any) {
              throw createError;
            }
          } else if (method === "start_work" && args[0]) {
            assembledTx = await client.start_work(args[0]);
          } else if (method === "submit_milestone" && args[0]) {
            assembledTx = await client.submit_milestone(args[0]);
          } else if (method === "approve_milestone" && args[0]) {
            assembledTx = await client.approve_milestone(args[0]);
          } else if (method === "apply_to_job" && args[0]) {
            // Build transaction manually like create_escrow to ensure proper address conversion
            const freelancerAddress =
              args[0].freelancer || walletState.address || "";

            if (!freelancerAddress) {
              throw new Error("Freelancer address is required");
            }

            const contract = new Contract(contractId);
            const server = createRpcServer();
            const sourceAccount = await server.getAccount(walletState.address!);

            // Convert parameters to ScVal format - CRITICAL: convert address properly
            const escrowIdScVal = nativeToScVal(args[0].escrow_id, {
              type: "u32",
            });
            const coverLetterScVal = nativeToScVal(args[0].cover_letter, {
              type: "string",
            });
            const proposedTimelineScVal = nativeToScVal(
              args[0].proposed_timeline,
              { type: "u32" },
            );
            const freelancerScVal = nativeToScVal(freelancerAddress, {
              type: "address",
            });

            // Build transaction
            const tx = new TransactionBuilder(sourceAccount, {
              fee: "100",
              networkPassphrase: network.networkPassphrase,
            })
              .addOperation(
                contract.call(
                  "apply_to_job",
                  escrowIdScVal,
                  coverLetterScVal,
                  proposedTimelineScVal,
                  freelancerScVal,
                ),
              )
              .setTimeout(30)
              .build();

            // Simulate to check for errors and get auth entries
            const simulation = await server.simulateTransaction(tx);

            // Check for auth entries
            const authEntries =
              "auth" in simulation &&
              simulation.auth &&
              Array.isArray(simulation.auth)
                ? simulation.auth
                : [];

            // Check if simulation failed
            if ("errorResult" in simulation && simulation.errorResult) {
              const errorValue =
                (simulation.errorResult as any).value?.() ||
                simulation.errorResult;
              throw new Error(
                `Transaction simulation failed: ${errorValue.toString()}`,
              );
            }

            // Prepare transaction
            const prepared = await server.prepareTransaction(tx);

            // Handle auth entries if needed
            if (authEntries.length > 0) {
              const signedAuthEntries = await Promise.all(
                authEntries.map(async (entry: any) => {
                  const entryXdr = entry.toXDR("base64");
                  const signed = await wallet.signAuthEntry(entryXdr, {
                    networkPassphrase: network.networkPassphrase,
                    address: freelancerAddress,
                  });
                  return (
                    (signed as any).signedAuthEntry ||
                    (signed as any).signedAuthEntryXdr ||
                    entryXdr
                  );
                }),
              );

              // Rebuild transaction with signed auth entries
              const { xdr } = await import("@stellar/stellar-sdk");
              const parsedSignedAuth = signedAuthEntries.map((signed: string) =>
                xdr.SorobanAuthorizationEntry.fromXDR(signed, "base64"),
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

                  // Get fresh account for rebuilding
                  const freshAccount = await server.getAccount(
                    walletState.address!,
                  );
                  const newTx = new TransactionBuilder(freshAccount, {
                    fee: prepared.fee,
                    networkPassphrase: network.networkPassphrase,
                  })
                    .addOperation(newOp)
                    .setTimeout(30)
                    .build();

                  const newPrepared = await server.prepareTransaction(newTx);
                  assembledTx = {
                    toXDR: () => newPrepared.toXDR(),
                    built: newPrepared,
                  } as any;
                } else {
                  assembledTx = {
                    toXDR: () => prepared.toXDR(),
                    built: prepared,
                  } as any;
                }
              } else {
                assembledTx = {
                  toXDR: () => prepared.toXDR(),
                  built: prepared,
                } as any;
              }
            } else {
              assembledTx = {
                toXDR: () => prepared.toXDR(),
                built: prepared,
              } as any;
            }
          } else if (method === "accept_freelancer" && args[0]) {
            assembledTx = await client.accept_freelancer(args[0]);
          } else if (method === "refund_escrow" && args[0]) {
            assembledTx = await client.refund_escrow(args[0]);
          } else if (method === "emergency_refund_after_deadline" && args[0]) {
            assembledTx = await client.emergency_refund_after_deadline(args[0]);
          } else if (method === "extend_deadline" && args[0]) {
            assembledTx = await client.extend_deadline(args[0]);
          } else if (method === "set_platform_fee_bp" && args[0]) {
            assembledTx = await client.set_platform_fee_bp(args[0]);
          } else if (method === "set_fee_collector" && args[0]) {
            assembledTx = await client.set_fee_collector(args[0]);
          } else if (method === "whitelist_token" && args[0]) {
            assembledTx = await client.whitelist_token(args[0]);
          } else if (method === "authorize_arbiter" && args[0]) {
            assembledTx = await client.authorize_arbiter(args[0]);
          } else if (method === "set_job_creation_paused") {
            // Handle set_job_creation_paused(bool) - args[0] is the boolean value
            const paused =
              args[0] === true || args[0] === "true" || args[0] === 1;

            const contract = new Contract(contractId);
            const server = createRpcServer();
            const sourceAccount = await server.getAccount(walletState.address!);

            // Convert boolean to ScVal
            const pausedScVal = nativeToScVal(paused, { type: "bool" });

            const tx = new TransactionBuilder(sourceAccount, {
              fee: "100",
              networkPassphrase: network.networkPassphrase,
            })
              .addOperation(
                contract.call("set_job_creation_paused", pausedScVal),
              )
              .setTimeout(30)
              .build();

            // Simulate to check for errors and get auth entries
            const simulation = await server.simulateTransaction(tx);
            // Check for auth entries in the simulation result
            const authEntries =
              "auth" in simulation &&
              simulation.auth &&
              Array.isArray(simulation.auth)
                ? simulation.auth
                : [];

            // Check if simulation failed
            if ("errorResult" in simulation && simulation.errorResult) {
              const errorValue =
                (simulation.errorResult as any).value?.() ||
                simulation.errorResult;
              throw new Error(
                `Transaction simulation failed: ${errorValue.toString()}`,
              );
            }

            // Prepare transaction (includes auth entries if needed)
            const prepared = await server.prepareTransaction(tx);

            // Check if simulation returned auth entries that need to be signed
            if (authEntries && authEntries.length > 0) {
              if (!walletState.address) {
                throw new Error(
                  "Wallet address is required to sign auth entries",
                );
              }

              const signedAuthEntries = await Promise.all(
                authEntries.map(async (entry: any) => {
                  const entryXdr = entry.toXDR("base64");
                  const signed = await wallet.signAuthEntry(entryXdr, {
                    networkPassphrase: network.networkPassphrase,
                    address: walletState.address!,
                  });
                  return (
                    (signed as any).signedAuthEntry ||
                    (signed as any).signedAuthEntryXdr ||
                    entryXdr
                  );
                }),
              );

              if (!signedAuthEntries || signedAuthEntries.length === 0) {
                throw new Error("Failed to sign auth entries");
              }

              // Rebuild the transaction with signed auth entries
              const txXdr = prepared.toXDR();
              const txWithAuth = TransactionBuilder.fromXDR(
                txXdr,
                network.networkPassphrase,
              );

              // Replace auth entries in the operation
              // Parse signed auth entries first
              const { xdr } = await import("@stellar/stellar-sdk");
              const parsedSignedAuth = signedAuthEntries.map((signed: string) =>
                xdr.SorobanAuthorizationEntry.fromXDR(signed, "base64"),
              );

              // Rebuild the transaction with signed auth entries
              // Use the original transaction structure but inject signed auth entries
              const operations = txWithAuth.operations;
              if (operations && operations.length > 0) {
                const op = operations[0];
                if (op.type === "invokeHostFunction") {
                  // Get the host function from the original operation
                  const hostFn =
                    (op as any).function || (op as any).hostFunction;

                  // Create a new InvokeHostFunction operation with signed auth entries
                  // Use Operation.invokeHostFunction with the host function and signed auth
                  const newOp = Operation.invokeHostFunction({
                    function: hostFn as any,
                    auth: parsedSignedAuth,
                  } as any);

                  // Get fresh account to ensure correct sequence number
                  const freshAccount = await server.getAccount(
                    walletState.address!,
                  );

                  // Build transaction with the new operation
                  const timeout =
                    (txWithAuth as any).maxTime ||
                    (txWithAuth as any).timeBounds?.maxTime ||
                    30;
                  const newTx = new TransactionBuilder(freshAccount, {
                    fee: txWithAuth.fee,
                    networkPassphrase: network.networkPassphrase,
                  })
                    .addOperation(newOp)
                    .setTimeout(timeout)
                    .build();

                  // Prepare the new transaction (to get resource fees)
                  const newPrepared = await server.prepareTransaction(newTx);

                  // Sign the rebuilt transaction with the currently active wallet
                  const signResult = await wallet.signTransaction(
                    newPrepared.toXDR(),
                    {
                      networkPassphrase: network.networkPassphrase,
                      address: walletState.address,
                    },
                  );

                  if (!signResult || !signResult.signedTxXdr) {
                    throw new Error(
                      "Transaction signing failed - no signed transaction received",
                    );
                  }

                  // Parse the signed XDR back into a Transaction object
                  const signedTransaction = TransactionBuilder.fromXDR(
                    signResult.signedTxXdr,
                    network.networkPassphrase,
                  );

                  // Send the signed transaction via RPC
                  const sendResponse =
                    await server.sendTransaction(signedTransaction);

                  // Check for errors in the response
                  if (
                    sendResponse.status === "ERROR" ||
                    ("errorResult" in sendResponse && sendResponse.errorResult)
                  ) {
                    let errorMessage = "Transaction failed";
                    const errorResult =
                      "errorResult" in sendResponse && sendResponse.errorResult
                        ? sendResponse.errorResult
                        : null;
                    if (errorResult) {
                      try {
                        let errorValue: any = errorResult;
                        if (typeof (errorValue as any).value === "function") {
                          errorValue = (errorValue as any).value();
                        } else if ((errorValue as any).value) {
                          errorValue = (errorValue as any).value;
                        }
                        if (typeof errorValue === "string") {
                          errorMessage = `Transaction failed: ${errorValue}`;
                        } else if (errorValue?.message) {
                          errorMessage = `Transaction failed: ${errorValue.message}`;
                        } else if (errorValue?.toString) {
                          errorMessage = `Transaction failed: ${errorValue.toString()}`;
                        } else {
                          errorMessage = `Transaction failed: ${JSON.stringify(errorValue)}`;
                        }
                      } catch (e) {
                        errorMessage = `Transaction failed: ${JSON.stringify(errorResult)}`;
                      }
                    }
                    throw new Error(errorMessage);
                  }

                  // Wait for transaction confirmation if status is PENDING
                  if (sendResponse.status === "PENDING" && sendResponse.hash) {
                    // Poll for transaction status
                    let attempts = 0;
                    const maxAttempts = 30; // Wait up to 30 seconds
                    let txStatus = sendResponse;

                    while (
                      attempts < maxAttempts &&
                      txStatus.status === "PENDING"
                    ) {
                      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
                      try {
                        const txResponse = await server.getTransaction(
                          sendResponse.hash,
                        );
                        // getTransaction returns GetTransactionResponse, extract the transaction
                        txStatus =
                          "status" in txResponse
                            ? txResponse
                            : (txResponse as any).transaction || txResponse;
                        attempts++;
                      } catch (error) {
                        attempts++;
                      }
                    }

                    const txStatusValue = (txStatus as any).status || txStatus;
                    if (txStatusValue === "PENDING") {
                      throw new Error(
                        "Transaction still pending after waiting. It may have failed.",
                      );
                    }

                    const errorResult =
                      (txStatus as any).errorResult || txStatus.errorResult;
                    if (txStatusValue === "ERROR" || errorResult) {
                      let errorMessage = "Transaction failed";
                      if (errorResult) {
                        try {
                          let errorValue: any = errorResult;
                          // Handle different error result structures
                          if (typeof errorValue === "object") {
                            if (typeof errorValue.value === "function") {
                              errorValue = errorValue.value();
                            } else if (errorValue.value !== undefined) {
                              errorValue = errorValue.value;
                            } else if (errorValue.error !== undefined) {
                              errorValue = errorValue.error;
                            }
                          }
                          if (typeof errorValue === "string") {
                            errorMessage = `Transaction failed: ${errorValue}`;
                          } else if (
                            errorValue &&
                            typeof errorValue === "object" &&
                            "message" in errorValue
                          ) {
                            errorMessage = `Transaction failed: ${errorValue.message}`;
                          } else if (
                            errorValue &&
                            typeof errorValue.toString === "function"
                          ) {
                            errorMessage = `Transaction failed: ${errorValue.toString()}`;
                          } else {
                            errorMessage = `Transaction failed: ${JSON.stringify(errorValue)}`;
                          }
                        } catch (e) {
                          errorMessage = `Transaction failed: ${JSON.stringify(errorResult)}`;
                        }
                      }
                      throw new Error(errorMessage);
                    }

                    return txStatus;
                  }

                  // Return success - skip the normal signing flow
                  return sendResponse;
                } else {
                  throw new Error("Unexpected operation type");
                }
              } else {
                throw new Error("No operations in transaction");
              }
            } else {
              // No auth entries, just use the prepared transaction
              assembledTx = {
                toXDR: () => prepared.toXDR(),
              } as any;
            }
          } else if (method === "pause_job_creation") {
            // Legacy method - use set_job_creation_paused(true) logic
            const contract = new Contract(contractId);
            const server = createRpcServer();
            const sourceAccount = await server.getAccount(walletState.address!);
            const pausedScVal = nativeToScVal(true, { type: "bool" });
            const tx = new TransactionBuilder(sourceAccount, {
              fee: "100",
              networkPassphrase: network.networkPassphrase,
            })
              .addOperation(
                contract.call("set_job_creation_paused", pausedScVal),
              )
              .setTimeout(30)
              .build();
            const simulation = await server.simulateTransaction(tx);
            // Check if simulation failed
            if ("errorResult" in simulation && simulation.errorResult) {
              const errorValue =
                (simulation.errorResult as any).value?.() ||
                simulation.errorResult;
              throw new Error(
                `Transaction simulation failed: ${errorValue.toString()}`,
              );
            }
            const prepared = await server.prepareTransaction(tx);
            assembledTx = {
              toXDR: () => prepared.toXDR(),
            } as any;
          } else if (method === "unpause_job_creation") {
            // Legacy method - use set_job_creation_paused(false) logic
            const contract = new Contract(contractId);
            const server = createRpcServer();
            const sourceAccount = await server.getAccount(walletState.address!);
            const pausedScVal = nativeToScVal(false, { type: "bool" });
            const tx = new TransactionBuilder(sourceAccount, {
              fee: "100",
              networkPassphrase: network.networkPassphrase,
            })
              .addOperation(
                contract.call("set_job_creation_paused", pausedScVal),
              )
              .setTimeout(30)
              .build();
            const simulation = await server.simulateTransaction(tx);
            // Check if simulation failed
            if ("errorResult" in simulation && simulation.errorResult) {
              const errorValue =
                (simulation.errorResult as any).value?.() ||
                simulation.errorResult;
              throw new Error(
                `Transaction simulation failed: ${errorValue.toString()}`,
              );
            }
            const prepared = await server.prepareTransaction(tx);
            assembledTx = {
              toXDR: () => prepared.toXDR(),
            } as any;
          } else {
            throw new Error(
              `Method ${method} not supported in generated client`,
            );
          }

          // Sign and send manually (like create_escrow)

          try {
            // Use signTransaction from WalletProvider if available, otherwise fallback to wallet instance
            const signTx = walletSignTransaction || wallet.signTransaction;

            if (!signTx) {
              throw new Error("signTransaction method is not available");
            }

            if (!walletState.address) {
              throw new Error("Wallet address is required");
            }

            // Get the transaction XDR
            const xdr = assembledTx.toXDR();

            // Sign the transaction - this will trigger the wallet popup
            const signResult = await signTx(xdr, {
              address: walletState.address,
              networkPassphrase: network.networkPassphrase,
            });

            if (!signResult || !signResult.signedTxXdr) {
              throw new Error(
                "Transaction signing failed - no signed transaction received",
              );
            }

            // Parse the signed XDR back into a Transaction object
            const signedTransaction = TransactionBuilder.fromXDR(
              signResult.signedTxXdr,
              network.networkPassphrase,
            );

            // Send the signed transaction via RPC
            const server = createRpcServer();
            const sendResponse =
              await server.sendTransaction(signedTransaction);

            // signAndSend() returns a SendTransactionResponse
            // Check for errors in the response
            let finalResponse: any = sendResponse;
            if (sendResponse.status === "PENDING" && sendResponse.hash) {
              // Poll for transaction status
              const server = createRpcServer();
              let attempts = 0;
              const maxAttempts = 30; // Wait up to 30 seconds

              while (
                attempts < maxAttempts &&
                finalResponse.status === "PENDING"
              ) {
                await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
                try {
                  const txStatus = await server.getTransaction(
                    sendResponse.hash,
                  );
                  // Convert GetTransactionResponse to SendTransactionResponse format
                  finalResponse = {
                    ...sendResponse,
                    status: txStatus.status,
                    errorResult:
                      "errorResult" in txStatus
                        ? txStatus.errorResult
                        : undefined,
                    hash: sendResponse.hash,
                  };
                  attempts++;
                } catch (error) {
                  attempts++;
                }
              }

              if (finalResponse.status === "PENDING") {
                throw new Error(
                  "Transaction still pending after waiting. It may have failed.",
                );
              }
            }

            // Check for errors in the response
            const errorResult =
              "errorResult" in finalResponse && finalResponse.errorResult
                ? finalResponse.errorResult
                : null;
            if (finalResponse.status === "ERROR" || errorResult) {
              let errorMessage = "Transaction failed";

              if (errorResult) {
                // errorResult might be an object with a value() method or already be the value
                try {
                  // Try to extract error message from errorResult
                  let errorValue: any = errorResult;

                  // If it has a value() method, call it
                  if (typeof (errorValue as any).value === "function") {
                    errorValue = (errorValue as any).value();
                  } else if ((errorValue as any).value) {
                    errorValue = (errorValue as any).value;
                  }

                  // Try to extract readable error message
                  if (typeof errorValue === "string") {
                    errorMessage = errorValue;
                  } else if (errorValue?.message) {
                    errorMessage = errorValue.message;
                  } else if (
                    errorValue?.toString &&
                    typeof errorValue.toString === "function"
                  ) {
                    const errorStr = errorValue.toString();
                    if (errorStr !== "[object Object]") {
                      errorMessage = errorStr;
                    } else {
                      // Try to extract from diagnostic events if available
                      if (finalResponse.diagnosticEvents) {
                        const events = finalResponse.diagnosticEvents;
                        const errorEvent = events.find(
                          (e: any) => e.topics && e.topics.includes("error"),
                        );
                        if (errorEvent && errorEvent.data) {
                          if (Array.isArray(errorEvent.data)) {
                            errorMessage = errorEvent.data.join(": ");
                          } else if (typeof errorEvent.data === "string") {
                            errorMessage = errorEvent.data;
                          } else {
                            errorMessage = JSON.stringify(errorEvent.data);
                          }
                        }
                      }
                      if (errorMessage === "Transaction failed") {
                        errorMessage = JSON.stringify(errorValue);
                      }
                    }
                  } else {
                    // Try to extract from diagnostic events if available
                    if (finalResponse.diagnosticEvents) {
                      const events = finalResponse.diagnosticEvents;
                      const errorEvent = events.find(
                        (e: any) => e.topics && e.topics.includes("error"),
                      );
                      if (errorEvent && errorEvent.data) {
                        if (Array.isArray(errorEvent.data)) {
                          errorMessage = errorEvent.data.join(": ");
                        } else if (typeof errorEvent.data === "string") {
                          errorMessage = errorEvent.data;
                        } else {
                          errorMessage = JSON.stringify(errorEvent.data);
                        }
                      }
                    }
                    if (errorMessage === "Transaction failed") {
                      errorMessage = JSON.stringify(errorValue);
                    }
                  }
                } catch (e) {
                  // Fallback: try to extract from diagnostic events
                  if (finalResponse.diagnosticEvents) {
                    const events = finalResponse.diagnosticEvents;
                    const errorEvent = events.find(
                      (e: any) => e.topics && e.topics.includes("error"),
                    );
                    if (errorEvent && errorEvent.data) {
                      if (Array.isArray(errorEvent.data)) {
                        errorMessage = errorEvent.data.join(": ");
                      } else if (typeof errorEvent.data === "string") {
                        errorMessage = errorEvent.data;
                      } else {
                        errorMessage = JSON.stringify(errorEvent.data);
                      }
                    }
                  }
                  if (errorMessage === "Transaction failed") {
                    errorMessage = `Transaction failed: ${JSON.stringify(errorResult)}`;
                  }
                }
              } else if (finalResponse.status === "ERROR") {
                // Try to extract from diagnostic events
                if (finalResponse.diagnosticEvents) {
                  const events = finalResponse.diagnosticEvents;
                  const errorEvent = events.find(
                    (e: any) => e.topics && e.topics.includes("error"),
                  );
                  if (errorEvent && errorEvent.data) {
                    if (Array.isArray(errorEvent.data)) {
                      errorMessage = errorEvent.data.join(": ");
                    } else if (typeof errorEvent.data === "string") {
                      errorMessage = errorEvent.data;
                    } else {
                      errorMessage = JSON.stringify(errorEvent.data);
                    }
                  }
                }
                if (errorMessage === "Transaction failed") {
                  errorMessage = `Transaction error: ${JSON.stringify(finalResponse)}`;
                }
              }

              throw new Error(errorMessage);
            }

            // Extract transaction hash from response
            const txHash = finalResponse.hash || "";
            if (!txHash) {
              throw new Error("Transaction sent but no hash returned");
            }

            return txHash;
          } catch (signError: any) {
            if (
              signError.message?.includes("User rejected") ||
              signError.message?.includes("rejected")
            ) {
              throw new Error("Transaction was rejected by user");
            }
            throw signError;
          }
        } catch (error: any) {
          throw error;
        }
      },

      async owner() {
        // Return owner address if available
        return import.meta.env.VITE_OWNER_ADDRESS || "";
      },
    };
  };

  const refreshBalance = async () => {
    if (!walletState.isConnected || !walletState.address) {
      return;
    }

    try {
      const { Horizon } = await import("@stellar/stellar-sdk");
      const horizonUrl =
        network.horizonUrl || "https://horizon-testnet.stellar.org";
      const horizon = new Horizon.Server(horizonUrl);

      const account = await horizon
        .accounts()
        .accountId(walletState.address)
        .call();
      const nativeBalance = account.balances.find(
        (b: any) => b.asset_type === "native",
      );

      // Get full precision balance from blockchain
      const fullBalance = nativeBalance
        ? parseFloat(nativeBalance.balance)
        : null;

      // Only update balance if we successfully fetched it
      // If nativeBalance is not found, keep existing balance
      if (fullBalance !== null) {
        setWalletState((prev) => ({
          ...prev,
          balance: fullBalance.toFixed(7), // Use 7 decimals for XLM (full precision)
        }));
      }
      // If nativeBalance is null, keep existing balance (don't reset to 0)
    } catch (error) {}
  };

  return (
    <Web3Context.Provider
      value={{
        wallet: walletState,
        connectWallet,
        disconnectWallet,
        switchNetwork,
        getContract,
        isOwner,
        network,
        refreshBalance,
      }}
    >
      {children}
    </Web3Context.Provider>
  );
}

export function useWeb3() {
  const context = useContext(Web3Context);
  if (context === undefined) {
    throw new Error("useWeb3 must be used within a Web3Provider");
  }
  return context;
}
