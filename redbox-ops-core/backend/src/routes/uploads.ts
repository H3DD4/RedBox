import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import path from "path";
import fs from "fs";
import { getDb } from "../db.js";
import { config } from "../lib/config.js";
import { AppError } from "../lib/errors.js";

// Ensure uploads directory exists
if (!fs.existsSync(config.uploadsDir)) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadsDir),
  filename: (_req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

const router = Router();

// POST /api/uploads
router.post("/", upload.single("file"), (req: Request, res: Response, next) => {
  try {
    if (!req.file) throw new AppError(400, "NO_FILE", "No file uploaded");
    
    const db = getDb();
    const id = uuidv4();
    
    db.prepare(
      "INSERT INTO uploads (id, filename, original_name, mime_type, size) VALUES (?, ?, ?, ?, ?)"
    ).run(id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size);

    // Full absolute path to the uploaded file
    const filePath = path.join(config.uploadsDir, req.file.filename);

    res.status(201).json({
      upload: {
        id,
        filename: req.file.filename,
        original_name: req.file.originalname,  // snake_case for consistency with DB
        originalName: req.file.originalname,    // Keep camelCase for backwards compat
        mimeType: req.file.mimetype,
        size: req.file.size,
        file_path: filePath,  // ADDED: Full path for LLM to access the file
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/uploads
router.get("/", (_req, res) => {
  const db = getDb();
  const uploads = db.prepare("SELECT id, filename, original_name, mime_type, size, run_id, created_at FROM uploads ORDER BY created_at DESC").all();
  res.json({ uploads });
});

// GET /api/uploads/:id/download
router.get("/:id/download", (req, res, next) => {
  try {
    const db = getDb();
    const upload = db.prepare("SELECT * FROM uploads WHERE id = ?").get(req.params.id) as { filename: string; original_name: string } | undefined;
    if (!upload) throw new AppError(404, "NOT_FOUND", "Upload not found");
    
    const filePath = path.join(config.uploadsDir, upload.filename);
    if (!fs.existsSync(filePath)) throw new AppError(404, "FILE_MISSING", "File not found on disk");
    
    res.download(filePath, upload.original_name);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/uploads/:id
router.delete("/:id", (req, res, next) => {
  try {
    const db = getDb();
    const upload = db.prepare("SELECT * FROM uploads WHERE id = ?").get(req.params.id) as { filename: string } | undefined;
    if (!upload) throw new AppError(404, "NOT_FOUND", "Upload not found");
    
    // Delete file from disk
    const filePath = path.join(config.uploadsDir, upload.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    
    db.prepare("DELETE FROM uploads WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
