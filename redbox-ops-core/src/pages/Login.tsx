import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Terminal, ChevronRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";

/* ── Matrix rain canvas ─────────────────────────────────────────────────── */
function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d")!;
    let raf: number;

    const chars = "01アイウエオカキクケコサシスセソ><{}[]=/\\!@#$%^&*REDBOX";
    const fontSize = 13;
    let columns = 0;
    let drops: number[] = [];

    function resize() {
      cvs.width = window.innerWidth;
      cvs.height = window.innerHeight;
      columns = Math.floor(cvs.width / fontSize);
      drops = Array.from({ length: columns }, () =>
        Math.random() * -cvs.height / fontSize
      );
    }

    resize();
    window.addEventListener("resize", resize);

    function draw() {
      ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
      ctx.fillRect(0, 0, cvs.width, cvs.height);

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        // Red tint with varying brightness
        const brightness = Math.random();
        if (brightness > 0.95) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        } else if (brightness > 0.8) {
          ctx.fillStyle = "rgba(220, 38, 38, 0.8)";
        } else {
          ctx.fillStyle = "rgba(220, 38, 38, 0.25)";
        }

        ctx.font = `${fontSize}px monospace`;
        ctx.fillText(char, x, y);

        if (y > cvs.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i] += 0.5 + Math.random() * 0.5;
      }
      raf = requestAnimationFrame(draw);
    }

    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ opacity: 0.35 }}
    />
  );
}

/* ── Login page ──────────────────────────────────────────────────────────── */
const Login = () => {
  const [email, setEmail] = useState("admin@redbox.io");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  if (isAuthenticated) {
    navigate("/dashboard", { replace: true });
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;

    setIsLoading(true);
    try {
      await login(email.trim(), password.trim());
      navigate("/dashboard", { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { error?: string })?.error ||
        (err instanceof Error ? err.message : "Login failed");
      toast({ title: "Login failed", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center p-4">
      {/* Animated matrix rain */}
      <MatrixRain />

      {/* Dark vignette overlay so card area stays readable */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 50% 60% at 50% 50%, transparent 0%, rgba(0,0,0,0.85) 100%)",
        }}
      />

      <div
        className={`w-full max-w-sm relative z-10 transition-all duration-700 ease-out ${
          mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
        }`}
      >
        {/* Logo — big, centered, tight to card */}
        <div className="flex justify-center mb-5">
          <img
            src="/logo.png"
            alt="RedBox"
            className="w-56 h-56 object-contain logo-entrance logo-glitch-idle"
          />
        </div>

        {/* Card */}
        <div
          className={`relative rounded-lg overflow-hidden transition-all duration-700 delay-200 ${
            mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          {/* Top accent line */}
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-red-500/70 to-transparent" />

          <div className="bg-zinc-900/85 backdrop-blur-md border border-red-500/25 rounded-lg p-7 space-y-5">
            {/* Header */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-red-500">
                <Terminal className="w-4 h-4" />
                <span className="text-[11px] font-mono font-bold uppercase tracking-[0.2em]">
                  auth_gateway
                </span>
              </div>
              <p className="text-[11px] font-mono text-zinc-300 leading-relaxed">
                <span className="text-red-500">$</span> requesting secure access...
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-red-400 uppercase tracking-[0.2em] block">
                  <span className="text-zinc-500">// </span>identity
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="operator@redbox.io"
                  required
                  autoFocus
                  className="w-full bg-zinc-900/80 border border-zinc-600 rounded px-3 py-2.5 text-sm font-mono text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-red-500/50 focus:shadow-[0_0_8px_hsl(0_72%_51%_/_0.15)] transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-red-400 uppercase tracking-[0.2em] block">
                  <span className="text-zinc-500">// </span>passphrase
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="****************"
                  required
                  className="w-full bg-zinc-900/80 border border-zinc-600 rounded px-3 py-2.5 text-sm font-mono text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-red-500/50 focus:shadow-[0_0_8px_hsl(0_72%_51%_/_0.15)] transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || !email || !password}
                className="w-full relative group bg-red-600 text-white rounded px-4 py-2.5 text-xs font-mono font-bold uppercase tracking-[0.15em] hover:bg-red-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-5 overflow-hidden shadow-[0_0_20px_rgba(220,38,38,0.25)]"
              >
                <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                {isLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>authenticating...</span>
                  </>
                ) : (
                  <>
                    <span>initiate_session</span>
                    <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </>
                )}
              </button>
            </form>

            {/* Dev credentials */}
            <p className="text-center text-[10px] font-mono text-zinc-400 tracking-wide pt-1">
              <span className="text-zinc-600">/*</span> admin@redbox.io / redbox <span className="text-zinc-600">*/</span>
            </p>
          </div>
        </div>

        {/* Bottom tagline */}
        <p
          className={`text-center text-[9px] font-mono text-zinc-500 uppercase tracking-[0.35em] mt-5 transition-all duration-700 delay-500 ${
            mounted ? "opacity-100" : "opacity-0"
          }`}
        >
          redbox // offensive security platform
        </p>
      </div>
    </div>
  );
};

export default Login;
