import React, { useState } from "react";
import { X, Trophy, Save, MessageSquare, Flag, Clock, Target } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export interface RunFeedbackSummary {
  runId: string;
  target: string;
  capturedFlag: string | null;
  findingsCount: number;
  completedAt: string;
}

interface ScoringModalProps {
  summary: RunFeedbackSummary;
  onDismiss: () => void;
  onSubmit: (score: number, remarks: string) => Promise<void>;
  onSkip: () => Promise<void>;
}

const ScoringModal: React.FC<ScoringModalProps> = ({ summary, onDismiss, onSubmit, onSkip }) => {
  const [score, setScore] = useState<number>(8);
  const [remarks, setRemarks] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(score, remarks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit score");
      setIsSubmitting(false);
    }
  };

  const handleSkip = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onSkip();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to skip scoring");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-xl border border-border bg-card shadow-2xl relative">
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-4 top-4 z-10 text-muted-foreground hover:text-foreground"
          disabled={isSubmitting}
          aria-label="Close and rate later"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6 pb-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3 pr-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Trophy className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Post-Run Feedback</h2>
              <p className="text-sm text-muted-foreground">Review the outcome, then rate the agent.</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-start gap-2 text-sm">
              <Target className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target</div>
                <div className="font-mono text-sm break-all">{summary.target}</div>
              </div>
            </div>

            <div className="flex items-start gap-2 text-sm">
              <Flag className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Captured Flag</div>
                {summary.capturedFlag ? (
                  <div className="mt-1 rounded-md bg-background border border-border px-3 py-2 font-mono text-sm font-semibold text-green-500 break-all">
                    {summary.capturedFlag}
                  </div>
                ) : (
                  <div className="mt-1 text-sm text-muted-foreground italic">No flag captured during this run.</div>
                )}
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              {summary.findingsCount} finding{summary.findingsCount === 1 ? "" : "s"} recorded
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-3">Overall Performance ({score}/10)</label>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={score}
              onChange={(e) => setScore(parseInt(e.target.value, 10))}
              className="w-full accent-primary"
              disabled={isSubmitting}
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Poor</span>
              <span>Excellent</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Feedback Remarks
            </label>
            <Textarea
              placeholder="What did the agent do well? Where did it waste time?"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="resize-none h-24"
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="p-6 pt-4 border-t border-border shrink-0 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onDismiss}
            disabled={isSubmitting}
          >
            <Clock className="mr-2 h-4 w-4" />
            Rate Later
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleSkip}
            disabled={isSubmitting}
          >
            Skip & Close
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : <><Save className="mr-2 h-4 w-4" /> Save Score</>}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ScoringModal;
