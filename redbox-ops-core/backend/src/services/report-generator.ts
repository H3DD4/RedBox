import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db.js";
import { chat } from "./llm-gateway.js";

interface RunData {
  id: string;
  target: string;
  scope: string;
  test_type: string;
  purpose: string;
  pipeline: string;
  status: string;
  findings: string;
  output: string;
  created_at: string;
  completed_at: string;
}

export async function generateReport(
  runId: string,
  type: "executive" | "technical" | "full"
): Promise<{ id: string; content: string }> {
  const db = getDb();
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunData | undefined;
  if (!run) throw new Error("Run not found");
  
  const findings = JSON.parse(run.findings || "[]");
  const output = JSON.parse(run.output || "[]");
  
  const reportId = uuidv4();
  db.prepare(
    "INSERT INTO reports (id, run_id, type, status) VALUES (?, ?, ?, 'generating')"
  ).run(reportId, runId, type);
  
  let content: string;
  
  try {
    const findingsText = findings.length > 0
      ? findings.map((f: { severity: string; title: string; cwe?: string; evidence?: string }, i: number) =>
          `${i + 1}. **[${f.severity?.toUpperCase()}]** ${f.title}${f.cwe ? ` (${f.cwe})` : ""}${f.evidence ? `\n   Evidence: ${f.evidence}` : ""}`
        ).join("\n")
      : "No findings detected";
    
    const outputSummary = output.map((o: { step: string; output: string }) =>
      `### ${o.step}\n${o.output?.slice(0, 500)}${o.output?.length > 500 ? "..." : ""}`
    ).join("\n\n");
    
    const prompt = getReportPrompt(type, run, findingsText, outputSummary);
    
    try {
      const result = await chat([
        { role: "system", content: "You are a professional security report writer. Generate clean, well-structured markdown reports." },
        { role: "user", content: prompt },
      ]);
      content = result.content;
    } catch {
      // If LLM unavailable, generate a template-based report
      content = generateTemplateReport(type, run, findingsText, outputSummary);
    }
    
    db.prepare("UPDATE reports SET content = ?, status = 'completed' WHERE id = ?")
      .run(content, reportId);
  } catch (err) {
    db.prepare("UPDATE reports SET status = 'failed' WHERE id = ?").run(reportId);
    throw err;
  }
  
  return { id: reportId, content };
}

function getReportPrompt(type: string, run: RunData, findingsText: string, outputSummary: string): string {
  const base = `Generate a ${type} security assessment report for:
- Target: ${run.target}
- Test Type: ${run.test_type}
- Purpose: ${run.purpose}
- Pipeline: ${run.pipeline}
- Date: ${run.created_at}

## Findings:
${findingsText}

## Assessment Output:
${outputSummary}`;

  if (type === "executive") {
    return `${base}\n\nFormat as an EXECUTIVE SUMMARY: brief, non-technical, focus on business impact and risk ratings. Include severity distribution chart (as markdown table), top risks, and recommended actions.`;
  }
  if (type === "technical") {
    return `${base}\n\nFormat as a TECHNICAL REPORT: detailed findings with evidence, CWE/CVE mappings, exploitation details, remediation steps, and proof-of-concept references.`;
  }
  return `${base}\n\nFormat as a FULL REPORT including both executive summary and technical details. Include: executive overview, methodology, detailed findings table, exploitation attempts and outcomes, risk matrix, and remediation roadmap.`;
}

function generateTemplateReport(type: string, run: RunData, findingsText: string, outputSummary: string): string {
  const header = `# Security Assessment Report

**Target:** ${run.target}  
**Type:** ${run.test_type}  
**Purpose:** ${run.purpose}  
**Pipeline:** ${run.pipeline}  
**Date:** ${run.created_at}  
**Status:** ${run.status}  

---`;

  if (type === "executive") {
    return `${header}

## Executive Summary

A ${run.test_type} security assessment was conducted against ${run.target} for the purpose of ${run.purpose}.

## Findings Summary

${findingsText}

## Risk Rating

Based on the findings above, the overall risk level should be reviewed by the security team.

## Recommended Actions

Review all findings and prioritize remediation based on severity.`;
  }

  return `${header}

## Methodology

Assessment pipeline: ${run.pipeline}

## Detailed Findings

${findingsText}

## Assessment Output

${outputSummary}

## Remediation Recommendations

Address findings in order of severity, starting with critical and high severity items.`;
}

export function generatePDF(markdownContent: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      // Use pdfkit to generate a simple PDF
      const PDFDocument = require("pdfkit");
      const doc = new PDFDocument({ margin: 50 });
      const buffers: Buffer[] = [];
      
      doc.on("data", (chunk: Buffer) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      
      // Simple markdown to PDF conversion
      const lines = markdownContent.split("\n");
      for (const line of lines) {
        if (line.startsWith("# ")) {
          doc.fontSize(20).font("Helvetica-Bold").text(line.slice(2), { paragraphGap: 10 });
        } else if (line.startsWith("## ")) {
          doc.fontSize(16).font("Helvetica-Bold").text(line.slice(3), { paragraphGap: 8 });
        } else if (line.startsWith("### ")) {
          doc.fontSize(13).font("Helvetica-Bold").text(line.slice(4), { paragraphGap: 6 });
        } else if (line.startsWith("---")) {
          doc.moveDown().strokeColor("#cccccc").lineWidth(0.5)
            .moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke()
            .moveDown();
        } else if (line.startsWith("**") && line.endsWith("**")) {
          doc.fontSize(11).font("Helvetica-Bold").text(line.replace(/\*\*/g, ""), { paragraphGap: 4 });
        } else if (line.trim() === "") {
          doc.moveDown(0.5);
        } else {
          doc.fontSize(11).font("Helvetica").text(line.replace(/\*\*/g, ""), { paragraphGap: 2 });
        }
      }
      
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export function listReports(runId?: string) {
  const db = getDb();
  if (runId) {
    return db.prepare("SELECT id, run_id, type, status, created_at FROM reports WHERE run_id = ? ORDER BY created_at DESC").all(runId);
  }
  return db.prepare("SELECT id, run_id, type, status, created_at FROM reports ORDER BY created_at DESC").all();
}

export function getReport(reportId: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM reports WHERE id = ?").get(reportId);
}

export function deleteReport(reportId: string) {
  const db = getDb();
  db.prepare("DELETE FROM reports WHERE id = ?").run(reportId);
}
