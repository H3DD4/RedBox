import { useState, useEffect } from "react";
import {
  Settings, Cpu, Bot, Save, Server, Plus, Trash2,
  CheckCircle2, XCircle, Loader2, Eye, EyeOff, Star, Palette,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/context/ThemeContext";
import {
  mcpServers, llmProviders,
  type McpServer, type LlmProvider,
} from "@/services/api-client";

const load = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) ?? "") as T; } catch { return fallback; }
};
const save = (key: string, val: unknown) => localStorage.setItem(key, JSON.stringify(val));

const tabs = [
  { id: "appearance", label: "Appearance",         icon: Palette },
  { id: "mcp",        label: "MCP Servers",       icon: Server },
  { id: "providers",  label: "LLM Providers",     icon: Bot },
  { id: "models",     label: "Model Parameters",  icon: Cpu },
];

type TestState = Record<string, "idle" | "testing" | "ok" | "fail">;

const PROVIDER_TYPES = [
  { value: "ollama",     label: "Ollama (local)" },
  { value: "openai",     label: "OpenAI" },
  { value: "anthropic",  label: "Anthropic Claude" },
  { value: "gemini",     label: "Google Gemini" },
  { value: "custom",     label: "Custom (OpenAI-compatible)" },
];

const DEFAULT_ENDPOINTS: Record<string, string> = {
  ollama:    "http://localhost:11434",
  openai:    "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini:    "https://generativelanguage.googleapis.com/v1beta",
  custom:    "",
};

const DEFAULT_MODELS: Record<string, string> = {
  ollama:    "llama3",
  openai:    "gpt-4o",
  anthropic: "claude-3-5-sonnet-20241022",
  gemini:    "gemini-1.5-flash",
  custom:    "model-name",
};

const SettingsPage = () => {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState("appearance");

  // ── MCP Servers ──
  const [mcpList,  setMcpList]  = useState<McpServer[]>([]);
  const [mcpTest,  setMcpTest]  = useState<TestState>({});
  const [newMcp,   setNewMcp]   = useState({ name: "", url: "", authToken: "" });
  const [showMcpForm, setShowMcpForm] = useState(false);

  // ── LLM Providers ──
  const [provList,   setProvList]   = useState<LlmProvider[]>([]);
  const [provTest,   setProvTest]   = useState<TestState>({});
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [newProv,    setNewProv]    = useState({
    type: "ollama" as LlmProvider["type"],
    name: "Ollama (local)",
    endpoint: "http://localhost:11434",
    apiKey: "",
    model: "llama3",
  });
  const [showProvForm, setShowProvForm] = useState(false);

  // ── Model parameters (local only) ──
  const [params, setParams] = useState(() =>
    load("settings.modelParams", { temperature: "0.7", maxTokens: "4096", topP: "0.9", frequencyPenalty: "0.0" })
  );

  const loadMcp  = () => mcpServers.list().then(({ servers }) => setMcpList(servers)).catch(() => {});
  const loadProv = () => llmProviders.list().then(({ providers }) => setProvList(providers)).catch(() => {});

  useEffect(() => { loadMcp(); loadProv(); }, []);

  // MCP actions
  const testMcp = async (id: string) => {
    setMcpTest((t) => ({ ...t, [id]: "testing" }));
    try {
      const res = await mcpServers.test(id);
      setMcpTest((t) => ({ ...t, [id]: res.online ? "ok" : "fail" }));
      toast({ title: res.online ? "Connected" : "Unreachable", description: res.online ? `${res.latency_ms}ms` : res.error });
    } catch { setMcpTest((t) => ({ ...t, [id]: "fail" })); }
  };

  const deleteMcp = async (id: string) => {
    try { await mcpServers.delete(id); loadMcp(); toast({ title: "MCP server removed" }); }
    catch (err) { toast({ title: "Error", description: (err as {error?:string}).error, variant: "destructive" }); }
  };

  const setDefaultMcp = async (id: string) => {
    try { await mcpServers.setDefault(id); loadMcp(); }
    catch (err) { toast({ title: "Error", description: (err as {error?:string}).error, variant: "destructive" }); }
  };

  const createMcp = async () => {
    if (!newMcp.name || !newMcp.url) { toast({ title: "Name and URL required", variant: "destructive" }); return; }
    try {
      await mcpServers.create({ name: newMcp.name, url: newMcp.url, authToken: newMcp.authToken || undefined });
      setNewMcp({ name: "", url: "", authToken: "" });
      setShowMcpForm(false);
      loadMcp();
      toast({ title: "MCP server added" });
    } catch (err) { toast({ title: "Error", description: (err as {error?:string}).error, variant: "destructive" }); }
  };

  // Provider actions
  const testProvider = async (id: string) => {
    setProvTest((t) => ({ ...t, [id]: "testing" }));
    try {
      const res = await llmProviders.test(id);
      setProvTest((t) => ({ ...t, [id]: res.ok ? "ok" : "fail" }));
      toast({ title: res.ok ? "Connected" : "Failed", description: res.ok ? `Model: ${res.model}` : res.error });
    } catch { setProvTest((t) => ({ ...t, [id]: "fail" })); }
  };

  const deleteProvider = async (id: string) => {
    try { await llmProviders.delete(id); loadProv(); toast({ title: "Provider removed" }); }
    catch (err) { toast({ title: "Error", description: (err as {error?:string}).error, variant: "destructive" }); }
  };

  const setActiveProvider = async (id: string) => {
    try { await llmProviders.setActive(id); loadProv(); toast({ title: "Active provider updated" }); }
    catch (err) { toast({ title: "Error", description: (err as {error?:string}).error, variant: "destructive" }); }
  };

  const createProvider = async () => {
    if (!newProv.name || !newProv.endpoint || !newProv.model) {
      toast({ title: "Name, endpoint, and model required", variant: "destructive" }); return;
    }
    try {
      await llmProviders.create({ ...newProv, apiKey: newProv.apiKey || undefined });
      setNewProv({ type: "ollama", name: "Ollama (local)", endpoint: "http://localhost:11434", apiKey: "", model: "llama3" });
      setShowProvForm(false);
      loadProv();
      toast({ title: "LLM provider added" });
    } catch (err) { toast({ title: "Error", description: (err as {error?:string}).error, variant: "destructive" }); }
  };

  const testIcon = (state: string | undefined) => {
    if (state === "testing") return <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />;
    if (state === "ok")      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    if (state === "fail")    return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    return null;
  };

  return (
    <AppLayout>
      <div className="space-y-6 animate-slide-up font-mono">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl text-zinc-100 font-mono font-bold uppercase tracking-[0.15em] flex items-center gap-2">
              <Settings className="w-6 h-6 text-red-500" /> // Settings
            </h1>
            <p className="text-zinc-400 font-mono text-xs mt-1">Platform configuration and API connections</p>
          </div>
          {activeTab === "models" && (
            <button
              onClick={() => { save("settings.modelParams", params); toast({ title: "Model parameters saved" }); }}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-red-600 text-white text-sm hover:bg-red-500 font-mono transition-colors"
            >
              <Save className="w-4 h-4" /> Save
            </button>
          )}
        </div>

        <div className="flex gap-6">
          {/* Tab Nav */}
          <div className="w-56 shrink-0 space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-mono transition-all ${
                  activeTab === tab.id
                    ? "bg-red-500/10 text-red-400 border border-red-500/30"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-transparent"
                }`}
              >
                <tab.icon className="w-4 h-4" />{tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-6 space-y-6 min-h-[400px]">

            {/* ── Appearance ── */}
            {activeTab === "appearance" && (
              <div className="space-y-6">
                <h3 className="text-lg text-zinc-100 font-mono font-bold">Appearance</h3>
                <p className="text-zinc-400 font-mono text-xs">Customize the visual theme of the application</p>

                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-3 block">// Theme Mode</label>
                    <div className="grid grid-cols-2 gap-4">
                      {/* Dark Mode */}
                      <button
                        onClick={() => setTheme("dark")}
                        className={`relative group p-6 rounded-lg border-2 transition-all ${
                          theme === "dark"
                            ? "border-red-500 bg-red-500/10"
                            : "border-zinc-700 hover:border-zinc-600 bg-zinc-800/50"
                        }`}
                      >
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-mono font-medium text-zinc-100">Dark Mode</span>
                            {theme === "dark" && (
                              <span className="text-[9px] font-mono bg-red-500/20 text-red-400 px-2 py-1 rounded">ACTIVE</span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-400 font-mono text-left">
                            High contrast dark theme with better readability. Red accents on dark backgrounds.
                          </p>
                          {/* Preview */}
                          <div className="mt-4 p-3 bg-black rounded border border-zinc-700">
                            <div className="h-2 w-3/4 bg-zinc-600 rounded mb-2"></div>
                            <div className="h-2 w-1/2 bg-red-500 rounded"></div>
                          </div>
                        </div>
                      </button>

                      {/* Red Mode */}
                      <button
                        onClick={() => setTheme("red")}
                        className={`relative group p-6 rounded-lg border-2 transition-all ${
                          theme === "red"
                            ? "border-red-500 bg-red-500/10"
                            : "border-zinc-700 hover:border-zinc-600 bg-zinc-800/50"
                        }`}
                      >
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-mono font-medium text-zinc-100">Red Mode</span>
                            {theme === "red" && (
                              <span className="text-[9px] font-mono bg-red-500/20 text-red-400 px-2 py-1 rounded">ACTIVE</span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-400 font-mono text-left">
                            Inverted theme with red backgrounds and black text for a bold, distinctive look.
                          </p>
                          {/* Preview */}
                          <div className="mt-4 p-3 bg-red-900 rounded border border-red-700">
                            <div className="h-2 w-3/4 bg-red-700 rounded mb-2"></div>
                            <div className="h-2 w-1/2 bg-black rounded"></div>
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>

                  <div className="mt-6 p-4 bg-zinc-800/50 border border-zinc-700/50 rounded-lg">
                    <p className="text-xs text-zinc-400 font-mono">
                      <span className="text-red-400">💡 Tip:</span> Your theme preference is saved automatically and persists across sessions.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── MCP Servers ── */}
            {activeTab === "mcp" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg text-zinc-100 font-mono font-bold">MCP Servers</h3>
                  <button
                    onClick={() => setShowMcpForm(!showMcpForm)}
                    className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 font-mono"
                  >
                    <Plus className="w-4 h-4" /> Add Server
                  </button>
                </div>
                <p className="text-zinc-400 font-mono text-xs">
                  Manage MCP tool-execution servers. HexStrike is built-in and cannot be deleted.
                </p>

                {showMcpForm && (
                  <div className="border border-dashed border-red-500/20 rounded-lg p-4 space-y-3 bg-red-500/5">
                    <p className="text-sm font-medium text-zinc-100 font-mono">New MCP Server</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Input value={newMcp.name} onChange={(e) => setNewMcp({ ...newMcp, name: e.target.value })} placeholder="Server name" className="bg-black/60 border-zinc-700 text-zinc-100 font-mono" />
                      <Input value={newMcp.url}  onChange={(e) => setNewMcp({ ...newMcp, url: e.target.value })}  placeholder="http://host:port" className="bg-black/60 border-zinc-700 text-zinc-100 font-mono text-sm" />
                    </div>
                    <Input type="password" value={newMcp.authToken} onChange={(e) => setNewMcp({ ...newMcp, authToken: e.target.value })} placeholder="Auth token (optional)" className="bg-black/60 border-zinc-700 text-zinc-100 font-mono text-sm" />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setShowMcpForm(false)} className="text-sm text-zinc-400 hover:text-zinc-200 font-mono px-3 py-1.5">Cancel</button>
                      <button onClick={createMcp} className="text-sm bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-500 font-mono">Add</button>
                    </div>
                  </div>
                )}

                <div className="divide-y divide-zinc-700/50 border border-zinc-700/50 rounded-lg overflow-hidden">
                  {mcpList.length === 0 && (
                    <div className="px-5 py-8 text-center text-sm text-zinc-500 font-mono">No MCP servers configured.</div>
                  )}
                  {mcpList.map((s) => (
                    <div key={s.id} className="px-5 py-4 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-zinc-100">{s.name}</p>
                          {s.is_builtin ? <span className="text-[9px] font-mono bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded uppercase">BUILT-IN</span> : null}
                          {s.is_default ? <span className="text-[9px] font-mono bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded uppercase">DEFAULT</span> : null}
                        </div>
                        <p className="text-xs text-zinc-400 font-mono mt-0.5">{s.url}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {testIcon(mcpTest[s.id])}
                        <button onClick={() => testMcp(s.id)} className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-2 py-1 hover:border-red-500/30 font-mono transition-colors">
                          Test
                        </button>
                        {!s.is_default && (
                          <button onClick={() => setDefaultMcp(s.id)} title="Set as default" className="text-zinc-500 hover:text-red-400 transition-colors">
                            <Star className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {!s.is_builtin && (
                          <button onClick={() => deleteMcp(s.id)} className="text-zinc-500 hover:text-red-400 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── LLM Providers ── */}
            {activeTab === "providers" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg text-zinc-100 font-mono font-bold">LLM Providers</h3>
                  <button onClick={() => setShowProvForm(!showProvForm)} className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 font-mono">
                    <Plus className="w-4 h-4" /> Add Provider
                  </button>
                </div>
                <p className="text-zinc-400 font-mono text-xs">Configure AI providers for Orchestrator and Terminal chat.</p>

                {showProvForm && (
                  <div className="border border-dashed border-red-500/20 rounded-lg p-4 space-y-3 bg-red-500/5">
                    <p className="text-sm font-medium text-zinc-100 font-mono">New LLM Provider</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1 block">// Type</label>
                        <select
                          value={newProv.type}
                          onChange={(e) => {
                            const t = e.target.value as LlmProvider["type"];
                            setNewProv({ ...newProv, type: t, endpoint: DEFAULT_ENDPOINTS[t] || "", model: DEFAULT_MODELS[t] || "", name: PROVIDER_TYPES.find((p) => p.value === t)?.label || t });
                          }}
                          className="w-full bg-black/60 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 font-mono"
                        >
                          {PROVIDER_TYPES.map((pt) => <option key={pt.value} value={pt.value}>{pt.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1 block">// Display Name</label>
                        <Input value={newProv.name} onChange={(e) => setNewProv({ ...newProv, name: e.target.value })} placeholder="My Provider" className="bg-black/60 border-zinc-700 text-zinc-100 font-mono" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1 block">// Endpoint URL</label>
                        <Input value={newProv.endpoint} onChange={(e) => setNewProv({ ...newProv, endpoint: e.target.value })} placeholder="http://…" className="bg-black/60 border-zinc-700 text-zinc-100 font-mono text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1 block">// Model</label>
                        <Input value={newProv.model} onChange={(e) => setNewProv({ ...newProv, model: e.target.value })} placeholder="model-name" className="bg-black/60 border-zinc-700 text-zinc-100 font-mono text-sm" />
                      </div>
                    </div>
                    {newProv.type !== "ollama" && (
                      <div>
                        <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1 block">// API Key</label>
                        <Input type="password" value={newProv.apiKey} onChange={(e) => setNewProv({ ...newProv, apiKey: e.target.value })} placeholder="sk-…" className="bg-black/60 border-zinc-700 text-zinc-100 font-mono text-sm" />
                      </div>
                    )}
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setShowProvForm(false)} className="text-sm text-zinc-400 hover:text-zinc-200 font-mono px-3 py-1.5">Cancel</button>
                      <button onClick={createProvider} className="text-sm bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-500 font-mono">Add</button>
                    </div>
                  </div>
                )}

                <div className="divide-y divide-zinc-700/50 border border-zinc-700/50 rounded-lg overflow-hidden">
                  {provList.length === 0 && (
                    <div className="px-5 py-8 text-center text-sm text-zinc-500 font-mono">No LLM providers configured.</div>
                  )}
                  {provList.map((p) => (
                    <div key={p.id} className="px-5 py-4 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-zinc-100">{p.name}</p>
                          <span className="text-[9px] font-mono bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded uppercase">{p.type}</span>
                          {p.active ? <span className="text-[9px] font-mono bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded uppercase">ACTIVE</span> : null}
                        </div>
                        <p className="text-xs text-zinc-400 font-mono mt-0.5">{p.endpoint} · {p.model}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {testIcon(provTest[p.id])}
                        <button onClick={() => testProvider(p.id)} className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-2 py-1 hover:border-red-500/30 font-mono">Test</button>
                        {!p.active && (
                          <button onClick={() => setActiveProvider(p.id)} className="text-xs text-red-400 hover:text-red-300 font-mono">Set Active</button>
                        )}
                        <button onClick={() => deleteProvider(p.id)} className="text-zinc-500 hover:text-red-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Model Parameters ── */}
            {activeTab === "models" && (
              <div className="space-y-6">
                <h3 className="text-lg text-zinc-100 font-mono font-bold">Model Parameters</h3>
                <p className="text-zinc-400 font-mono text-xs">These defaults are used when no per-run override is set.</p>
                <div className="grid grid-cols-2 gap-4">
                  {([
                    { key: "temperature",      label: "Temperature",       desc: "Controls randomness (0–1)" },
                    { key: "maxTokens",        label: "Max Tokens",        desc: "Maximum response length" },
                    { key: "topP",             label: "Top P",             desc: "Nucleus sampling threshold" },
                    { key: "frequencyPenalty", label: "Frequency Penalty", desc: "Penalize repeated tokens (0–2)" },
                  ] as const).map(({ key, label, desc }) => (
                    <div key={key}>
                      <label className="text-[10px] font-mono text-red-400/70 uppercase tracking-[0.2em] mb-1.5 block">// {label}</label>
                      <Input
                        value={params[key]}
                        onChange={(e) => setParams({ ...params, [key]: e.target.value })}
                        className="bg-black/60 border-zinc-700 text-zinc-100 font-mono text-sm"
                      />
                      <p className="text-zinc-500 font-mono text-[10px] mt-1">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default SettingsPage;
