export interface Milestone {
  description: string; // freelancer submission response (original requirements before first submission)
  requirements?: string; // original client requirements — populated once contract v2 is live
  amount: string;
  status:
    | "pending"
    | "submitted"
    | "approved"
    | "rejected"
    | "disputed"
    | "resolved";
  submittedAt?: number;
  approvedAt?: number;
  rejectionReason?: string;
  disputeReason?: string;
  resolvedAt?: number;
  resolvedBy?: string;
  resolutionAmount?: string; // kept for compat — same as resolutionFreelancerAmount
  resolutionFreelancerAmount?: string;
  resolutionClientAmount?: string;
  resolutionReason?: string;
}

export interface Escrow {
  id: string;
  payer: string;
  beneficiary: string;
  token: string;
  totalAmount: string;
  releasedAmount: string;
  status: "pending" | "active" | "completed" | "disputed";
  createdAt: number;
  duration: number;
  /** Deadline as Unix timestamp (ms), derived from on-chain ledger sequence */
  deadlineAt?: number;
  milestones: Milestone[];
  projectTitle?: string;
  projectDescription?: string;
  isOpenJob?: boolean;
  applications?: Application[];
  applicationCount?: number;
  isJobCreator?: boolean;
  isClient?: boolean;
  isFreelancer?: boolean;
  milestoneCount?: number;
}

export interface EscrowStats {
  activeEscrows: number;
  totalVolume: string;
  completedEscrows: number;
}

export interface WalletState {
  address: string | null; // Stellar public key (G...)
  chainId: number | null; // Deprecated: Stellar doesn't use chain IDs
  isConnected: boolean;
  balance: string; // XLM balance (7 decimals)
}

export interface Application {
  freelancerAddress: string;
  coverLetter: string;
  proposedTimeline: number;
  appliedAt: number;
  status: "pending" | "accepted" | "rejected";
  badge?: "Beginner" | "Intermediate" | "Advanced" | "Expert";
  averageRating?: number;
  ratingCount?: number;
}

export interface Rating {
  escrowId: number;
  freelancer: string;
  client: string;
  rating: number; // 1-5
  review: string;
  ratedAt: number;
}

export type Badge = "Beginner" | "Intermediate" | "Advanced" | "Expert";
