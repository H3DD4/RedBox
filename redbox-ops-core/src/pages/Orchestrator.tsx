import { useState, useEffect, useRef, useCallback } from "react";
import {
  Crosshair, Upload, Play, Square, ChevronDown, AlertTriangle,
  ShieldCheck, Info, Loader2, Server, Bot, FileText, X, Download, Trash2, Zap,
  Trophy, Flag,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TerminalOutput, type TerminalLine } from "@/components/TerminalOutput";
import StatusBadge from "@/components/StatusBadge";
import RunDetailModal from "@/components/RunDetailModal";
import {
  orchestrator, mcpServers, llmProviders, uploads, reports,
  type McpServer, type LlmProvider, type Finding, type Run,
  type TestTypeOption, type PurposeOption, type RouteInfo,
} from "@/services/api-client";
import { useToast } from "@/hooks/use-toast";

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, "") ?? "";

type FindingSeverity = "critical" | "high" | "medium" | "low" | "info" | "warning";
const now = () => new Date().toLocaleTimeString("en-US", { hour12: false });

const ORCHESTRATOR_SESSION_KEY = "redbox_orchestrator_session_v1";
const DEFAULT_OUTPUT_LINES: TerminalLine[] = [
  { type: "system", content: "RedBox Orchestrator — ready.", timestamp: now() },
  { type: "system", content: "Select test type and purpose to see the prompt that will be executed.", timestamp: now() },
];

interface OrchestratorSessionState {
  selMcp: string;
  selProvider: string;
  testType: string;
  purpose: string;
  target: string;
  scope: string;
  challengeName: string;
  flagFormat: string;
  loginInstructions: string;
  rulesAvoid: string;
  rulesFocus: string;
  isRunning: boolean;
  runId: string | null;
  output: TerminalLine[];
  findings: Finding[];
  uploadedFiles: { id: string; name: string; path?: string }[];
  showHistory: boolean;
}

function loadOrchestratorSessionState(): OrchestratorSessionState | null {
  try {
    const raw = sessionStorage.getItem(ORCHESTRATOR_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OrchestratorSessionState>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      selMcp: typeof parsed.selMcp === "string" ? parsed.selMcp : "",
      selProvider: typeof parsed.selProvider === "string" ? parsed.selProvider : "",
      testType: typeof parsed.testType === "string" ? parsed.testType : "",
      purpose: typeof parsed.purpose === "string" ? parsed.purpose : "",
      target: typeof parsed.target === "string" ? parsed.target : "",
      scope: typeof parsed.scope === "string" ? parsed.scope : "",
      challengeName: typeof parsed.challengeName === "string" ? parsed.challengeName : "",
      flagFormat: typeof parsed.flagFormat === "string" ? parsed.flagFormat : "",
      loginInstructions: typeof parsed.loginInstructions === "string" ? parsed.loginInstructions : "",
      rulesAvoid: typeof parsed.rulesAvoid === "string" ? parsed.rulesAvoid : "",
      rulesFocus: typeof parsed.rulesFocus === "string" ? parsed.rulesFocus : "",
      isRunning: Boolean(parsed.isRunning),
      runId: typeof parsed.runId === "string" ? parsed.runId : null,
      output: Array.isArray(parsed.output) ? parsed.output as TerminalLine[] : DEFAULT_OUTPUT_LINES,
      findings: Array.isArray(parsed.findings) ? parsed.findings as Finding[] : [],
      uploadedFiles: Array.isArray(parsed.uploadedFiles)
        ? parsed.uploadedFiles.filter((f): f is { id: string; name: string; path?: string } =>
            !!f && typeof f === "object" && typeof (f as { id?: unknown }).id === "string" && typeof (f as { name?: unknown }).name === "string"
          )
        : [],
      showHistory: Boolean(parsed.showHistory),
    };
  } catch {
    return null;
  }
}

function saveOrchestratorSessionState(state: OrchestratorSessionState): void {
  try {
    sessionStorage.setItem(ORCHESTRATOR_SESSION_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage write failures.
  }
}

const Orchestrator = () => {
  const { toast } = useToast();
  const initialSessionRef = useRef<OrchestratorSessionState | null>(loadOrchestratorSessionState());

  // ── Config from API ──
  const [testTypes, setTestTypes] = useState<TestTypeOption[]>([]);
  const [purposes, setPurposes] = useState<PurposeOption[]>([]);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);

  // ── Selectors ──
  const [mcpList, setMcpList] = useState<McpServer[]>([]);
  const [providerList, setProviderList] = useState<LlmProvider[]>([]);
  const [selMcp, setSelMcp] = useState(initialSessionRef.current?.selMcp ?? "");
  const [selProvider, setSelProvider] = useState(initialSessionRef.current?.selProvider ?? "");
  const [testType, setTestType] = useState(initialSessionRef.current?.testType ?? "");
  const [purpose, setPurpose] = useState(initialSessionRef.current?.purpose ?? "");
  const [target, setTarget] = useState(initialSessionRef.current?.target ?? "");
  const [scope, setScope] = useState(initialSessionRef.current?.scope ?? "");
  const [challengeName, setChallengeName] = useState(initialSessionRef.current?.challengeName ?? "");
  // FIXED: UI-01, UI-04 — new form state variables
  const [flagFormat, setFlagFormat] = useState(initialSessionRef.current?.flagFormat ?? "");
  const [loginInstructions, setLoginInstructions] = useState(initialSessionRef.current?.loginInstructions ?? "");
  const [rulesAvoid, setRulesAvoid] = useState(initialSessionRef.current?.rulesAvoid ?? "");
  const [rulesFocus, setRulesFocus] = useState(initialSessionRef.current?.rulesFocus ?? "");

  // ── Run state ──
  const [isRunning, setIsRunning] = useState(initialSessionRef.current?.isRunning ?? false);
  const [runId, setRunId] = useState<string | null>(initialSessionRef.current?.runId ?? null);
  const [output, setOutput] = useState<TerminalLine[]>(
    initialSessionRef.current?.output?.length ? initialSessionRef.current.output : DEFAULT_OUTPUT_LINES
  );
  const [findings, setFindings] = useState<Finding[]>(initialSessionRef.current?.findings ?? []);
  const streamAbortRef = useRef<AbortController | null>(null);

  // ── Uploads ──
  const [uploadedFiles, setUploadedFiles] = useState<{ id: string; name: string; path?: string }[]>(initialSessionRef.current?.uploadedFiles ?? []);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Run history ──
  const [runs, setRuns] = useState<Run[]>([]);
  const [showHistory, setShowHistory] = useState(initialSessionRef.current?.showHistory ?? false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);

  // ── MCP Tool Testing ──
  const [isTestingTools, setIsTestingTools] = useState(false);
  const [toolTestResults, setToolTestResults] = useState<{
    serverStatus?: 'connected' | 'disconnected' | 'error';
    availableTools?: string[];
    missingTools?: string[];
    toolsStatus?: Record<string, 'available' | 'missing' | 'error'>;
    error?: string;
    totalTested?: number;
    availableCount?: number;
    missingCount?: number;
  } | null>(null);
  const [showToolTestResults, setShowToolTestResults] = useState(false);

  const refreshRuns = () => {
    orchestrator.listRuns().then(({ runs: r }) => setRuns(r)).catch(() => {});
  };

  // Handle MCP tool testing
  const handleTestTools = async () => {
    if (isTestingTools) return;

    setIsTestingTools(true);
    setToolTestResults(null);
    setShowToolTestResults(false);

    try {
      appendLine({
        type: "system",
        content: "🔍 Testing MCP tool availability...",
        timestamp: now()
      });

      const response = await orchestrator.testTools(selMcp || undefined);

      if (response.success) {
        const { results, summary } = response;

        setToolTestResults({
          serverStatus: results.serverStatus,
          availableTools: results.availableTools,
          missingTools: results.missingTools,
          toolsStatus: results.toolsStatus,
          error: results.error,
          totalTested: summary.totalTested,
          availableCount: summary.availableCount,
          missingCount: summary.missingCount
        });

        appendLine({
          type: "success",
          content: `✅ Tool test completed: ${summary.availableCount}/${summary.totalTested} tools available`,
          timestamp: now()
        });

        if (summary.missingCount > 0) {
          appendLine({
            type: "warning",
            content: `⚠️ ${summary.missingCount} tools missing or unavailable. Check results for details.`,
            timestamp: now()
          });
        }

        setShowToolTestResults(true);
      } else {
        appendLine({
          type: "error",
          content: "❌ Tool test failed. Check MCP server connection.",
          timestamp: now()
        });
      }
    } catch (error) {
      console.error("Tool test error:", error);
      appendLine({
        type: "error",
        content: `❌ Tool test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: now()
      });
    } finally {
      setIsTestingTools(false);
    }
  };

  // Helper function to get appropriate target field info based on test type
  const getTargetFieldInfo = (testType: string) => {
    switch (testType) {
      case "web-application":
      case "api":
        return {
          label: "// Target URL",
          placeholder: "https://target.com or http://10.0.0.1:8080"
        };
      case "reverse-engineering":
      case "binary-exploitation":
        return {
          label: "// Binary File",
          placeholder: "C:\\path\\to\\binary.exe or /path/to/executable"
        };
      case "forensics":
        return {
          label: "// Evidence File",
          placeholder: "C:\\evidence\\memory.dump or /evidence/disk.img"
        };
      case "cryptography":
        return {
          label: "// Cipher / Data",
          placeholder: "VGhpcyBpcyBlbmNyeXB0ZWQgZGF0YQ== or encrypted_file.txt"
        };
      case "mobile-app":
        return {
          label: "// APK/IPA File",
          placeholder: "C:\\apps\\target.apk or /apps/target.ipa"
        };
      case "network":
        return {
          label: "// Network Target",
          placeholder: "10.0.0.1/24 or network.pcap"
        };
      case "osint":
        return {
          label: "// Target Entity",
          placeholder: "company.com or @username or John Doe"
        };
      default:
        return {
          label: "// Target",
          placeholder: "Enter target (URL, file, IP, etc.)"
        };
    }
  };

  const targetInfo = getTargetFieldInfo(testType);

  const appendLine = useCallback((line: TerminalLine) =>
    setOutput((p) => [...p, line]), []);

  // Load config on mount
  useEffect(() => {
    orchestrator.config().then(({ testTypes: tt, purposes: pp }) => {
      setTestTypes(tt);
      setPurposes(pp);
      setTestType((prev) => prev || tt[0]?.value || "");
      setPurpose((prev) => prev || pp[0]?.value || "");
    }).catch(() => {});

    mcpServers.list().then(({ servers }) => {
      setMcpList(servers);
      const def = servers.find((s) => s.is_default) || servers[0];
      if (def) {
        setSelMcp((prev) => prev || def.id);
      }
    }).catch(() => {});

    llmProviders.list().then(({ providers }) => {
      setProviderList(providers);
      const active = providers.find((p) => p.active) || providers[0];
      if (active) {
        setSelProvider((prev) => prev || active.id);
      }
    }).catch(() => {});

    refreshRuns();
  }, []);

  // Update route info when test type or purpose changes
  useEffect(() => {
    if (!testType || !purpose) {
      setRouteInfo(null);
      return;
    }
    orchestrator.routeInfo(testType, purpose).then(({ route }) => {
      setRouteInfo(route);
    }).catch(() => setRouteInfo(null));
  }, [testType, purpose]);

  useEffect(() => {
    saveOrchestratorSessionState({
      selMcp,
      selProvider,
      testType,
      purpose,
      target,
      scope,
      challengeName,
      flagFormat,
      loginInstructions,
      rulesAvoid,
      rulesFocus,
      isRunning,
      runId,
      output: output.slice(-400),
      findings: findings.slice(-200),
      uploadedFiles,
      showHistory,
    });
  }, [
    selMcp,
    selProvider,
    testType,
    purpose,
    target,
    scope,
    challengeName,
    flagFormat,
    loginInstructions,
    rulesAvoid,
    rulesFocus,
    isRunning,
    runId,
    output,
    findings,
    uploadedFiles,
    showHistory,
  ]);

  // File upload
  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    const added: { id: string; name: string; path: string }[] = [];
    for (const file of Array.from(files)) {
      try {
        const { upload } = await uploads.upload(file);
        added.push({ id: upload.id, name: upload.original_name, path: upload.file_path || upload.original_name });
      } catch (err) {
        toast({ title: "Upload failed", description: `${file.name}: ${(err as {error?:string}).error || "error"}`, variant: "destructive" });
      }
    }
    setUploadedFiles((p) => [...p, ...added]);

    // Auto-fill target for file-based test types if target is empty
    const fileBasedTypes = ["reverse-engineering", "binary-exploitation", "forensics", "cryptography", "mobile-app"];
    if (fileBasedTypes.includes(testType) && !target.trim() && added.length > 0) {
      // Use the first uploaded file's path as target
      setTarget(added[0].path);
    }

    setIsUploading(false);
  };

  // SSE stream handler
  const connectStream = useCallback((id: string) => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
    }

    const token = localStorage.getItem("redbox_token") || "";
    const ctrl = new AbortController();
    streamAbortRef.current = ctrl;
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
            } else if (ev.type === "mcp_call" || ev.type === "tool_call") {
              appendLine({ type: "info", content: `🔧 Tool: ${ev.content}`, timestamp: now() });
            } else if (ev.type === "mcp_result" || ev.type === "tool_result") {
              appendLine({ type: "output", content: `   ↳ ${ev.content}`, timestamp: now() });
            } else if (ev.type === "complete") {
              appendLine({ type: "system", content: "— Run complete —", timestamp: now() });
              setIsRunning(false);
              refreshRuns();
              streamAbortRef.current = null;
              ctrl.abort();
            }
          } catch { /* skip */ }
        }
      }
    }).catch((err) => {
      streamAbortRef.current = null;
      if (err.name !== "AbortError") {
        appendLine({ type: "error", content: `Stream error: ${err.message}`, timestamp: now() });
        setIsRunning(false);
      }
    });
  }, [appendLine]);

  useEffect(() => {
    if (!runId) return;

    let cancelled = false;
    orchestrator.getRun(runId)
      .then(({ run }) => {
        if (cancelled) return;

        if (Array.isArray(run.findings)) {
          setFindings(run.findings);
        }

        if (Array.isArray(run.output) && run.output.length > 0) {
          setOutput((prev) => {
            if (prev.length > DEFAULT_OUTPUT_LINES.length) return prev;
            return run.output.slice(-120).map((entry) => ({
              type: "output",
              content: `${entry.step}: ${entry.output}`,
              timestamp: now(),
            } as TerminalLine));
          });
        }

        const active = run.status === "running" || run.status === "pending";
        setIsRunning(active);
        if (active) {
          connectStream(runId);
        }
      })
      .catch(() => {
        if (!cancelled && isRunning) {
          connectStream(runId);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runId, connectStream]);

  useEffect(() => {
    return () => {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
    };
  }, []);

  const handleRun = async () => {
    // Target is required UNLESS files are uploaded
    if (!target.trim() && uploadedFiles.length === 0) {
      toast({ title: "Target required", description: "Enter a target or upload files before executing.", variant: "destructive" });
      return;
    }
    if (!routeInfo) {
      toast({ title: "Invalid configuration", description: "Select a valid test type and purpose combination.", variant: "destructive" });
      return;
    }
    setIsRunning(true);
    setFindings([]);

    // Use uploaded file name as target display if no explicit target
    const displayTarget = target.trim() || (uploadedFiles.length > 0 ? uploadedFiles.map(f => f.name).join(", ") : "N/A");

    setOutput([
      { type: "system", content: `Starting: ${routeInfo.description}`, timestamp: now() },
      { type: "info", content: `Target: ${displayTarget}`, timestamp: now() },
      { type: "info", content: `Pipeline: ${routeInfo.pipeline} → ${routeInfo.promptFile || "direct"}`, timestamp: now() },
      ...(uploadedFiles.length > 0 ? [{ type: "info" as const, content: `Files: ${uploadedFiles.map(f => f.name).join(", ")}`, timestamp: now() }] : []),
    ]);

    try {
      const { runId: id } = await orchestrator.startRun({
        target,
        scope,
        testType,
        purpose,
        mcpServerId: selMcp || undefined,
        llmProviderId: selProvider || undefined,
        uploadIds: uploadedFiles.map((f) => f.id),
        challengeName: purpose === "ctf" ? challengeName : undefined,
        // FIXED: UI-01, UI-04 — include new optional fields
        flagFormat: flagFormat || undefined,
        loginInstructions: loginInstructions || undefined,
        rulesAvoid: rulesAvoid || undefined,
        rulesFocus: rulesFocus || undefined,
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
      window.open(reports.downloadUrl(report.id, "html"), "_blank");
    } catch (err) {
      toast({ title: "Report failed", description: (err as {error?:string}).error || "error", variant: "destructive" });
    }
  };

  const handleDeleteRun = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingRunId(id);
    try {
      await orchestrator.deleteRun(id);
      toast({ title: "Run deleted", description: "The scan has been removed from history." });
      refreshRuns();
    } catch (err) {
      toast({ title: "Delete failed", description: (err as {error?:string}).error || "error", variant: "destructive" });
    } finally {
      setDeletingRunId(null);
    }
  };

  const severityIcon = (s: FindingSeverity) => {
    if (s === "critical" || s === "high") return <AlertTriangle className="w-4 h-4 text-primary" />;
    if (s === "medium" || s === "warning") return <ShieldCheck className="w-4 h-4 text-warning" />;
    return <Info className="w-4 h-4 text-info" />;
  };

  const activeProvider = providerList.find((p) => p.id === selProvider);

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

              {/* Test Type */}
              <div>
                <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 block">// Test Type</label>
                <div className="relative">
                  <select
                    value={testType}
                    onChange={(e) => setTestType(e.target.value)}
                    className="w-full bg-zinc-800/80 border border-zinc-700 text-zinc-200 font-mono rounded-md px-3 py-2 text-sm appearance-none cursor-pointer"
                  >
                    {testTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              {/* Purpose */}
              <div>
                <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 block">// Purpose</label>
                <div className="relative">
                  <select
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    className="w-full bg-zinc-800/80 border border-zinc-700 text-zinc-200 font-mono rounded-md px-3 py-2 text-sm appearance-none cursor-pointer"
                  >
                    {purposes.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              {/* Route Info Badge */}
              {routeInfo && (
                <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-md p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-[10px] font-mono text-red-400 uppercase">Smart Route</span>
                  </div>
                  <p className="text-xs font-mono text-zinc-300">{routeInfo.description}</p>
                  <p className="text-[10px] font-mono text-zinc-500 mt-1">
                    Pipeline: {routeInfo.pipeline} → {routeInfo.promptFile || "direct analysis"}
                  </p>
                  {routeInfo.requiresMcp && routeInfo.mcpTools && (
                    <p className="text-[10px] font-mono text-zinc-500 mt-1">
                      MCP Tools: {routeInfo.mcpTools.slice(0, 3).join(", ")}{routeInfo.mcpTools.length > 3 ? "..." : ""}
                    </p>
                  )}
                </div>
              )}
              {!routeInfo && testType && purpose && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3">
                  <p className="text-xs font-mono text-yellow-400">
                    No specific prompt for this combination. Will use direct analysis.
                  </p>
                </div>
              )}

              {/* Challenge Name (for CTF) */}
              {purpose === "ctf" && (
                <div>
                  <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 block">// Challenge Name</label>
                  <Input
                    placeholder="e.g., Super Secure Login"
                    value={challengeName}
                    onChange={(e) => setChallengeName(e.target.value)}
                    className="bg-black/60 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 font-mono text-sm"
                  />
                </div>
              )}

              {/* FIXED: UI-01 — Flag Format (for CTF) */}
              {purpose === "ctf" && (
                <div>
                  <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 block">// Flag Format (optional)</label>
                  <Input
                    placeholder="e.g. HTB{}, picoCTF{}, COMPNAME{} — leave empty for auto-detect"
                    value={flagFormat}
                    onChange={(e) => setFlagFormat(e.target.value)}
                    className="bg-black/60 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 font-mono text-sm"
                  />
                </div>
              )}

              {/* FIXED: UI-04 — Pentest-specific fields (for non-CTF) */}
              {purpose !== "ctf" && purpose && (
                <>
                  <div>
                    <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 block">// Login Instructions (optional)</label>
                    <Textarea
                      placeholder="e.g. Use admin/password123 at /login — leave empty if no auth required"
                      value={loginInstructions}
                      onChange={(e) => setLoginInstructions(e.target.value)}
                      className="bg-black/60 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 font-mono text-sm"
                      rows={2}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 block">// Rules / Focus (optional)</label>
                    <Input
                      placeholder="Areas to focus on, e.g. SQL injection, authentication bypass"
                      value={rulesFocus}
                      onChange={(e) => setRulesFocus(e.target.value)}
                      className="bg-black/60 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 block">// Rules / Avoid (optional)</label>
                    <Input
                      placeholder="Areas to avoid, e.g. DoS attacks, database modifications"
                      value={rulesAvoid}
                      onChange={(e) => setRulesAvoid(e.target.value)}
                      className="bg-black/60 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 font-mono text-sm"
                    />
                  </div>
                </>
              )}

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

                {/* MCP Tool Test Button */}
                <div className="mt-2">
                  <Button
                    onClick={handleTestTools}
                    disabled={isTestingTools || !selMcp || mcpList.length === 0}
                    size="sm"
                    variant="outline"
                    className="w-full bg-zinc-900/50 border-zinc-600 text-zinc-300 hover:bg-zinc-800/70 hover:text-zinc-200 font-mono text-xs"
                  >
                    {isTestingTools ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin mr-2" />
                        Testing tools...
                      </>
                    ) : (
                      <>
                        <Zap className="w-3 h-3 mr-2" />
                        Test MCP Tools
                      </>
                    )}
                  </Button>
                </div>

                {/* Tool Test Results */}
                {showToolTestResults && toolTestResults && (
                  <div className="mt-3 p-3 bg-zinc-900/60 border border-zinc-700 rounded-md">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {toolTestResults.serverStatus === 'connected' ? (
                          <div className="w-2 h-2 rounded-full bg-green-500"></div>
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-red-500"></div>
                        )}
                        <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                          {toolTestResults.serverStatus === 'connected' ? 'MCP Connected' : 'MCP Disconnected'}
                        </span>
                      </div>
                      <Button
                        onClick={() => setShowToolTestResults(false)}
                        size="sm"
                        variant="ghost"
                        className="h-auto p-1 text-zinc-500 hover:text-zinc-300"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div className="text-center">
                        <div className="text-lg font-mono font-bold text-green-400">
                          {toolTestResults.availableCount || 0}
                        </div>
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Available</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-mono font-bold text-red-400">
                          {toolTestResults.missingCount || 0}
                        </div>
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Missing</div>
                      </div>
                    </div>

                    {toolTestResults.error && (
                      <div className="text-xs text-red-400 font-mono mb-2">
                        Error: {toolTestResults.error}
                      </div>
                    )}

                    <div className="max-h-32 overflow-y-auto">
                      <div className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1">Available Tools:</div>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {toolTestResults.availableTools?.slice(0, 10).map((tool) => (
                          <span key={tool} className="px-2 py-1 bg-green-500/20 text-green-400 text-xs font-mono rounded">
                            {tool}
                          </span>
                        ))}
                        {(toolTestResults.availableTools?.length || 0) > 10 && (
                          <span className="px-2 py-1 bg-zinc-700 text-zinc-400 text-xs font-mono rounded">
                            +{(toolTestResults.availableTools?.length || 0) - 10} more
                          </span>
                        )}
                      </div>

                      {(toolTestResults.missingTools?.length || 0) > 0 && (
                        <>
                          <div className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1">Missing Tools:</div>
                          <div className="flex flex-wrap gap-1">
                            {toolTestResults.missingTools?.slice(0, 8).map((tool) => (
                              <span key={tool} className="px-2 py-1 bg-red-500/20 text-red-400 text-xs font-mono rounded">
                                {tool}
                              </span>
                            ))}
                            {(toolTestResults.missingTools?.length || 0) > 8 && (
                              <span className="px-2 py-1 bg-zinc-700 text-zinc-400 text-xs font-mono rounded">
                                +{(toolTestResults.missingTools?.length || 0) - 8} more
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
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
                <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 block">{targetInfo.label}</label>
                <Input
                  placeholder={targetInfo.placeholder}
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
                <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 block">// Artifacts (multiple supported)</label>
                <div
                  className="border border-dashed border-zinc-700 rounded-md p-4 text-center hover:border-red-500/30 transition-colors cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); handleFileSelect(e.dataTransfer.files); }}
                >
                  <Upload className="w-5 h-5 text-zinc-500 mx-auto mb-2" />
                  <p className="text-xs text-zinc-500 font-mono">
                    {isUploading ? "Uploading..." : "Drop files or click to upload"}
                  </p>
                  <p className="text-[10px] text-zinc-600 font-mono mt-1">
                    EXE, APK, PCAP, binaries, evidence — multiple files OK
                  </p>
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFileSelect(e.target.files)} />
                </div>
                {uploadedFiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="text-[10px] text-zinc-500 font-mono mb-1">{uploadedFiles.length} file(s) uploaded:</div>
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
                    {type.charAt(0).toUpperCase() + type.slice(1)} Report (styled)
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
                    {runs.map((r) => {
                      const isCTF = r.purpose === "ctf";
                      const flags = r.findings?.filter((f: any) => f.title.includes("🚩 Flag Captured:")) || [];
                      const vulnerabilities = r.findings?.filter((f: any) => !f.title.includes("🚩 Flag Captured:")) || [];
                      const hasFlags = flags.length > 0;

                      return (
                        <div
                          key={r.id}
                          className="px-5 py-3 flex items-center justify-between text-sm hover:bg-zinc-900/50 transition-colors cursor-pointer group"
                          onClick={() => setSelectedRunId(r.id)}
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              {/* Status icon with CTF special handling */}
                              {r.status === "completed" ? (
                                isCTF ? <Trophy className="w-4 h-4 text-yellow-500" /> : <ShieldCheck className="w-4 h-4 text-emerald-500" />
                              ) : r.status === "failed" ? (
                                <AlertTriangle className="w-4 h-4 text-red-500" />
                              ) : (
                                <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                              )}

                              {/* CTF flag indicator */}
                              {isCTF && hasFlags && (
                                <div className="flex items-center gap-1 text-yellow-500">
                                  <Flag className="w-3 h-3" />
                                  <span className="text-xs font-mono">{flags.length}</span>
                                </div>
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-mono text-zinc-100 truncate">{r.target}</p>
                                {isCTF && (
                                  <div className="bg-yellow-500/20 px-1.5 py-0.5 rounded text-[10px] font-mono text-yellow-400 uppercase">
                                    CTF
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <p className="text-[11px] font-mono text-zinc-400">
                                  {r.test_type} · {r.purpose} · {new Date(r.created_at).toLocaleString()}
                                </p>
                                {r.status === "completed" && (
                                  <span className="text-[10px] text-zinc-500 font-mono">
                                    {isCTF && hasFlags
                                      ? `🚩 ${flags.length} flag${flags.length !== 1 ? 's' : ''}`
                                      : vulnerabilities.length > 0
                                      ? `${vulnerabilities.length} finding${vulnerabilities.length !== 1 ? 's' : ''}`
                                      : "No findings"}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <StatusBadge
                              variant={r.status === "completed" ? "online" : r.status === "failed" ? "offline" : "warning"}
                              label={r.status}
                            />
                            <button
                              onClick={(e) => handleDeleteRun(r.id, e)}
                              disabled={deletingRunId === r.id}
                              className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-all p-1"
                              title="Delete run"
                            >
                              {deletingRunId === r.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Run Detail Modal */}
      <RunDetailModal
        runId={selectedRunId}
        open={!!selectedRunId}
        onClose={() => setSelectedRunId(null)}
        onDeleted={refreshRuns}
      />
    </AppLayout>
  );
};

export default Orchestrator;
