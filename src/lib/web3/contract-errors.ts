/**
 * Human-readable messages for SecureFlow contract errors.
 *
 * Mirrors `SecureFlowError` in contracts/secureflow/src/storage_types.rs.
 * Codes are stable on the contract side; keep this file in step when a new
 * code is added there.
 */
export const CONTRACT_ERROR_MESSAGES: Record<number, string> = {
  // Admin
  1000: "Contract is already initialized.",
  1001: "Platform fee is too high (max 10%).",
  1002: "Only the contract owner can perform this action.",
  1003: "Contract is not initialized yet.",

  // Escrow state
  1100: "Escrow not found.",
  1101: "This escrow is not in progress.",
  1102: "This escrow's status doesn't allow that action.",
  1103: "Work has already been started on this escrow.",
  1104: "Work has not been started yet.",
  1105: "This escrow is already under dispute.",
  1106: "No freelancer is assigned to this escrow.",

  // Escrow creation
  1200: "Job creation is currently paused.",
  1201: "Duration must be between 1 hour and 365 days.",
  1202: "Milestone count does not match.",
  1203: "Too many milestones (max 20).",
  1204: "Too many arbiters (max 5).",
  1205: "Required confirmations exceed the number of arbiters.",
  1206: "This token is not accepted.",
  1207: "Add at least one milestone.",
  1208: "Milestone amounts must add up exactly to the total budget.",
  1209: "Every milestone must be worth more than zero.",
  1210: "You can't hire yourself.",
  1211: "The same arbiter is listed twice.",

  // Marketplace
  1300: "This job is not open for applications.",
  1301: "This job is closed to new applications.",
  1302: "You cannot apply to your own job.",
  1303: "This job has reached the maximum of 50 applications.",
  1304: "Only the job creator can perform this action.",
  1305: "This freelancer has not applied to this job.",
  1306: "You have already applied to this job.",
  1307: "A freelancer is already assigned to this job.",

  // Milestones
  1400: "Invalid milestone.",
  1401: "This milestone has already been submitted.",
  1402: "This milestone has not been submitted yet.",
  1403: "This milestone has already been processed.",
  1404: "Only a rejected milestone can be resubmitted.",
  1405: "This milestone has already been paid or resolved.",

  // Refunds & deadlines
  1500: "There is nothing left to refund.",
  1501: "The deadline has not passed yet.",
  1502: "Emergency refunds open 30 days after the deadline.",
  1503: "This escrow is already settled, refunded or cancelled.",
  1504: "Extension must be between 1 second and 365 days.",
  1505: "The deadline can only be extended on a pending or active escrow.",
  1506: "An open dispute must be resolved before a refund.",
  1507: "Delivered work is waiting for review; approve, reject or dispute it first.",

  // Authorisation
  1600: "Only the assigned freelancer can perform this action.",
  1601: "You are not authorized to perform this action.",
  1602: "Only the client or their job manager can perform this action.",
  1603: "Only an authorized arbiter can perform this action.",
  1604: "Arbiters can't rule on (or be hired for) a job they are part of.",
  1605: "This escrow has its own arbiter panel and you're not on it.",
  1606: "Only the fee collector can withdraw fees.",
  1607: "Only the client, freelancer or job manager can do this.",

  // Validation
  1700: "The amount entered is invalid (must be greater than zero).",
  1701: "Invalid address provided.",
  1702: "Invalid parameter.",
  1703: "Not enough available balance to withdraw that much.",
  1704: "No overdue dispute has been raised on this escrow.",
  1705: "No arbiters are available for this escrow.",
  1706: "A balance calculation overflowed; nothing was changed.",
  1707: "Freelancer and client shares must add up to the milestone amount.",
  1708: "Please give a reason.",
  1709: "There are no fees to withdraw for this token.",

  // Ratings
  1800: "This escrow is not completed yet.",
  1801: "A rating has already been submitted.",
  1802: "Rating must be between 1 and 5.",
  1803: "Only the client can rate the freelancer.",
  1804: "Only the freelancer can rate the client.",
  1805: "You have already rated this client.",

  // Evidence
  1900: "You are not a party to this escrow.",
  1901: "Evidence CID cannot be empty.",
  1902: "This milestone already has the maximum amount of evidence.",

  // Pause
  2000: "The contract is currently paused. Please try again later.",

  // Token lists
  2100: "This token is blacklisted.",
  2101: "This token is already blacklisted.",
  2102: "This token is not blacklisted.",

  // Milestone editing
  2200: "This milestone has already started and can't be edited.",
  2201: "Milestone index is out of bounds.",
  2202: "Milestones and funds can only be changed before work starts.",
  2203: "A job must keep at least one milestone.",

  // Cancellation & reopening
  2300: "Work has started; the job can no longer be cancelled.",
  2301: "Every milestone is already delivered or paid.",
  2302: "Only a declined or arbitrated job can be reopened.",

  // Negotiation
  2400: "There is no pending proposal on this milestone.",
  2401: "Answer the pending milestone proposal first.",

  // Escrow admin
  2500: "Funds are still locked in this escrow.",
  2501: "This escrow has not reached a final state.",

  // Job manager
  2600: "A job manager can't also be the freelancer.",
  2601: "A job manager can't hire themselves.",
  2602: "You already manage this job; appoint someone else.",
  2603: "No job manager is set on this escrow.",

  // Tokens
  2700: "The token transfer failed. Check your balance and trustline.",
};

/**
 * Turn a raw Soroban error ("... Error(Contract, #1208) ...") into a message
 * a person can act on. Falls back to the raw text when no code is present.
 */
export function translateContractError(raw: string): string {
  // A brand-new Stellar wallet doesn't exist on the network until it holds
  // some XLM. RPC reports that as "Account not found: G...".
  if (/account not found/i.test(raw)) {
    return "This wallet isn't activated on Stellar yet. Add a little XLM to it (on testnet, use Friendbot or fund it from another wallet), then try again.";
  }
  const match = raw.match(/Error\(Contract,\s*#(\d+)\)/);
  if (match) {
    const code = parseInt(match[1], 10);
    return (
      CONTRACT_ERROR_MESSAGES[code] ??
      `Contract error #${code}. Please try again or contact support.`
    );
  }
  if (raw.startsWith("Simulation error: HostError:")) {
    return raw.replace("Simulation error: HostError: ", "");
  }
  if (raw.startsWith("Simulation failed:")) {
    return raw.replace("Simulation failed:", "").trim();
  }
  return raw || "Something went wrong. Please try again.";
}
