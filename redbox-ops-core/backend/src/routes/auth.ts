import { Router, Request, Response } from "express";
import bcryptjs from "bcryptjs";
import { getDb } from "../db.js";
import { generateToken } from "../middleware/auth.js";
import { AppError } from "../lib/errors.js";

const router = Router();

// POST /api/auth/login
router.post("/login", (req: Request, res: Response, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      throw new AppError(400, "MISSING_FIELDS", "Email and password are required");
    }

    const db = getDb();
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as
      | { id: string; email: string; password_hash: string }
      | undefined;

    if (!user || !bcryptjs.compareSync(password, user.password_hash)) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const token = generateToken({ userId: user.id, email: user.email });

    res.json({
      token,
      user: { id: user.id, email: user.email },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post("/logout", (_req: Request, res: Response) => {
  // JWT is stateless - client just discards the token
  res.json({ ok: true });
});

// GET /api/auth/me
router.get("/me", (req: Request, res: Response, next) => {
  try {
    if (!req.user) {
      throw new AppError(401, "AUTH_REQUIRED", "Authentication required");
    }
    const db = getDb();
    const user = db.prepare("SELECT id, email, created_at FROM users WHERE id = ?").get(req.user.userId) as
      | { id: string; email: string; created_at: string }
      | undefined;

    if (!user) {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }

    res.json({ user });
  } catch (err) {
    next(err);
  }
});

export default router;
