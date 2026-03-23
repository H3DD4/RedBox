import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send, Terminal as TerminalIcon, Activity, MessageSquare,
  WifiOff, Wifi, ChevronDown, PanelBottomClose, PanelBottomOpen, Bot,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { TerminalOutput, type TerminalLine } from "@/components/TerminalOutput";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { shell, hexstrike, llmProviders, chat, type LlmProvider } from "@/services/api-client";
import { useToast } from "@/hooks/use-toast";
import { useMcp } from "@/context/McpContext";

interface ChatMessage { role: "user" | "assistant"; content: string; timestamp: string; }

const detectOS = (): "windows" | "mac" | "linux" => {
  const ua = navigator.userAgent;
  if (/Win/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "mac";
  return "linux";
};

const SHELL_CFG = {
  windows: { label: "PowerShell", prompt: "PS>", shellArg: "powershell", placeholder: "Enter PowerShell command..." },
  mac:     { label: "zsh",        prompt: "%",   shellArg: "zsh",        placeholder: "Enter zsh command..."        },
  linux:   { label: "bash",       prompt: "$",   shellArg: "bash",       placeholder: "Enter bash command..."       },
} as const;

const now = () => new Date().toLocaleTimeString("en-US", { hour12: false });

const Terminal = () => {
  const { toast } = useToast();
  const os = detectOS();
  const shellCfg = SHELL_CFG[os];
  const { isOnline: isServerOnline, isChecking: isCheckingServer, logs: mcpLogs } = useMcp();

  // LLM providers from API
  const [providers,       setProviders]       = useState<LlmProvider[]>([]);
  const [selectedProvider,setSelectedProvider]= useState<string>("");
  const [showModelPicker, setShowModelPicker] = useState(false);

  useEffect(() => {
    llmProviders.list().then(({ providers: ps }) => {
      setProviders(ps);
      const active = ps.find((p) => p.active) || ps[0];
      if (active) setSelectedProvider(active.id);
    }).catch(() => {});
  }, []);

  // Chat state
  const [messages,  setMessages]  = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isSending) return;
    const content = chatInput.trim();
    setMessages((m) => [...m, { role: "user", content, timestamp: now() }]);
    setChatInput("");
    setIsSending(true);
    try {
      // Use the LLM chat endpoint instead of HexStrike
      const res = await chat.send(content, "You are RedBox AI, a helpful security assistant. Be concise and helpful.");
      setMessages((m) => [...m, { role: "assistant", content: res.response, timestamp: now() }]);
    } catch (err) {
      const msg = (err as { error?: string }).error || "Connection failed";
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${msg}`, timestamp: now() }]);
    } finally {
      setIsSending(false);
    }
  };

  // Shell state
  const [termLines,      setTermLines]      = useState<TerminalLine[]>([]);
  const [termInput,      setTermInput]      = useState("");
  const [isExecRunning,  setIsExecRunning]  = useState(false);
  const [history,        setHistory]        = useState<string[]>([]);
  const [historyIdx,     setHistoryIdx]     = useState(-1);
  const [showTerminal,   setShowTerminal]   = useState(true);

  const handleTermSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!termInput.trim() || isExecRunning) return;
    const cmd = termInput.trim();
    setHistory((h) => [cmd, ...h.slice(0, 99)]);
    setHistoryIdx(-1);
    setTermInput("");

    const push = (line: TerminalLine) => setTermLines((l) => [...l, line]);
    push({ type: "input", content: cmd, timestamp: now() });

    if (cmd === "clear")  { setTermLines([]); return; }
    if (cmd === "help") {
      push({ type: "info", content: `${shellCfg.label} shell — commands run via backend with safety controls.`, timestamp: now() });
      return;
    }

    setIsExecRunning(true);
    try {
      const result = await shell.exec(cmd, shellCfg.shellArg);
      if (result.stdout) push({ type: "output", content: result.stdout.trimEnd(), timestamp: now() });
      if (result.stderr) push({ type: "error",  content: result.stderr.trimEnd(), timestamp: now() });
      if (!result.stdout && !result.stderr)
        push({ type: "output", content: `[exit ${result.exitCode}]`, timestamp: now() });
    } catch (err) {
      const apiErr = err as { error?: string; code?: string };
      if (apiErr.code === "BLOCKED_COMMAND") {
        push({ type: "error", content: "Blocked: command not permitted by safety policy.", timestamp: now() });
      } else if (apiErr.code === "AUTH_REQUIRED") {
        push({ type: "error", content: "Authentication required — please sign in.", timestamp: now() });
      } else {
        push({ type: "error", content: `Error: ${apiErr.error || "Unknown error"}`, timestamp: now() });
      }
    } finally {
      setIsExecRunning(false);
    }
  };

  const handleTermKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") {
      const i = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(i); setTermInput(history[i] || "");
    } else if (e.key === "ArrowDown") {
      const i = historyIdx - 1;
      if (i < 0) { setHistoryIdx(-1); setTermInput(""); }
      else        { setHistoryIdx(i); setTermInput(history[i]); }
    }
  };

  const logColor: Record<"info"|"warn"|"error"|"debug",string> = {
    info: "text-blue-400", warn: "text-yellow-400", error: "text-red-400", debug: "text-zinc-500",
  };

  const currentProvider = providers.find((p) => p.id === selectedProvider);
  const currentLabel = currentProvider ? `${currentProvider.name} / ${currentProvider.model}` : "No provider";

  return (
    <AppLayout>
      <div className="space-y-4 animate-slide-up h-[calc(100vh-8rem)] flex flex-col font-mono">
        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-2xl text-zinc-100 font-mono font-bold uppercase tracking-[0.15em]">// AI Terminal</h1>
            <p className="text-zinc-400 font-mono text-xs mt-1">
              Chat · MCP Monitoring · {shellCfg.label} Shell
              <span className="ml-2 text-[10px] text-zinc-500 font-mono uppercase">[{os}]</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isCheckingServer ? (
              <span className="flex items-center gap-2 text-sm text-zinc-500 font-mono">
                <Activity className="w-4 h-4 animate-spin" /> Checking...
              </span>
            ) : isServerOnline ? (
              <span className="flex items-center gap-2 text-sm text-red-400 font-mono animate-pulse-glow">
                <Wifi className="w-4 h-4" /> HexStrike Connected
              </span>
            ) : (
              <span className="flex items-center gap-2 text-sm text-zinc-500 font-mono">
                <WifiOff className="w-4 h-4" /> Server Offline
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0">
          <ResizablePanelGroup direction="horizontal" className="rounded-lg border border-zinc-700/50">

            {/* Left: AI Chat */}
            <ResizablePanel defaultSize={50} minSize={30}>
              <div className="flex flex-col h-full bg-zinc-900/80">
                <div className="px-4 py-3 border-b border-zinc-700/50 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-red-500" />
                  <span className="text-zinc-200 font-mono text-xs uppercase tracking-[0.15em]">// AI Chat</span>
                  <div className="ml-auto relative">
                    <button
                      onClick={() => setShowModelPicker((v) => !v)}
                      className="flex items-center gap-1.5 text-xs bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100 font-mono rounded-md px-2.5 py-1.5 border transition-colors"
                    >
                      <Bot className="w-3.5 h-3.5" />
                      <span className="max-w-[120px] truncate">{currentLabel}</span>
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </button>
                    {showModelPicker && (
                      <div className="absolute right-0 top-full mt-1 w-64 bg-zinc-900/95 border border-zinc-700 rounded-md shadow-lg z-50 overflow-hidden">
                        {providers.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => { setSelectedProvider(p.id); setShowModelPicker(false); }}
                            className={`w-full text-left px-3 py-2.5 text-xs flex items-center gap-2 transition-colors font-mono ${
                              selectedProvider === p.id ? "bg-red-500/10 text-red-400" : "hover:bg-zinc-800 text-zinc-200"
                            }`}
                          >
                            {selectedProvider === p.id && <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block shrink-0" />}
                            <div>
                              <div className="font-medium">{p.name}</div>
                              <div className="text-zinc-500 font-mono text-[10px]">{p.model}</div>
                            </div>
                            {p.active ? <span className="ml-auto text-[9px] text-red-400 font-mono">ACTIVE</span> : null}
                          </button>
                        ))}
                        {providers.length === 0 && (
                          <div className="px-3 py-3 text-xs text-zinc-500 font-mono">
                            No providers — add one in Settings
                          </div>
                        )}
                        <div className="border-t border-zinc-700 px-3 py-2 text-[10px] text-zinc-500 font-mono">
                          Configure in Settings → LLM Providers
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-auto p-4 space-y-3" onClick={() => setShowModelPicker(false)}>
                  {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-500 font-mono text-sm gap-2">
                      <MessageSquare className="w-8 h-8 opacity-30" />
                      <span>Ask RedBox AI anything...</span>
                      <span className="text-xs opacity-60">{currentLabel}</span>
                    </div>
                  )}
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[82%] rounded-lg px-3 py-2 text-sm font-mono ${
                        msg.role === "user"
                          ? "bg-red-500/10 border border-red-500/20 text-zinc-100"
                          : "bg-zinc-800/80 border border-zinc-700 text-zinc-200"
                      }`}>
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        <span className="text-[10px] text-zinc-500 mt-1 block">{msg.timestamp}</span>
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>

                <form onSubmit={handleChatSubmit} className="border-t border-zinc-700/50 p-3 flex items-center gap-2">
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={`Ask ${currentProvider?.name || "AI"}...`}
                    disabled={isSending}
                    className="flex-1 bg-transparent text-zinc-100 text-sm outline-none placeholder:text-zinc-500 font-mono disabled:opacity-40"
                  />
                  <button type="submit" disabled={isSending} className="text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-40">
                    {isSending ? <Activity className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </form>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Right: MCP Logs + Shell */}
            <ResizablePanel defaultSize={50} minSize={25}>
              {showTerminal ? (
                <ResizablePanelGroup direction="vertical">
                  <ResizablePanel defaultSize={45} minSize={20}>
                    <div className="flex flex-col h-full bg-zinc-900/80">
                      <div className="px-4 py-3 border-b border-zinc-700/50 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-zinc-200 animate-pulse-glow" />
                        <span className="text-zinc-200 font-mono text-xs uppercase tracking-[0.15em]">MCP Logs</span>
                        <span className="text-[10px] font-mono text-red-400 ml-auto">LIVE</span>
                        <button onClick={() => setShowTerminal(false)} className="text-zinc-500 hover:text-zinc-200 transition-colors">
                          <PanelBottomClose className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex-1 overflow-auto p-3 font-mono text-xs space-y-0.5">
                        {mcpLogs.length === 0 && <p className="text-zinc-500/50 italic">No logs yet...</p>}
                        {mcpLogs.map((log, i) => (
                          <div key={i} className="flex gap-2">
                            <span className="text-zinc-500 shrink-0">{log.timestamp}</span>
                            <span className={`shrink-0 uppercase w-12 ${logColor[log.level]}`}>[{log.level}]</span>
                            <span className="text-zinc-300/80 break-all">{log.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </ResizablePanel>

                  <ResizableHandle withHandle />

                  <ResizablePanel defaultSize={55} minSize={20}>
                    <div className="flex flex-col h-full bg-zinc-900/80">
                      <div className="px-4 py-3 border-b border-zinc-700/50 flex items-center gap-2">
                        <TerminalIcon className="w-4 h-4 text-red-400" />
                        <span className="text-zinc-200 font-mono text-xs uppercase tracking-[0.15em]">{shellCfg.label}</span>
                        <span className="text-xs font-mono text-zinc-500 ml-1 opacity-60">
                          {os === "windows" ? "redbox@WIN" : "redbox@host"}
                        </span>
                      </div>
                      <div className="flex-1 overflow-auto p-3">
                        <TerminalOutput lines={termLines} className="border-none bg-transparent p-0 min-h-full" />
                      </div>
                      <form onSubmit={handleTermSubmit} className="border-t border-zinc-700/50 p-3 flex items-center gap-2">
                        <span className="text-red-400 font-mono text-sm shrink-0">{shellCfg.prompt}</span>
                        <input
                          value={termInput}
                          onChange={(e) => setTermInput(e.target.value)}
                          onKeyDown={handleTermKeyDown}
                          placeholder={isExecRunning ? "running..." : shellCfg.placeholder}
                          disabled={isExecRunning}
                          className="flex-1 bg-transparent text-zinc-100 font-mono text-sm outline-none placeholder:text-zinc-500 disabled:opacity-50"
                        />
                        <button type="submit" disabled={isExecRunning} className="text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-40">
                          <Send className="w-4 h-4" />
                        </button>
                      </form>
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
              ) : (
                <div className="flex flex-col h-full bg-zinc-900/80">
                  <div className="px-4 py-3 border-b border-zinc-700/50 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-zinc-300 animate-pulse-glow" />
                    <span className="text-zinc-300 font-mono text-xs uppercase tracking-[0.15em]">MCP Logs</span>
                    <span className="text-[10px] font-mono text-red-400 ml-auto">LIVE</span>
                    <button onClick={() => setShowTerminal(true)} className="text-zinc-500 hover:text-zinc-200 transition-colors">
                      <PanelBottomOpen className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto p-3 font-mono text-xs space-y-0.5">
                    {mcpLogs.length === 0 && <p className="text-zinc-600/50 italic">No logs yet...</p>}
                    {mcpLogs.map((log, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-zinc-600 shrink-0">{log.timestamp}</span>
                        <span className={`shrink-0 uppercase w-12 ${logColor[log.level]}`}>[{log.level}]</span>
                        <span className="text-zinc-300/80 break-all">{log.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </ResizablePanel>

          </ResizablePanelGroup>
        </div>
      </div>
    </AppLayout>
  );
};

export default Terminal;
