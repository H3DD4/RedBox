import type { Finding } from "@/services/api-client";
import type { RunFeedbackSummary } from "@/components/ScoringModal";

const SUBMITTED_KEY = "redbox_feedback_submitted";
const PENDING_KEY = "redbox_pending_feedback";

export function loadSubmittedFeedbackRuns(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SUBMITTED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function markFeedbackSubmitted(runId: string): void {
  const submitted = loadSubmittedFeedbackRuns();
  submitted.add(runId);
  sessionStorage.setItem(SUBMITTED_KEY, JSON.stringify([...submitted]));
  clearPendingFeedback(runId);
}

export function loadPendingFeedback(): RunFeedbackSummary | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RunFeedbackSummary;
    if (!parsed?.runId) return null;
    if (loadSubmittedFeedbackRuns().has(parsed.runId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePendingFeedback(summary: RunFeedbackSummary): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(summary));
}

export function clearPendingFeedback(runId: string): void {
  const pending = loadPendingFeedback();
  if (pending?.runId === runId) {
    sessionStorage.removeItem(PENDING_KEY);
  }
}

export function extractCapturedFlag(
  flag: string | null | undefined,
  findings: Finding[]
): string | null {
  if (flag?.trim()) return flag.trim();

  for (const finding of findings) {
    const titleMatch = finding.title?.match(/flag captured[:\s]+(.+)/i);
    if (titleMatch?.[1]) return titleMatch[1].trim();

    const evidenceMatch = finding.evidence?.match(
      /(picoCTF\{[^}]+\}|HTB\{[^}]+\}|flag\{[^}]+\}|CTF\{[^}]+\})/i
    );
    if (evidenceMatch?.[1]) return evidenceMatch[1];
  }

  return null;
}
