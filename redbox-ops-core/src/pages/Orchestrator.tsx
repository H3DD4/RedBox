import { useState, useEffect, useRef, useCallback } from "react";
import {
  Crosshair, Upload, Play, Square, ChevronDown, AlertTriangle,
  ShieldCheck, Info, Loader2, Server, Bot, FileText, X, Download,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TerminalOutput, type TerminalLine } from "@/components/TerminalOutput";
import StatusBadge from "@/components/StatusBadge";
import {
  orchestrator, mcpServers, llmProviders, uploads, reports,
  type McpServer, type LlmProvider, type Finding, type Run,
} from "@/services/api-client";
import { useToast } from "@/hooks/use-toast";

const testTypes = ["Web Application","Executable (Win/Linux)","APK / Mobile","Network Infrastructure","OSINT Investigation","API Testing"];
const purposes  = ["CTF","Real-life Investigation","Red Team Simulation","Blue Team Validation","Malware Analysis","Research"];
const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, "") ?? "";

type FindingSeverity = "critical" | "high" | "medium" | "low" | "info" | "warning";
const now = () => new Date().toLocaleTimeString("en-US", { hour12: false });

const Orchestrator = () => {
  const { toast } = useToast();

  // ── Selectors from API ──
  const [mcpList,     setMcpList]     = useState<McpServer[]>([]);
  const [providerList,setProviderList]= useState<LlmProvider[]>([]);
  const [pipelines,   setPipelines]   = useState<string[]>([]);
  const [selMcp,      setSelMcp]      = useState("");
  const [selProvider, setSelProvider] = useState("");
  const [pipeline,    setPipeline]    = useState("real-pentesting");
  const [testType,    setTestType]    = useState(testTypes[0]);
  const [purpose,     setPurpose]     = useState(purposes[0]);
  const [target,      setTarget]      = useState("");
  const [scope,       setScope]       = useState("");

  // ── Run state ──
  const [isRunning, setIsRunning]     = useState(false);
  const [runId,     setRunId]         = useState<string | null>(null);
  const [output,    setOutput]        = useState<TerminalLine[]>([
    { type: "system", content: "RedBox Orchestrator — ready.", timestamp: now() },
    { type: "system", content: "Configure a task and press Execute.", timestamp: now() },
  ]);
  const [findings,  setFindings]      = useState<Finding[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  // ── Uploads ──
  const [uploadedFiles, setUploadedFiles] = useState<{ id: string; name: string }[]>([]);
  const [isUploading,   setIsUploading]   = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Run history ──
  const [runs,       setRuns]        = useState<Run[]>([]);
  const [showHistory,setShowHistory] = useState(false);

  const appendLine = useCallback((line: TerminalLine) =>
    setOutput((p) => [...p, line]), []);

  // Load selectors on mount
  useEffect(() => {
    mcpServers.list().then(({ servers }) => {
      setMcpList(servers);
      const def = servers.find((s) => s.is_default) || servers[0];
      if (def) setSelMcp(def.id);
    }).catch(() => {});

    llmProviders.list().then(({ providers }) => {
      setProviderList(providers);
      const active = providers.find((p) => p.active) || providers[0];
      if (active) setSelProvider(active.id);
    }).catch(() => {});

    orchestrator.pipelines().then(({ pipelines: ps }) => {
      const ids = ps.map((p) => p.id);
      setPipelines(ids);
      if (ids.length > 0 && !ids.includes(pipeline)) setPipeline(ids[0]);
    }).catch(() => {});

    orchestrator.listRuns().then(({ runs: r }) => setRuns(r)).catch(() => {});
  }, []);

  // File upload
  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    const added: { id: string; name: string }[] = [];
    for (const file of Array.from(files)) {
      try {
        const { upload } = await uploads.upload(file);
        added.push({ id: upload.id, name: upload.original_name });
      } catch (err) {
        toast({ title: "Upload failed", description: `${file.name}: ${(err as {error?:string}).error || "error"}`, variant: "destructive" });
      }
    }
    setUploadedFiles((p) => [...p, ...added]);
    setIsUploading(false);
  };

  // SSE stream handler
  const connectStream = useCallback((id: string) => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    const token = localStorage.getItem("redbox_token") || "";
    // EventSource doesn't support custom headers; use fetch streaming instead
    const ctrl = new AbortController();
    const url = `${BACKEND_URL}/api/orchestrator/runs/${id}/stream`;

    fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    }).then(async (res) => {
      if (!res.body) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as {
              type: string; step?: string; content?: string; data?: unknown;
            };
            if (ev.type === "step_start") {
              appendLine({ type: "info", content: `▶ Phase: ${ev.step}`, timestamp: now() });
            } else if (ev.type === "step_output" && ev.content) {
              appendLine({ type: "output", content: ev.content, timestamp: now() });
            } else if (ev.type === "step_complete") {
              appendLine({ type: "system", content: `✓ ${ev.step}: ${ev.content || "done"}`, timestamp: now() });
            } else if (ev.type === "finding") {
              const f = ev.data as Finding;
              setFindings((p) => [...p, f]);
            } else if (ev.type === "error") {
              appendLine({ type: "error", content: `Error (${ev.step || "run"}): ${ev.content}`, timestamp: now() });
            } else if (ev.type === "status") {
              appendLine({ type: "system", content: ev.content || "", timestamp: now() });
            } else if (ev.type === "complete") {
              appendLine({ type: "system", content: "— Run complete —", timestamp: now() });
              setIsRunning(false);
              orchestrator.listRuns().then(({ runs: r }) => setRuns(r)).catch(() => {});
              ctrl.abort();
            }
          } catch { /* skip */ }
        }
      }
    }).catch((err) => {
      if (err.name !== "AbortError") {
        appendLine({ type: "error", content: `Stream error: ${err.message}`, timestamp: now() });
        setIsRunning(false);
      }
    });

    return () => ctrl.abort();
  }, [appendLine]);

  const handleRun = async () => {
    if (!target.trim()) {
      toast({ title: "Target required", description: "Enter a target before executing.", variant: "destructive" });
      return;
    }
    setIsRunning(true);
    setFindings([]);
    setOutput([{ type: "system", content: `Starting: ${testType} on ${target}`, timestamp: now() }]);

    try {
      const { runId: id } = await orchestrator.startRun({
        target, scope, testType, purpose, pipeline,
        mcpServerId: selMcp || undefined,
        llmProviderId: selProvider || undefined,
        uploadIds: uploadedFiles.map((f) => f.id),
      });
      setRunId(id);
      appendLine({ type: "info", content: `Run ID: ${id}`, timestamp: now() });
      connectStream(id);
    } catch (err) {
      const msg = (err as { error?: string }).error || "Failed to start run";
      appendLine({ type: "error", content: msg, timestamp: now() });
      toast({ title: "Run failed", description: msg, variant: "destructive" });
      setIsRunning(false);
    }
  };

  const handleStop = async () => {
    if (!runId) return;
    try { await orchestrator.stopRun(runId); } catch { /* ignore */ }
    appendLine({ type: "system", content: "Run stopped by user.", timestamp: now() });
    setIsRunning(false);
  };

  const handleGenerateReport = async (type: "executive" | "technical" | "full") => {
    if (!runId) return;
    try {
      const { report } = await reports.generate(runId, type);
      toast({ title: "Report ready", description: `${type} report generated (ID: ${report.id.slice(0,8)})` });
      window.open(reports.downloadUrl(report.id, "md"), "_blank");
    } catch (err) {
      toast({ title: "Report failed", description: (err as {error?:string}).error || "error", variant: "destructive" });
    }
  };

  const severityIcon = (s: FindingSeverity) => {
    if (s === "critical" || s === "high") return <AlertTriangle className="w-4 h-4 text-primary" />;
    if (s === "medium" || s === "warning") return <ShieldCheck className="w-4 h-4 text-warning" />;
    return <Info className="w-4 h-4 text-info" />;
  };

  const activeProvider = providerList.find((p) => p.id === selProvider);
  const activeMcp       = mcpList.find((s) => s.id === selMcp);

  return (
    <AppLayout>
      <div className="space-y-6 animate-slide-up font-mono">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl text-zinc-100 font-mono font-bold uppercase tracking-[0.15em] flex items-center gap-2">
              <Crosshair className="w-6 h-6 text-red-500" /> // AI Pentest Orchestrator
            </h1>
            <p className="text-zinc-400 font-mono text-xs mt-1">Configure and launch AI-driven security assessments</p>
          </div>
          <div className="flex gap-2">
            {isRunning ? (
              <Button onClick={handleStop} variant="outline" className="gap-2 border-red-500/40 text-red-400 hover:bg-red-500/10 font-mono">
                <Square className="w-4 h-4" /> Stop
              </Button>
            ) : (
              <Button onClick={handleRun} className="bg-red-600 text-white hover:bg-red-500 font-mono uppercase tracking-wider gap-2">
                <Play className="w-4 h-4" /> Execute
              </Button>
            )}
            <Button
              variant="outline"
              className="gap-2 bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-red-400 font-mono"
              onClick={() => setShowHistory(!showHistory)}
            >
              <FileText className="w-4 h-4" /> History
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Config Panel */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-5 space-y-4">
              <h3 className="text-zinc-200 font-mono text-xs uppercase tracking-[0.15em]">// Task Configuration</h3>

              {/* MCP Server */}
              <div>
                <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 flex items-center gap-1">
                  <Server className="w-3 h-3" /> // MCP Server
                </label>
                <div className="relative">
                  <select
                    value={selMcp}
                    onChange={(e) => setSelMcp(e.target.value)}
                    className="w-full bg-zinc-800/80 border border-zinc-700 text-zinc-200 font-mono rounded-md px-3 py-2 text-sm appearance-none cursor-pointer"
                  >
                    {mcpList.length === 0 && <option value="">No servers configured</option>}
                    {mcpList.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}{s.is_default ? " (default)" : ""}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              {/* Pipeline */}
              <div>
                <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 block">// Pipeline</label>
                <div className="relative">
                  <select
                    value={pipeline}
                    onChange={(e) => setPipeline(e.target.value)}
                    className="w-full bg-zinc-800/80 border border-zinc-700 text-zinc-200 font-mono rounded-md px-3 py-2 text-sm appearance-none cursor-pointer"
                  >
                    {pipelines.length === 0 && <option value="real-pentesting">real-pentesting</option>}
                    {pipelines.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              {/* Test Type */}
              <div>
                <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 block">// Test Type</label>
                <div className="relative">
                  <select value={testType} onChange={(e) => setTestType(e.target.value)} className="w-full bg-zinc-800/80 border border-zinc-700 text-zinc-200 font-mono rounded-md px-3 py-2 text-sm appearance-none cursor-pointer">
                    {testTypes.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              {/* Purpose */}
              <div>
                <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 block">// Purpose</label>
                <div className="relative">
                  <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className="w-full bg-zinc-800/80 border border-zinc-700 text-zinc-200 font-mono rounded-md px-3 py-2 text-sm appearance-none cursor-pointer">
                    {purposes.map((p) => <option key={p}>{p}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              {/* LLM Provider */}
              <div>
                <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 flex items-center gap-1">
                  <Bot className="w-3 h-3" /> // LLM Provider
                </label>
                <div className="relative">
                  <select
                    value={selProvider}
                    onChange={(e) => setSelProvider(e.target.value)}
                    className="w-full bg-zinc-800/80 border border-zinc-700 text-zinc-200 font-mono rounded-md px-3 py-2 text-sm appearance-none cursor-pointer"
                  >
                    {providerList.length === 0 && <option value="">No providers configured</option>}
                    {providerList.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} — {p.model}{p.active ? " (active)" : ""}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              {/* Target */}
              <div>
                <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 block">// Target</label>
                <Input
                  placeholder="https://target.com or 10.0.0.1"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="bg-black/60 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 font-mono text-sm"
                />
              </div>

              {/* Scope */}
              <div>
                <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 block">// Scope / Notes</label>
                <Textarea
                  placeholder="Define scope, exclusions, notes..."
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  className="bg-black/60 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 font-mono text-sm min-h-[80px]"
                />
              </div>

              {/* File Upload */}
              <div>
                <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 block">// Artifacts</label>
                <div
                  className="border border-dashed border-zinc-700 rounded-md p-4 text-center hover:border-red-500/30 transition-colors cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); handleFileSelect(e.dataTransfer.files); }}
                >
                  <Upload className="w-5 h-5 text-zinc-500 mx-auto mb-2" />
                  <p className="text-xs text-zinc-500 font-mono">
                    {isUploading ? "Uploading..." : "Drop EXE, APK, PCAP or click"}
                  </p>
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFileSelect(e.target.files)} />
                </div>
                {uploadedFiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {uploadedFiles.map((f) => (
                      <div key={f.id} className="flex items-center gap-2 text-xs text-zinc-400 font-mono bg-zinc-800/60 rounded px-2 py-1">
                        <FileText className="w-3 h-3 shrink-0" />
                        <span className="truncate flex-1">{f.name}</span>
                        <button onClick={() => setUploadedFiles((p) => p.filter((x) => x.id !== f.id))}>
                          <X className="w-3 h-3 hover:text-red-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Report buttons (visible after a run) */}
            {runId && !isRunning && (
              <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-4 space-y-2">
                <p className="text-zinc-200 font-mono text-xs uppercase tracking-[0.15em] mb-2">// Generate Report</p>
                {(["executive","technical","full"] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => handleGenerateReport(type)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 hover:text-red-400 hover:border-red-500/30 font-mono rounded-md transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {type.charAt(0).toUpperCase() + type.slice(1)} Report (.md)
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Output Panel */}
          <div className="lg:col-span-2 space-y-4">
            {/* Live Output */}
            <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg">
              <div className="p-4 border-b border-zinc-700/50 flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isRunning ? "bg-red-500 animate-pulse-glow" : "bg-zinc-500"}`} />
                <h3 className="text-zinc-200 font-mono text-xs uppercase tracking-[0.15em]">// Live Output</h3>
                {activeProvider && (
                  <span className="text-[10px] text-zinc-500 font-mono ml-2 opacity-60">
                    {activeProvider.name} / {activeProvider.model}
                  </span>
                )}
                {isRunning && <span className="text-xs text-red-400 animate-pulse font-mono ml-auto">Running…</span>}
              </div>
              <div className="p-4">
                <TerminalOutput lines={output} className="min-h-[300px] max-h-[500px]" />
              </div>
            </div>

            {/* Findings */}
            <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg">
              <div className="p-4 border-b border-zinc-700/50 flex items-center justify-between">
                <h3 className="text-zinc-200 font-mono text-xs uppercase tracking-[0.15em]">// Findings</h3>
                <span className="text-xs font-mono text-zinc-400">{findings.length} item{findings.length !== 1 ? "s" : ""}</span>
              </div>
              {findings.length === 0 ? (
                <div className="flex items-center justify-center py-10 text-zinc-500 font-mono text-sm">
                  No findings yet — execute a task.
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/60 max-h-72 overflow-auto">
                  {findings.map((f, i) => (
                    <div key={i} className="px-5 py-3.5 flex items-center justify-between hover:bg-zinc-900/50 transition-colors">
                      <div className="flex items-center gap-3">
                        {severityIcon(f.severity as FindingSeverity)}
                        <div>
                          <p className="text-sm text-zinc-100 font-mono">{f.title}</p>
                          <p className="text-[11px] font-mono text-zinc-400">{f.cwe}{f.cve ? ` / ${f.cve}` : ""}</p>
                        </div>
                      </div>
                      <StatusBadge
                        variant={["critical","high"].includes(f.severity) ? "offline" : f.severity === "medium" ? "warning" : "online"}
                        label={f.severity}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Run History Panel */}
            {showHistory && (
              <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg">
                <div className="p-4 border-b border-zinc-700/50">
                  <h3 className="text-zinc-200 font-mono text-xs uppercase tracking-[0.15em]">// Run History</h3>
                </div>
                {runs.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-zinc-500 font-mono text-sm">No runs yet.</div>
                ) : (
                  <div className="divide-y divide-zinc-800/60 max-h-64 overflow-auto">
                    {runs.map((r) => (
                      <div key={r.id} className="px-5 py-3 flex items-center justify-between text-sm hover:bg-zinc-900/50 transition-colors">
                        <div>
                          <p className="font-mono text-zinc-100">{r.target}</p>
                          <p className="text-[11px] font-mono text-zinc-400">{r.pipeline} · {new Date(r.created_at).toLocaleString()}</p>
                        </div>
                        <StatusBadge
                          variant={r.status === "completed" ? "online" : r.status === "failed" ? "offline" : "warning"}
                          label={r.status}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Orchestrator;
