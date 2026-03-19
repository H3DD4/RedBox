import { Router, Request, Response } from "express";
import { execFile } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db.js";
import { AppError } from "../lib/errors.js";

const router = Router();

// Dangerous command patterns to block
const BLOCKLIST_PATTERNS = [
  /\brm\s+(-rf?|--recursive)\b/i,
  /\bdel\s+\/s/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:(){ :|:& };:/,
  /\bfork\s*bomb\b/i,
  /\b>\s*\/dev\/sd/i,
  /\bchmod\s+777\s+\//i,
  /\brm\s+\/\b/i,
];

function isCommandSafe(command: string): boolean {
  return !BLOCKLIST_PATTERNS.some(pattern => pattern.test(command));
}

// POST /api/shell/exec
router.post("/exec", (req: Request, res: Response, next) => {
  try {
    const { command, shell: shellChoice } = req.body;
    if (!command || typeof command !== "string" || !command.trim()) {
      throw new AppError(400, "EMPTY_COMMAND", "Command is required");
    }
    
    if (!isCommandSafe(command)) {
      throw new AppError(403, "BLOCKED_COMMAND", "Command blocked by safety controls");
    }
    
    const isWindows = process.platform === "win32";
    let bin: string;
    let args: string[];
    
    if (shellChoice === "cmd") {
      bin = "cmd.exe"; args = ["/c", command];
    } else if (shellChoice === "bash") {
      bin = "/bin/bash"; args = ["-c", command];
    } else if (shellChoice === "zsh") {
      bin = "/bin/zsh"; args = ["-c", command];
    } else if (shellChoice === "powershell") {
      bin = "powershell.exe"; args = ["-NoProfile", "-Command", command];
    } else {
      // auto-detect
      if (isWindows) { bin = "powershell.exe"; args = ["-NoProfile", "-Command", command]; }
      else { bin = "/bin/bash"; args = ["-c", command]; }
    }
    
    execFile(bin, args, { timeout: 30000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
      // Audit log
      const db = getDb();
      db.prepare("INSERT INTO shell_audit (id, command, shell, user_id, exit_code) VALUES (?, ?, ?, ?, ?)")
        .run(uuidv4(), command, shellChoice || "auto", req.user?.userId || null, err ? 1 : 0);
      
      res.json({
        stdout: (stdout || "").trimEnd(),
        stderr: (stderr || "").trimEnd(),
        exitCode: err ? (err as NodeJS.ErrnoException & { code?: number }).code || 1 : 0,
      });
    });
  } catch (err) {
    next(err);
  }
});

export default router;
