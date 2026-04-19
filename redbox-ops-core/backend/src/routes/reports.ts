import { Router, Request, Response } from "express";
import { generateReport, generatePDF, generateStyledHtmlReport, listReports, getReport, deleteReport } from "../services/report-generator.js";
import { AppError } from "../lib/errors.js";

const router = Router();

// POST /api/reports/generate
router.post("/generate", async (req: Request, res: Response, next) => {
  try {
    const { runId, type } = req.body;
    if (!runId || !type) throw new AppError(400, "MISSING_FIELDS", "runId and type are required");
    
    const validTypes = ["executive", "technical", "full"];
    if (!validTypes.includes(type)) {
      throw new AppError(400, "INVALID_TYPE", `Type must be one of: ${validTypes.join(", ")}`);
    }
    
    const report = await generateReport(runId, type);
    res.status(201).json({ report: { id: report.id, runId, type, status: "completed" } });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports
router.get("/", (req, res) => {
  const { runId } = req.query;
  const reports = listReports(runId as string | undefined);
  res.json({ reports });
});

// GET /api/reports/:id
router.get("/:id", (req, res, next) => {
  try {
    const report = getReport(req.params.id);
    if (!report) throw new AppError(404, "NOT_FOUND", "Report not found");
    res.json({ report });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:id/download
router.get("/:id/download", async (req: Request, res: Response, next) => {
  try {
    const report = getReport(req.params.id) as { id: string; content: string; type: string } | undefined;
    if (!report) throw new AppError(404, "NOT_FOUND", "Report not found");
    if (!report.content) throw new AppError(400, "NOT_READY", "Report content not yet generated");
    
    const format = (req.query.format as string || "html").toLowerCase();
    
    if (format === "pdf") {
      const pdf = await generatePDF(report.content);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="report-${report.type}-${report.id.slice(0, 8)}.pdf"`);
      res.send(pdf);
    } else if (format === "html") {
      const html = generateStyledHtmlReport(report.id);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `inline; filename="report-${report.type}-${report.id.slice(0, 8)}.html"`);
      res.send(html);
    } else {
      res.setHeader("Content-Type", "text/markdown");
      res.setHeader("Content-Disposition", `attachment; filename="report-${report.type}-${report.id.slice(0, 8)}.md"`);
      res.send(report.content);
    }
  } catch (err) {
    next(err);
  }
});

// DELETE /api/reports/:id
router.delete("/:id", (req, res) => {
  deleteReport(req.params.id);
  res.json({ ok: true });
});

export default router;
