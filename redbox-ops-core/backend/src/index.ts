import express from "express";
import cors from "cors";
import morgan from "morgan";
import { createServer } from "http";
import { config } from "./lib/config.js";
import { errorHandler, notFound } from "./lib/errors.js";
import { requireAuth, optionalAuth } from "./middleware/auth.js";
import { getDb } from "./db.js";

// ─── Route imports ───────────────────────────────────────────────────────────
import authRoutes from "./routes/auth.js";
import healthRoutes from "./routes/health.js";
import mcpServerRoutes from "./routes/mcp-servers.js";
import llmProviderRoutes from "./routes/llm-providers.js";
import hexstrikeRoutes from "./routes/hexstrike.js";
import orchestratorRoutes from "./routes/orchestrator.js";
import uploadRoutes from "./routes/uploads.js";
import shellRoutes from "./routes/shell.js";
import ragRoutes from "./routes/rag.js";
import reportRoutes from "./routes/reports.js";
import dashboardRoutes from "./routes/dashboard.js";
import chatRoutes from "./routes/chat.js";

// ─── App ─────────────────────────────────────────────────────────────────────
const app = express();

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(morgan("dev"));
app.use(express.json({ limit: "50mb" }));
app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// ─── Initialize DB on startup ────────────────────────────────────────────────
try {
  getDb();
  console.log("  Database initialized");
} catch (err) {
  console.error("Failed to initialize database:", err);
  process.exit(1);
}

// ─── Public routes (no auth required) ────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/health", healthRoutes);

// ─── Protected routes ────────────────────────────────────────────────────────
app.use("/api/mcp-servers", requireAuth, mcpServerRoutes);
app.use("/api/llm-providers", requireAuth, llmProviderRoutes);
app.use("/api/hexstrike", requireAuth, hexstrikeRoutes);
app.use("/api/orchestrator", optionalAuth, orchestratorRoutes); // FIXED: Make run viewing accessible without strict auth
app.use("/api/uploads", requireAuth, uploadRoutes);
app.use("/api/shell", requireAuth, shellRoutes);
app.use("/api/rag", requireAuth, ragRoutes);
app.use("/api/reports", optionalAuth, reportRoutes); // FIXED: Make reports accessible without strict auth
app.use("/api/dashboard", requireAuth, dashboardRoutes);
app.use("/api/chat", requireAuth, chatRoutes);

// ─── Error handling ──────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start ───────────────────────────────────────────────────────────────────
const server = createServer(app);

server.listen(config.port, () => {
  console.log(`\n  RedBox Backend running on http://localhost:${config.port}`);
  console.log(`  HexStrike target: ${config.hexstrikeApiUrl}`);
  console.log(`  CORS origins: ${config.corsOrigins.join(", ")}`);
  console.log(`  Database: ${config.dbPath}\n`);
});

export default app;
