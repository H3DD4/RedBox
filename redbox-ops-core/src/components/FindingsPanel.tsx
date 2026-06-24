import React from "react";
import { AlertCircle, Target, Activity } from "lucide-react";
import { Finding } from "@/services/api-client";

interface FindingEvent {
  type: string;
  description: string;
  confidenceDelta: number;
  evidence: Record<string, unknown>;
  timestamp: string;
}

interface FindingsPanelProps {
  findings: Finding[];
  liveEvents: FindingEvent[];
  currentConfidence: number;
}

const severityColors: Record<string, string> = {
  critical: "bg-red-500/20 text-red-500 border-red-500/30",
  high: "bg-orange-500/20 text-orange-500 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30",
  low: "bg-green-500/20 text-green-500 border-green-500/30",
  info: "bg-blue-500/20 text-blue-500 border-blue-500/30",
};

const FindingsPanel: React.FC<FindingsPanelProps> = ({ findings, liveEvents, currentConfidence }) => {
  return (
    <div className="flex flex-col h-full border border-border rounded-lg bg-card overflow-hidden">
      <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">Findings & Confidence</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Overall Confidence:</span>
          <div className="flex items-center gap-1 font-mono text-xs font-medium">
            <span className={currentConfidence > 50 ? "text-green-500" : "text-yellow-500"}>
              {Math.min(100, Math.max(0, currentConfidence))}%
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Confirmed Findings */}
        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> Confirmed Vulns ({findings.length})
          </h4>
          {findings.length === 0 ? (
            <div className="text-xs text-muted-foreground italic pl-4">No confirmed findings yet.</div>
          ) : (
            <div className="space-y-2">
              {findings.map((f, i) => (
                <div key={i} className={`p-2 rounded-md border text-xs ${severityColors[f.severity || "info"]}`}>
                  <div className="font-bold mb-1">{f.title}</div>
                  <div className="opacity-80 line-clamp-2">{f.evidence}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live Finding Stream */}
        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
            <Activity className="h-3 w-3" /> Live Signal Stream
          </h4>
          {liveEvents.length === 0 ? (
            <div className="text-xs text-muted-foreground italic pl-4">Waiting for signals...</div>
          ) : (
            <div className="space-y-1">
              {liveEvents.slice().reverse().map((ev, i) => (
                <div key={i} className="flex gap-2 text-xs py-1 border-b border-border/50 last:border-0">
                  <span className="text-muted-foreground shrink-0">{new Date(ev.timestamp).toLocaleTimeString([], {hour12: false})}</span>
                  <div className="flex-1">
                    <span className="font-medium text-primary mr-1">[{ev.type}]</span>
                    <span className="text-foreground/80">{ev.description}</span>
                  </div>
                  {ev.confidenceDelta !== 0 && (
                    <span className={`shrink-0 font-mono ${ev.confidenceDelta > 0 ? "text-green-500" : "text-red-500"}`}>
                      {ev.confidenceDelta > 0 ? "+" : ""}{ev.confidenceDelta}%
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FindingsPanel;
