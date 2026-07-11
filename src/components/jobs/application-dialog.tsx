import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Escrow } from "@/lib/web3/types";
import { Sparkles, Paperclip, X, CheckCircle2, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  isApiConfigured,
  postCoverLetterDraft,
  uploadMilestoneFile,
  type UploadedFile,
} from "@/lib/api";
import { CONTRACTS } from "@/lib/web3/config";

interface MilestonePreview {
  description: string;
  requirements: string;
  amount: string;
}

interface ApplicationDialogProps {
  job: Escrow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (
    job: Escrow,
    coverLetter: string,
    proposedTimeline: string,
    attachmentUrl?: string,
  ) => void;
  applying: boolean;
}

export function ApplicationDialog({
  job,
  open,
  onOpenChange,
  onApply,
  applying,
}: ApplicationDialogProps) {
  const { toast } = useToast();
  const [coverLetter, setCoverLetter] = useState("");
  const [proposedTimeline, setProposedTimeline] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [milestones, setMilestones] = useState<MilestonePreview[] | null>(null);
  const [milestonesLoading, setMilestonesLoading] = useState(false);

  // Keep user input until the dialog actually closes (e.g. after a successful tx).
  useEffect(() => {
    if (!open) {
      setCoverLetter("");
      setProposedTimeline("");
      setSelectedFile(null);
      setUploadedFile(null);
      setMilestones(null);
    }
  }, [open]);

  // Fetch on-chain milestones when dialog opens so applicants see the breakdown
  useEffect(() => {
    if (!open || !job) return;
    let cancelled = false;
    (async () => {
      setMilestonesLoading(true);
      try {
        const { ContractService } = await import("@/lib/web3/contract-service");
        const svc = new ContractService(CONTRACTS.SECUREFLOW_ESCROW);
        const raw = await svc.getMilestones(Number(job.id));
        if (cancelled) return;
        const parsed: MilestonePreview[] = (raw as any[]).map((m: any) => ({
          description: m.description ?? "",
          requirements: m.requirements ?? "",
          amount: m.amount?.toString() ?? "0",
        }));
        setMilestones(parsed);
      } catch {
        if (!cancelled) setMilestones([]);
      } finally {
        if (!cancelled) setMilestonesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, job]);

  const hasUserText = coverLetter.trim().length > 10;

  const draftWithAi = async () => {
    if (!job) return;
    const desc = job.projectDescription?.trim() ?? "";
    if (!desc) {
      toast({
        title: "Missing job description",
        description: "This listing has no description to draft from.",
        variant: "destructive",
      });
      return;
    }
    if (!isApiConfigured()) {
      toast({
        title: "API not configured",
        description:
          "Set VITE_API_URL and run the SecureFlow API with GROQ_API_KEY.",
        variant: "destructive",
      });
      return;
    }
    setAiLoading(true);
    try {
      const { coverLetter: next } = await postCoverLetterDraft({
        jobTitle:
          job.projectTitle ?? job.projectDescription ?? `Job #${job.id}`,
        jobDescription: desc,
        proposedTimelineDays: proposedTimeline.trim() || undefined,
        tone: "professional",
        // Pass the user's existing text so the AI enhances it rather than replacing it
        userDraft: coverLetter.trim() || undefined,
      });
      setCoverLetter(next);
      toast({
        title: hasUserText ? "Enhanced!" : "Draft ready",
        description: hasUserText
          ? "Your draft has been polished. Review and edit as needed."
          : "Review and edit before submitting.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Draft failed";
      toast({
        title: "AI unavailable",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setAiLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!job || !coverLetter.trim() || !proposedTimeline.trim()) return;

    let fileUrl: string | undefined = uploadedFile?.url;

    // Upload file if one was selected but not yet uploaded
    if (selectedFile && !uploadedFile && isApiConfigured()) {
      setUploading(true);
      try {
        toast({
          title: "Uploading attachment…",
          description: selectedFile.name,
        });
        const result = await uploadMilestoneFile(selectedFile, job.id, 0);
        setUploadedFile(result);
        fileUrl = result.url;
      } catch (e) {
        toast({
          title: "Upload failed",
          description: e instanceof Error ? e.message : "Could not upload file",
          variant: "destructive",
        });
        setUploading(false);
        return;
      } finally {
        setUploading(false);
      }
    }

    // Append attachment link to cover letter if uploaded
    const finalLetter = fileUrl
      ? `${coverLetter.trim()}\n\n[Portfolio/Attachment: ${uploadedFile?.filename ?? selectedFile?.name ?? "file"}](${fileUrl})`
      : coverLetter;

    onApply(job, finalLetter, proposedTimeline, fileUrl);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-thick w-[min(92vw,56rem)] max-w-4xl p-7">
        <DialogHeader className="space-y-2">
          <DialogTitle className="leading-snug">
            Apply to{" "}
            {job?.projectTitle?.trim() || `Job #${job?.id || "Unknown"}`}
          </DialogTitle>
          <DialogDescription>
            Submit your application for this freelance opportunity.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Milestone breakdown — count + per-milestone amount + description */}
          <div>
            <Label className="mb-1.5 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" />
              Milestones
              {milestones && (
                <span className="font-normal text-muted-foreground">
                  ({milestones.length})
                </span>
              )}
            </Label>
            {milestonesLoading ? (
              <div className="text-sm text-muted-foreground px-3 py-2 rounded-md border border-dashed">
                Loading milestones…
              </div>
            ) : milestones && milestones.length > 0 ? (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {milestones.map((m, i) => (
                  <div
                    key={i}
                    className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-3 px-3 py-2 rounded-md border bg-muted/30"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-muted-foreground">
                        Milestone {i + 1}
                      </div>
                      {(m.requirements || m.description) && (
                        <div className="text-sm whitespace-pre-wrap wrap-break-word">
                          {m.requirements || m.description}
                        </div>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-green-600 dark:text-green-400 whitespace-nowrap sm:self-start">
                      {(Number(m.amount) / 1e7).toFixed(2)} XLM
                    </div>
                  </div>
                ))}
              </div>
            ) : milestones !== null ? (
              <div className="text-sm text-muted-foreground px-3 py-2 rounded-md border border-dashed">
                No milestones defined for this job.
              </div>
            ) : null}
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <Label htmlFor="coverLetter">Cover Letter *</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => void draftWithAi()}
                disabled={aiLoading || applying || !job}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {aiLoading
                  ? hasUserText
                    ? "Enhancing…"
                    : "Drafting…"
                  : hasUserText
                    ? "Enhance with AI"
                    : "Draft with AI"}
              </Button>
            </div>
            <Textarea
              id="coverLetter"
              placeholder="Tell us why you're the best fit for this job..."
              value={coverLetter}
              onChange={(e) => setCoverLetter(e.target.value)}
              className="min-h-[300px]"
              required
            />
          </div>

          <div>
            <Label htmlFor="proposedTimeline">Proposed Timeline (days) *</Label>
            <Input
              id="proposedTimeline"
              type="number"
              placeholder="e.g., 7"
              value={proposedTimeline}
              onChange={(e) => setProposedTimeline(e.target.value)}
              min="1"
              required
            />
          </div>

          {isApiConfigured() && (
            <div>
              <Label className="mb-1.5 block">
                Portfolio / Attachment{" "}
                <span className="font-normal text-muted-foreground">
                  (optional · PDF, images, docs · max 10 MB)
                </span>
              </Label>
              {uploadedFile ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                  <span className="truncate text-green-700 dark:text-green-300 flex-1">
                    {uploadedFile.filename}
                  </span>
                  <button
                    type="button"
                    className="text-gray-400 hover:text-red-500"
                    onClick={() => {
                      setUploadedFile(null);
                      setSelectedFile(null);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : selectedFile ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 text-sm">
                  <Paperclip className="h-4 w-4 text-blue-500 shrink-0" />
                  <span className="truncate text-blue-700 dark:text-blue-300 flex-1">
                    {selectedFile.name}
                  </span>
                  <button
                    type="button"
                    className="text-gray-400 hover:text-red-500"
                    onClick={() => setSelectedFile(null)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-2 px-3 py-2.5 rounded-md border-2 border-dashed border-muted-foreground/20 cursor-pointer hover:border-primary/40 transition-colors text-sm text-muted-foreground">
                  <input
                    type="file"
                    className="sr-only"
                    accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.zip,.doc,.docx"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setSelectedFile(f);
                        setUploadedFile(null);
                      }
                    }}
                  />
                  <Paperclip className="h-4 w-4 shrink-0" />
                  Click to attach a portfolio or document
                </label>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={
              applying ||
              uploading ||
              !coverLetter.trim() ||
              !proposedTimeline.trim()
            }
          >
            {uploading
              ? "Uploading…"
              : applying
                ? "Applying..."
                : "Submit Application"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
