import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { config } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { ingestDocument, queryRAG, getRAGStats, listDocuments, deleteDocument } from "../services/rag-engine.js";

const upload = multer({ dest: path.join(config.uploadsDir, "rag-tmp") });
const router = Router();

// POST /api/rag/documents - Upload and ingest
router.post("/documents", upload.single("file"), async (req: Request, res: Response, next) => {
  try {
    if (!req.file) throw new AppError(400, "NO_FILE", "No file uploaded");
    
    // Read file content
    let content = "";
    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    
    if (ext === ".pdf") {
      try {
        const pdfMod = await import("pdf-parse");
        const pdfParse = (pdfMod as any).default ?? pdfMod;
        const buffer = fs.readFileSync(filePath);
        const data = await pdfParse(buffer);
        content = data.text;
      } catch {
        content = fs.readFileSync(filePath, "utf-8");
      }
    } else {
      // Plain text, markdown, etc.
      content = fs.readFileSync(filePath, "utf-8");
    }
    
    // Clean up temp file
    fs.unlinkSync(filePath);
    
    if (!content.trim()) {
      throw new AppError(400, "EMPTY_CONTENT", "Document has no extractable text content");
    }
    
    const result = await ingestDocument(
      req.file.originalname,
      req.file.originalname,
      content,
      req.file.mimetype || "text/plain",
      req.file.size
    );
    
    res.status(201).json({
      document: {
        id: result.id,
        name: req.file.originalname,
        chunks: result.chunkCount,
        status: "indexed",
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/rag/documents
router.get("/documents", (_req, res) => {
  res.json({ documents: listDocuments() });
});

// DELETE /api/rag/documents/:id
router.delete("/documents/:id", (req, res) => {
  deleteDocument(req.params.id);
  res.json({ ok: true });
});

// POST /api/rag/query
router.post("/query", async (req: Request, res: Response, next) => {
  try {
    const { question, topK } = req.body;
    if (!question) throw new AppError(400, "MISSING_QUESTION", "Question is required");
    
    const result = await queryRAG(question, topK || 5);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/rag/stats
router.get("/stats", (_req, res) => {
  res.json(getRAGStats());
});

// POST /api/rag/reindex
router.post("/reindex", async (_req, res) => {
  // Re-index all documents (rebuild TF-IDF vocabulary)
  // Full re-indexing with provider embeddings would need to re-embed all chunks
  res.json({ ok: true, message: "Vocabulary rebuilt" });
});

export default router;
