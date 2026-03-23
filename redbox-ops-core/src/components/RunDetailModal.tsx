import { useState, useEffect } from "react";
import {
  AlertTriangle, ShieldCheck, Info, Clock, Target, FileText,
  Loader2, Trash2, Download, X, ChevronDown, ChevronUp,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/StatusBadge";
import { orchestrator, reports, type Run, type Finding } from "@/services/api-client";
import { useToast } from "@/hooks/use-toast";

interface RunDetailModalProps {
  runId: string | null;
  open: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}

type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export function RunDetailModal({ runId, open, onClose, onDeleted }: RunDetailModalProps) {
  const { toast } = useToast();
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [generatingReport, setGeneratingReport] = useState(false);

  useEffect(() => {
    if (!runId || !open) {
      setRun(null);
      return;
    }

    setLoading(true);
    orchestrator
      .getRun(runId)
      .then(({ run: r }) => setRun(r))
      .catch((err) => {
        toast({
          title: "Failed to load run",
          description: err.error || "Unknown error",
          variant: "destructive",
        });
        onClose();
      })
      .finally(() => setLoading(false));
  }, [runId, open]);

  const handleDelete = async () => {
    if (!runId) return;
    setDeleting(true);
    try {
      await orchestrator.deleteRun(runId);
      toast({ title: "Run deleted", description: "The scan has been removed from history." });
      onDeleted?.();
      onClose();
    } catch (err) {
      toast({
        title: "Delete failed",
        description: (err as { error?: string }).error || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleGenerateReport = async (type: "executive" | "technical" | "full") => {
    if (!runId) return;
    setGeneratingReport(true);
    try {
      const { report } = await reports.generate(runId, type);
      toast({ title: "Report ready", description: `${type} report generated` });
      window.open(reports.downloadUrl(report.id, "md"), "_blank");
    } catch (err) {
      toast({
        title: "Report failed",
        description: (err as { error?: string }).error || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setGeneratingReport(false);
    }
  };

  const toggleStep = (idx: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const severityIcon = (s: FindingSeverity) => {
    if (s === "critical" || s === "high") return <AlertTriangle className="w-4 h-4 text-red-500" />;
    if (s === "medium") return <ShieldCheck className="w-4 h-4 text-yellow-500" />;
    return <Info className="w-4 h-4 text-blue-400" />;
  };

  const severityColor = (s: string) => {
    if (s === "critical") return "text-red-500";
    if (s === "high") return "text-orange-500";
    if (s === "medium") return "text-yellow-500";
    if (s === "low") return "text-blue-400";
    return "text-zinc-400";
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden bg-zinc-900 border-zinc-700 p-0">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-red-500" />
          </div>
        ) : run ? (
          <div className="flex flex-col h-full max-h-[90vh]">
            {/* Header */}
            <DialogHeader className="px-6 py-4 border-b border-zinc-700/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Target className="w-5 h-5 text-red-500" />
                  <div>
                    <DialogTitle className="text-zinc-100 font-mono text-lg">
                      {run.target}
                    </DialogTitle>
                    <DialogDescription className="text-zinc-400 font-mono text-xs mt-1">
                      {run.test_type} · {run.pipeline} · {run.purpose}
                    </DialogDescription>
                  </div>
                </div>
                <StatusBadge
                  variant={
                    run.status === "completed" ? "online"
                    : run.status === "failed" ? "offline"
                    : run.status === "running" ? "warning"
                    : "offline"
                  }
                  label={run.status}
                  pulse={run.status === "running"}
                />
              </div>
            </DialogHeader>

            {/* Content - scrollable */}
            <div className="flex-1 overflow-auto p-6 space-y-6">
              {/* Metadata */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-[10px] font-mono text-zinc-500 uppercase">Created</p>
                  <p className="text-sm font-mono text-zinc-200">
                    {new Date(run.created_at).toLocaleString()}
                  </p>
                </div>
                {run.completed_at && (
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">Completed</p>
                    <p className="text-sm font-mono text-zinc-200">
                      {new Date(run.completed_at).toLocaleString()}
                    </p>
                  </div>
                )}
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-[10px] font-mono text-zinc-500 uppercase">Findings</p>
                  <p className="text-sm font-mono text-zinc-200">
                    {run.findings?.length || 0}
                  </p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-[10px] font-mono text-zinc-500 uppercase">Run ID</p>
                  <p className="text-sm font-mono text-zinc-400 truncate" title={run.id}>
                    {run.id.slice(0, 8)}...
                  </p>
                </div>
              </div>

              {/* Scope */}
              {run.scope && (
                <div className="bg-zinc-800/50 rounded-lg p-4">
                  <p className="text-[10px] font-mono text-red-400/70 uppercase mb-2">// Scope / Notes</p>
                  <p className="text-sm font-mono text-zinc-300 whitespace-pre-wrap">{run.scope}</p>
                </div>
              )}

              {/* Findings */}
              {run.findings && run.findings.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-mono text-red-400/70 uppercase mb-3">// Findings ({run.findings.length})</h3>
                  <div className="space-y-2">
                    {run.findings.map((f, i) => (
                      <div
                        key={i}
                        className="bg-zinc-800/50 rounded-lg px-4 py-3 flex items-center gap-3"
                      >
                        {severityIcon(f.severity as FindingSeverity)}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-mono text-zinc-100">{f.title}</p>
                          <p className="text-[11px] font-mono text-zinc-500">
                            {f.cwe || "N/A"}{f.cve ? ` · ${f.cve}` : ""}
                            {f.confidence ? ` · ${f.confidence} confidence` : ""}
                          </p>
                        </div>
                        <span className={`text-xs font-mono uppercase ${severityColor(f.severity)}`}>
                          {f.severity}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Output steps */}
              {run.output && run.output.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-mono text-red-400/70 uppercase mb-3">// Pipeline Output</h3>
                  <div className="space-y-2">
                    {run.output.map((step, i) => (
                      <div key={i} className="bg-zinc-800/50 rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleStep(i)}
                          className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-700/30 transition-colors"
                        >
                          <span className="text-sm font-mono text-zinc-200">{step.step}</span>
                          {expandedSteps.has(i) ? (
                            <ChevronUp className="w-4 h-4 text-zinc-500" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-zinc-500" />
                          )}
                        </button>
                        {expandedSteps.has(i) && (
                          <div className="px-4 pb-4">
                            <pre className="text-xs font-mono text-zinc-400 whitespace-pre-wrap bg-black/30 rounded p-3 max-h-64 overflow-auto">
                              {step.output}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No findings / output message */}
              {(!run.findings || run.findings.length === 0) && (!run.output || run.output.length === 0) && (
                <div className="flex flex-col items-center justify-center py-10 text-zinc-500">
                  <FileText className="w-8 h-8 opacity-30 mb-2" />
                  <p className="text-sm font-mono">No findings or output recorded for this run.</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-zinc-700/50 flex items-center justify-between">
              <Button
                variant="outline"
                className="gap-2 border-red-500/40 text-red-400 hover:bg-red-500/10 font-mono"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </Button>

              <div className="flex gap-2">
                {run.status === "completed" && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-red-400 font-mono text-xs"
                      onClick={() => handleGenerateReport("executive")}
                      disabled={generatingReport}
                    >
                      <Download className="w-3.5 h-3.5" />
                      Executive
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-red-400 font-mono text-xs"
                      onClick={() => handleGenerateReport("technical")}
                      disabled={generatingReport}
                    >
                      <Download className="w-3.5 h-3.5" />
                      Technical
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-red-400 font-mono text-xs"
                      onClick={() => handleGenerateReport("full")}
                      disabled={generatingReport}
                    >
                      <Download className="w-3.5 h-3.5" />
                      Full
                    </Button>
                  </div>
                )}
                <Button
                  variant="outline"
                  className="gap-2 bg-zinc-800 border-zinc-700 text-zinc-300 font-mono"
                  onClick={onClose}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-20 text-zinc-500 font-mono">
            No run selected
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default RunDetailModal;
