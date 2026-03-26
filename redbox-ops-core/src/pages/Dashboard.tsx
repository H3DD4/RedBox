import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Crosshair, Activity, ShieldAlert, Cpu, FileSearch, ArrowUpRight,
  AlertTriangle, ShieldCheck, Info, Trophy, Flag,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import MetricCard from "@/components/MetricCard";
import StatusBadge from "@/components/StatusBadge";
import RunDetailModal from "@/components/RunDetailModal";
import { useMcp } from "@/context/McpContext";
import { dashboard, type DashboardStats } from "@/services/api-client";

type ServiceStatus = "online" | "offline" | "warning";

const Dashboard = () => {
  const navigate = useNavigate();
  const { isOnline, llmOnline, ragIndexed } = useMcp();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const refreshData = () => {
    dashboard.stats().then(setStats).catch(() => setStats(null));
  };

  useEffect(() => {
    dashboard
      .stats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));

    const interval = setInterval(() => {
      dashboard.stats().then(setStats).catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const services: { name: string; status: ServiceStatus }[] = [
    { name: "HexStrike MCP", status: isOnline ? "online" : "offline" },
    { name: "RAG Engine",    status: ragIndexed ? "online" : "offline" },
    { name: "LLM Provider",  status: llmOnline  ? "online" : "offline" },
  ];

  const totalFindings = stats?.totalFindings ?? 0;
  const activeRuns = stats?.activeRuns ?? 0;
  const modelLabel = stats?.activeLlmProvider
    ? `${stats.activeLlmProvider.name}`
    : "—";

  const severityColor = (s: string) => {
    if (s === "critical") return "text-red-500";
    if (s === "high")     return "text-orange-500";
    if (s === "medium")   return "text-yellow-500";
    return "text-zinc-400";
  };

  const severityIcon = (status: string, purpose?: string) => {
    if (status === "completed") {
      // Show trophy for CTF challenges
      if (purpose === "ctf") return <Trophy className="w-4 h-4 text-yellow-500" />;
      return <ShieldCheck className="w-4 h-4 text-emerald-500" />;
    }
    if (status === "failed")    return <AlertTriangle className="w-4 h-4 text-red-500" />;
    if (status === "running")   return <Activity className="w-4 h-4 text-red-400 animate-pulse" />;
    return <Info className="w-4 h-4 text-zinc-500" />;
  };

  const getRunSummary = (run: any) => {
    const isCTF = run.purpose === "ctf";
    const flags = run.findings?.filter((f: any) => f.title.includes("🚩 Flag Captured:")) || [];
    const vulnerabilities = run.findings?.filter((f: any) => !f.title.includes("🚩 Flag Captured:")) || [];

    if (isCTF && flags.length > 0) {
      return `🚩 ${flags.length} flag${flags.length !== 1 ? 's' : ''} captured`;
    }
    if (vulnerabilities.length > 0) {
      return `${vulnerabilities.length} finding${vulnerabilities.length !== 1 ? 's' : ''}`;
    }
    return "No findings";
  };

  return (
    <AppLayout>
      <div className="space-y-8 animate-slide-up font-mono">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 font-mono uppercase tracking-[0.15em]">// Dashboard</h1>
          <p className="text-zinc-400 font-mono text-xs mt-1">Operations overview and system status</p>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            icon={Crosshair}
            label="Active Tasks"
            value={loading ? "…" : String(activeRuns)}
            variant="primary"
          />
          <MetricCard
            icon={ShieldAlert}
            label="Total Findings"
            value={loading ? "…" : String(totalFindings)}
            variant="primary"
          />
          <MetricCard
            icon={Cpu}
            label="LLM Provider"
            value={loading ? "…" : modelLabel}
            change={stats?.activeLlmProvider?.model}
            variant="default"
          />
          <MetricCard
            icon={Activity}
            label="MCP Status"
            value={isOnline ? "Online" : "Offline"}
            variant="accent"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Activities */}
          <div className="lg:col-span-2 bg-zinc-900/80 border border-zinc-700/50 rounded-lg">
            <div className="p-5 border-b border-zinc-700/50 flex items-center justify-between">
              <h3 className="text-zinc-200 font-mono text-xs uppercase tracking-[0.15em]">// Recent Activities</h3>
              <button
                onClick={() => navigate("/orchestrator")}
                className="text-xs text-red-400 hover:text-red-300 font-mono flex items-center gap-1"
              >
                New Task <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>
            {!stats?.recentRuns?.length ? (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-500 gap-3">
                <FileSearch className="w-8 h-8 opacity-30" />
                <p className="text-xs font-mono">No activities yet — run your first task in the Orchestrator.</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/60">
                {stats.recentRuns.map((run) => {
                  const isCTF = run.purpose === "ctf";
                  const flags = run.findings?.filter((f: any) => f.title.includes("🚩 Flag Captured:")) || [];
                  const hasFlags = flags.length > 0;

                  return (
                    <div
                      key={run.id}
                      className="px-5 py-3.5 flex items-center gap-3 hover:bg-zinc-900/50 transition-colors cursor-pointer group"
                      onClick={() => setSelectedRunId(run.id)}
                    >
                      <div className="flex items-center gap-2">
                        {severityIcon(run.status, run.purpose)}
                        {isCTF && hasFlags && (
                          <div className="flex items-center gap-1 text-yellow-500">
                            <Flag className="w-3 h-3" />
                            <span className="text-xs font-mono">{flags.length}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-zinc-100 font-mono truncate">{run.target}</p>
                          {isCTF && (
                            <div className="bg-yellow-500/20 px-1.5 py-0.5 rounded text-[10px] font-mono text-yellow-400 uppercase">
                              CTF
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] text-zinc-400 font-mono">
                            {run.test_type} · {run.pipeline} · {new Date(run.created_at).toLocaleString()}
                          </p>
                          {run.status === "completed" && (
                            <span className="text-[10px] text-zinc-500 font-mono">
                              {getRunSummary(run)}
                            </span>
                          )}
                        </div>
                      </div>
                      <StatusBadge
                        variant={
                          run.status === "completed" ? "online"
                          : run.status === "failed"    ? "offline"
                          : run.status === "running"   ? "warning"
                          : "offline"
                        }
                        label={run.status}
                        pulse={run.status === "running"}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-4">
            {/* Findings breakdown */}
            {stats && totalFindings > 0 && (
              <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-5">
                <h3 className="text-zinc-300 font-mono text-xs uppercase tracking-[0.15em] mb-4">// Findings Breakdown</h3>
                <div className="space-y-2">
                  {(["critical","high","medium","low","info"] as const).map((sev) => {
                    const count = stats.findingsBySeverity[sev] ?? 0;
                    if (!count) return null;
                    return (
                      <div key={sev} className="flex items-center justify-between">
                        <span className={`text-xs font-mono uppercase ${severityColor(sev)}`}>{sev}</span>
                        <span className="text-xs font-mono text-zinc-100">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* RAG Stats */}
            {stats?.ragStats && (
              <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-5">
                <h3 className="text-zinc-300 font-mono text-xs uppercase tracking-[0.15em] mb-4">// RAG Corpus</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400 font-mono">Documents</span>
                    <span className="text-xs font-mono text-zinc-100">{stats.ragStats.documentCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400 font-mono">Chunks</span>
                    <span className="text-xs font-mono text-zinc-100">{stats.ragStats.chunkCount}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-5">
              <h3 className="text-zinc-300 font-mono text-xs uppercase tracking-[0.15em] mb-4">// System Status</h3>
              <div className="space-y-3">
                {services.map((s) => (
                  <div key={s.name} className="flex items-center justify-between">
                    <span className="text-sm text-zinc-400 font-mono">{s.name}</span>
                    <StatusBadge variant={s.status} label={s.status} pulse={s.status === "online"} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Run Detail Modal */}
      <RunDetailModal
        runId={selectedRunId}
        open={!!selectedRunId}
        onClose={() => setSelectedRunId(null)}
        onDeleted={refreshData}
      />
    </AppLayout>
  );
};

export default Dashboard;
