import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useWeb3 } from "@/contexts/web3-context";
// Unused import removed: useSmartAccount
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF } from "@/lib/web3/config";
import {
  useNotifications,
  createEscrowNotification,
} from "@/contexts/notification-context";

import { useNavigate, useSearchParams } from "react-router-dom";
import { ProjectDetailsStep } from "@/components/create/project-details-step";
import { MilestonesStep } from "@/components/create/milestones-step";
import { ReviewStep } from "@/components/create/review-step";
import { useCreateEscrow } from "@/hooks/use-escrows";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

interface Milestone {
  description: string;
  amount: string;
}

export default function CreateEscrowPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { wallet, refreshBalance } = useWeb3();
  // Stellar doesn't use smart accounts
  // const { executeTransaction, isSmartAccountReady } = useSmartAccount();
  const { toast } = useToast();
  const { addNotification, addCrossWalletNotification } = useNotifications();
  const createEscrow = useCreateEscrow();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAIWriter, setShowAIWriter] = useState(false);
  const [currentMilestoneIndex, setCurrentMilestoneIndex] = useState<
    number | null
  >(null);
  const [_useNativeToken, _setUseNativeToken] = useState(false);
  const [_isOpenJob, _setIsOpenJob] = useState(false);
  const [isContractPaused, setIsContractPaused] = useState(false);
  const [contractConfigError, setContractConfigError] = useState<string | null>(
    null
  );
  const [isOnCorrectNetwork, setIsOnCorrectNetwork] = useState(true);
  const [errors, setErrors] = useState<{
    projectTitle?: string;
    projectDescription?: string;
    duration?: string;
    totalBudget?: string;
    beneficiary?: string;
    tokenAddress?: string;
    milestones?: string;
    totalMismatch?: string;
  }>({});

  useEffect(() => {
    checkContractPauseStatus();
    checkNetworkStatus();
  }, [wallet.chainId]);

  const checkNetworkStatus = async () => {
    if (!wallet.isConnected) return;

    try {
      // Stellar doesn't use chain IDs - just check if wallet is connected
      setIsOnCorrectNetwork(true);
    } catch (error) {
      setIsOnCorrectNetwork(false);
    }
  };

  const checkContractPauseStatus = async () => {
    try {
      const { contractService } = await import("@/lib/web3/contract-service");
      const health = await contractService.probeEscrowContractHealth();
      if (!health.ok) {
        setContractConfigError(health.userMessage);
        setIsContractPaused(true);
        return;
      }
      setContractConfigError(null);
      setIsContractPaused(health.jobCreationPaused);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Contract check failed.";
      setContractConfigError(msg);
      setIsContractPaused(true);
    }
  };

  const prefillFreelancer = searchParams.get("freelancer") ?? "";

  const [formData, setFormData] = useState({
    projectTitle: "",
    projectDescription: "",
    duration: "",
    totalBudget: "",
    beneficiary: prefillFreelancer,
    token: "", // Stellar: use empty string for native XLM, or contract address for tokens
    useNativeToken: false,
    isOpenJob: false,
    milestones: [
      { description: "", amount: "" },
      { description: "", amount: "" },
    ] as Milestone[],
  });

  // Removed unused functions: _commonTokens, _addMilestone, _removeMilestone

  // Removed unused functions: updateMilestone, _openAIWriter, _handleAISelect

  const calculateTotalMilestones = () => {
    return formData.milestones.reduce(
      (sum, m) => sum + (Number.parseFloat(m.amount) || 0),
      0
    );
  };

  const validateStep = () => {
    const newErrors: typeof errors = {};
    let hasErrors = false;

    if (step === 1) {
      // Validate all required fields for step 1
      if (!formData.projectTitle || formData.projectTitle.length < 3) {
        newErrors.projectTitle = "Project title must be at least 3 characters";
        hasErrors = true;
      }

      if (
        !formData.projectDescription ||
        formData.projectDescription.length < 50
      ) {
        newErrors.projectDescription =
          "Project description must be at least 50 characters";
        hasErrors = true;
      }

      if (
        !formData.duration ||
        Number(formData.duration) < 1 ||
        Number(formData.duration) > 365
      ) {
        newErrors.duration = "Duration must be between 1 and 365 days";
        hasErrors = true;
      }

      if (!formData.totalBudget || Number(formData.totalBudget) < 0.01) {
        newErrors.totalBudget = "Total budget must be at least 0.01 tokens";
        hasErrors = true;
      }

      if (
        !formData.isOpenJob &&
        (!formData.beneficiary ||
          !/^0x[a-fA-F0-9]{40}$/.test(formData.beneficiary))
      ) {
        newErrors.beneficiary =
          "Valid beneficiary address is required for direct escrow";
        hasErrors = true;
      }

      if (!formData.useNativeToken && !formData.token) {
        newErrors.tokenAddress = "Please select a token from the whitelisted stablecoins";
        hasErrors = true;
      }
    } else if (step === 2) {
      const total = calculateTotalMilestones();
      const targetTotal = Number.parseFloat(formData.totalBudget) || 0;

      if (formData.milestones.some((m) => !m.description || !m.amount)) {
        newErrors.milestones = "Please fill in all milestone details";
        hasErrors = true;
      }

      if (Math.abs(total - targetTotal) > 0.01) {
        newErrors.totalMismatch = `Milestone amounts (${total}) must equal total amount (${targetTotal})`;
        hasErrors = true;
      }
    }

    setErrors(newErrors);
    return !hasErrors;
  };

  const clearErrors = () => {
    setErrors({});
  };

  const nextStep = () => {
    if (validateStep()) {
      setStep(step + 1);
    }
  };

  const prevStep = () => {
    setStep(step - 1);
  };

  const validateForm = () => {
    const errors: string[] = [];

    // Validate project title
    if (!formData.projectTitle || formData.projectTitle.length < 3) {
      errors.push("Project title must be at least 3 characters long");
    }

    // Validate project description
    if (
      !formData.projectDescription ||
      formData.projectDescription.length < 50
    ) {
      errors.push("Project description must be at least 50 characters long");
    }

    // Validate duration
    if (
      !formData.duration ||
      Number(formData.duration) < 1 ||
      Number(formData.duration) > 365
    ) {
      errors.push("Duration must be between 1 and 365 days");
    }

    // Validate total budget
    if (!formData.totalBudget || Number(formData.totalBudget) < 0.01) {
      errors.push("Total budget must be at least 0.01 tokens");
    }

    // Validate tokens
    if (!formData.useNativeToken && !formData.token) {
      errors.push("Please select a whitelisted token");
    }

    // Validate beneficiary (only if not open job)
    if (!formData.isOpenJob) {
      if (!formData.beneficiary) {
        errors.push("Beneficiary address is required for direct escrow");
      } else if (!/^G[A-Z0-9]{55}$/.test(formData.beneficiary)) {
        errors.push(
          "Beneficiary address must be a valid Stellar address (starts with G)"
        );
      }
    }

    // Validate milestones
    if (formData.milestones.length === 0) {
      errors.push("At least one milestone is required");
    }

    for (let i = 0; i < formData.milestones.length; i++) {
      const milestone = formData.milestones[i];
      if (!milestone.description || milestone.description.length < 10) {
        errors.push(
          `Milestone ${i + 1} description must be at least 10 characters long`
        );
      }
      if (!milestone.amount || Number(milestone.amount) < 0.01) {
        errors.push(`Milestone ${i + 1} amount must be at least 0.01 tokens`);
      }
    }

    // Validate milestone amounts sum
    const totalMilestoneAmount = formData.milestones.reduce(
      (sum, milestone) => sum + Number(milestone.amount || 0),
      0
    );
    if (Math.abs(totalMilestoneAmount - Number(formData.totalBudget)) > 0.01) {
      errors.push("Total milestone amounts must equal the total budget");
    }

    return errors;
  };

  const handleSubmit = async () => {

    if (!wallet.isConnected) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet to create an escrow",
        variant: "destructive",
      });
      return;
    }

    // Validate form
    const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      toast({
        title: "Form validation failed",
        description: validationErrors.join(", "),
        variant: "destructive",
      });
      return;
    }

    // For native XLM, token can be empty string or null
    // For custom tokens, token should be set
    // This check is not needed - the contract handles both cases

    setIsSubmitting(true);

    try {

      // Stellar: Handle token approval if using a custom token (not native XLM)
      if (
        formData.token &&
        formData.token !== "" &&
        formData.token !==
          GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF
      ) {
        // For Stellar, token approval is handled differently
        // The contract will handle token transfers internally
        // We just need to verify the token contract exists
        // Token approval is handled by the contract for Stellar
        // No need to check token contract here
      }

      const milestoneDescriptions = formData.milestones.map(
        (m) => m.description
      );

      // Stellar: Use null for open jobs (Option<Address>)
      const beneficiaryAddress = formData.isOpenJob
        ? null // null for open jobs
        : formData.beneficiary || null;

      // Stellar: Convert XLM to stroops (1 XLM = 10,000,000 stroops)
      // For Stellar, we use stroops instead of wei
      const STROOPS_PER_XLM = 10_000_000;
      const totalAmountInStroops = BigInt(
        Math.floor(Number.parseFloat(formData.totalBudget) * STROOPS_PER_XLM)
      );

      // Check native XLM balance using wallet balance
      // For native XLM (useNativeToken = true), token will be empty or null
      if (formData.useNativeToken || !formData.token || formData.token === "") {
        const walletBalance = Number.parseFloat(wallet.balance || "0");
        const requiredBalance = Number.parseFloat(formData.totalBudget);
        if (walletBalance < requiredBalance) {
          throw new Error(
            `Insufficient XLM balance. You have ${walletBalance.toFixed(4)} XLM but need ${formData.totalBudget} XLM.`
          );
        }
      }

      // Convert milestone amounts to stroops (Stellar uses stroops, not wei)
      const milestoneAmountsInStroops = formData.milestones.map((m) =>
        BigInt(Math.floor(Number.parseFloat(m.amount) * STROOPS_PER_XLM))
      );

      // Default arbiter - use a Stellar address (you should replace this with a real arbiter address)
      // For now, use a default arbiter address - in production, this should come from formData or be configurable
      const arbiters = [
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      ]; // Default arbiter - replace with real arbiter address
      const requiredConfirmations = 1;

      // Convert duration from days to seconds
      const durationInSeconds = Number(formData.duration) * 24 * 60 * 60;

      // Convert milestones to [amount, description] format for the hook
      const milestones = milestoneAmountsInStroops.map(
        (amount, idx) =>
          [amount.toString(), milestoneDescriptions[idx] || ""] as [
            string,
            string,
          ]
      );

      // Use the useCreateEscrow hook
      if (!wallet.address) {
        throw new Error("Wallet not connected");
      }

      const escrowId = await createEscrow.mutateAsync({
        depositor: wallet.address,
        beneficiary: beneficiaryAddress || undefined,
        arbiters,
        required_confirmations: requiredConfirmations,
        milestones,
        token:
          formData.useNativeToken || !formData.token || formData.token === ""
            ? undefined
            : formData.token,
        total_amount: totalAmountInStroops.toString(),
        duration: durationInSeconds,
        project_title: formData.projectTitle,
        project_description: formData.projectDescription,
      });

      // Notify the client (self) that the escrow was created
      addNotification(
        createEscrowNotification("created", String(escrowId), {
          projectTitle: formData.projectTitle,
        })
      );

      // Notify the assigned freelancer (if direct escrow, not open job)
      if (beneficiaryAddress) {
        addCrossWalletNotification(
          {
            type: "escrow",
            title: "You've Been Assigned to a Project!",
            message: `You have been assigned to "${formData.projectTitle}". Check your freelancer dashboard to get started.`,
            actionUrl: `/freelancer?escrow=${escrowId}`,
            data: {
              escrowId: String(escrowId),
              projectTitle: formData.projectTitle,
              clientAddress: wallet.address,
            },
          },
          undefined,
          beneficiaryAddress
        );
      }

      // Refresh balance to reflect XLM spent on escrow deposit
      refreshBalance().catch(() => {});

      // Navigate after successful creation
      setTimeout(() => {
        navigate(formData.isOpenJob ? "/jobs" : "/dashboard");
      }, 2000);
    } catch (error: any) {
      // Show a toast for any error not already handled by the mutation's onError
      if (!createEscrow.isError) {
        toast({
          title: "Action failed",
          description: error?.message || "Something went wrong. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen py-12 gradient-mesh">
      {/* Network Switch Banner */}
      {!isOnCorrectNetwork && wallet.isConnected && (
        <div className="container mx-auto px-4 max-w-4xl mb-6">
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                <div>
                  <h3 className="font-semibold text-destructive">
                    Wrong Network
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Please connect to Stellar Testnet to create escrows
                  </p>
                </div>
              </div>
              <Button
                onClick={() => window.location.reload()}
                variant="destructive"
                size="sm"
              >
                Refresh Connection
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {contractConfigError && (
            <Alert variant="destructive" className="mb-8">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Escrow contract unavailable</AlertTitle>
              <AlertDescription>{contractConfigError}</AlertDescription>
            </Alert>
          )}
          <h1 className="text-4xl md:text-5xl font-bold mb-3 text-center">
            Create New Escrow
          </h1>
          <p className="text-xl text-muted-foreground text-center mb-10">
            Set up a secure escrow with milestone-based payments
          </p>

          <div className="flex items-center justify-center mb-10">
            <div className="flex items-center gap-4">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex items-center gap-4">
                  <div
                    className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${
                      s === step
                        ? "border-primary bg-primary text-primary-foreground"
                        : s < step
                          ? "border-primary bg-primary/20 text-primary"
                          : "border-muted-foreground/30 text-muted-foreground"
                    }`}
                  >
                    {s < step ? <CheckCircle2 className="h-5 w-5" /> : s}
                  </div>
                  {s < 3 && (
                    <div
                      className={`w-16 h-0.5 ${
                        s < step ? "bg-primary" : "bg-muted-foreground/30"
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="mb-6"
              >
                <ProjectDetailsStep
                  formData={formData}
                  onUpdate={(data) => {
                    setFormData({ ...formData, ...data });
                    clearErrors();
                  }}
                  isContractPaused={isContractPaused}
                  errors={{
                    projectTitle: errors.projectTitle,
                    projectDescription: errors.projectDescription,
                    duration: errors.duration,
                    totalBudget: errors.totalBudget,
                    beneficiary: errors.beneficiary,
                    tokenAddress: errors.tokenAddress,
                  }}
                />
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="mb-6"
              >
                <MilestonesStep
                  milestones={formData.milestones}
                  onUpdate={(milestones) => {
                    setFormData({ ...formData, milestones });
                    clearErrors();
                  }}
                  showAIWriter={showAIWriter}
                  onToggleAIWriter={setShowAIWriter}
                  currentMilestoneIndex={currentMilestoneIndex}
                  onSetCurrentMilestoneIndex={setCurrentMilestoneIndex}
                  totalBudget={formData.totalBudget}
                  projectTitle={formData.projectTitle}
                  projectDescription={formData.projectDescription}
                  durationDays={formData.duration}
                  errors={{
                    milestones: errors.milestones,
                    totalMismatch: errors.totalMismatch,
                  }}
                />
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="mb-6"
              >
                <ReviewStep
                  formData={formData}
                  onConfirm={handleSubmit}
                  isSubmitting={isSubmitting || createEscrow.isPending}
                  isContractPaused={isContractPaused}
                  isOnCorrectNetwork={isOnCorrectNetwork}
                  walletBalance={wallet.balance}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex justify-between mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={prevStep}
              disabled={step === 1}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Previous
            </Button>

            <Button
              type="button"
              onClick={nextStep}
              disabled={step === 3 || !!contractConfigError}
              className="flex items-center gap-2"
            >
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
