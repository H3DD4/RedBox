import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Crosshair,
  TerminalSquare,
  Brain,
  Settings,
  LogOut,
  Activity,
  WifiOff,
  Cpu,
} from "lucide-react";
import { useMcp } from "@/context/McpContext";
import { useAuth } from "@/context/AuthContext";

const navItems = [
  { to: "/dashboard",    icon: LayoutDashboard, label: "Dashboard"           },
  { to: "/orchestrator", icon: Crosshair,        label: "Pentest Orchestrator"},
  { to: "/terminal",     icon: TerminalSquare,   label: "AI Terminal"         },
  { to: "/rag",          icon: Brain,            label: "RAG Advisor"         },
  { to: "/settings",     icon: Settings,         label: "Settings"            },
];

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isOnline, isChecking, llmOnline } = useMcp();
  const { logout, user } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex h-screen overflow-hidden font-mono">
      {/* ── Sidebar ── */}
      <aside className="w-64 flex-shrink-0 border-r border-zinc-700/40 bg-zinc-900 flex flex-col">
        {/* ── Header / Logo ── */}
        <div className="p-6 border-b border-zinc-700/40">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="RedBox Logo"
              className="w-20 h-20 object-contain drop-shadow-[0_0_6px_rgba(239,68,68,0.6)]"
            />
            <div>
              <h1 className="text-lg font-bold text-zinc-100 tracking-tight font-mono">
                RedBox
              </h1>
              <p className="text-[10px] text-red-400/80 font-mono uppercase tracking-[0.2em]">
                // Security Platform
              </p>
            </div>
          </div>
        </div>

        {/* ── Navigation ── */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-mono transition-all ${
                  isActive
                    ? "bg-red-500/10 text-red-400 border border-red-500/30"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent"
                }`}
              >
                <item.icon className="w-4 h-4" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* ── Status Panel ── */}
        <div className="p-4 border-t border-zinc-700/40 space-y-2">
          {/* HexStrike MCP */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-zinc-800/80 border border-zinc-700/50">
            {isOnline ? (
              <Activity className="w-3 h-3 text-red-400 animate-pulse" />
            ) : (
              <WifiOff className="w-3 h-3 text-zinc-600" />
            )}
            <span className="text-xs text-zinc-300 font-mono uppercase tracking-[0.2em]">
              // HexStrike MCP
            </span>
            <span
              className={`text-[10px] font-mono ml-auto ${
                isOnline ? "text-red-400" : isChecking ? "text-zinc-600" : "text-zinc-600"
              }`}
            >
              {isChecking && !isOnline ? "..." : isOnline ? "ONLINE" : "OFFLINE"}
            </span>
          </div>

          {/* LLM Provider */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-zinc-800/80 border border-zinc-700/50">
            <Cpu className={`w-3 h-3 ${llmOnline ? "text-red-400" : "text-zinc-500"}`} />
            <span className="text-xs text-zinc-300 font-mono uppercase tracking-[0.2em]">
              // LLM Provider
            </span>
            <span
              className={`text-[10px] font-mono ml-auto ${
                llmOnline ? "text-red-400" : "text-zinc-500"
              }`}
            >
              {llmOnline ? "ONLINE" : "\u2014"}
            </span>
          </div>

          {/* User email */}
          <div className="px-3 py-1 text-[10px] text-zinc-500 font-mono truncate">
            {user?.email}
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 w-full rounded-md text-sm font-mono text-zinc-400 hover:text-red-400 hover:bg-zinc-800/60 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-auto bg-zinc-900 bg-[image:radial-gradient(rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:24px_24px]">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
};

export default AppLayout;
