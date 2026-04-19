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

interface OutputStep {
  step: string;
  output: string;
}

interface RenderContext {
  report_id: string;
  report_type: "executive" | "technical" | "full";
  report_content: string;
  report_created_at: string;
  run_id: string;
  target: string;
  test_type: string;
  purpose: string;
  pipeline: string;
  run_status: string;
  findings: string;
  output: string;
  run_created_at: string;
  run_completed_at: string | null;
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
  const findingsCount = JSON.parse(run.findings || "[]").length;
  const findings = JSON.parse(run.findings || "[]");

  // Create severity summary for better context
  const severityCounts = {
    critical: findings.filter((f: any) => f.severity === 'critical').length,
    high: findings.filter((f: any) => f.severity === 'high').length,
    medium: findings.filter((f: any) => f.severity === 'medium').length,
    low: findings.filter((f: any) => f.severity === 'low').length,
    info: findings.filter((f: any) => f.severity === 'info').length,
  };

  const base = `Generate a professional cybersecurity assessment report for:

**ASSESSMENT DETAILS:**
- Target: ${run.target}
- Test Type: ${run.test_type}
- Purpose: ${run.purpose}
- Pipeline: ${run.pipeline}
- Assessment Date: ${new Date(run.created_at).toLocaleDateString()}
- Total Findings: ${findingsCount}

**SEVERITY BREAKDOWN:**
- 🔴 Critical: ${severityCounts.critical}
- 🟠 High: ${severityCounts.high}
- 🟡 Medium: ${severityCounts.medium}
- 🔵 Low: ${severityCounts.low}
- ⚪ Info: ${severityCounts.info}

**DETAILED FINDINGS:**
${findingsText}

**TECHNICAL ASSESSMENT OUTPUT:**
${outputSummary}`;

  if (type === "executive") {
    return `${base}

**REPORT REQUIREMENTS:**
Create an EXECUTIVE SUMMARY report targeting C-level executives and business stakeholders:

1. **Executive Summary** - High-level overview of security posture
2. **Risk Assessment** - Business impact and financial implications
3. **Severity Distribution** - Visual summary (markdown table format)
4. **Top Critical Issues** - Highlight the most severe findings (Critical & High only)
5. **Business Impact Analysis** - How vulnerabilities affect business operations
6. **Regulatory Compliance** - Potential compliance violations
7. **Recommended Actions** - Prioritized remediation timeline with business justification
8. **Resource Requirements** - Estimated effort and budget needed

Format: Use clear sections, bullet points, and business language. Avoid technical jargon. Focus on risk, impact, and business value.`;
  }

  if (type === "technical") {
    return `${base}

**REPORT REQUIREMENTS:**
Create a TECHNICAL REPORT targeting security engineers, developers, and IT teams:

1. **Technical Summary** - Overview of assessment methodology and scope
2. **Vulnerability Analysis** - Detailed breakdown by category (Web App, Network, Infrastructure, etc.)
3. **Exploitation Details** - Technical evidence and proof-of-concept information
4. **CWE/CVE Mappings** - Industry standard vulnerability classifications
5. **Risk Scoring** - CVSS scores and exploitability assessments
6. **Remediation Guides** - Step-by-step technical fixes for each finding
7. **Security Recommendations** - Best practices and hardening measures
8. **Verification Steps** - How to validate that fixes resolve the issues

Format: Use technical language, include code examples, configuration samples, and detailed remediation steps.`;
  }

  return `${base}

**REPORT REQUIREMENTS:**
Create a COMPREHENSIVE FULL REPORT combining both executive and technical perspectives:

**SECTION 1: EXECUTIVE OVERVIEW**
- Executive summary and business risk analysis
- Financial impact assessment and compliance implications
- Strategic recommendations for leadership

**SECTION 2: TECHNICAL DETAILS**
- Detailed vulnerability analysis with evidence
- Exploitation scenarios and attack vectors
- Technical remediation steps and code fixes

**SECTION 3: IMPLEMENTATION ROADMAP**
- Prioritized remediation timeline (30/60/90 days)
- Resource allocation and team assignments
- Progress tracking and validation methods
- Long-term security improvements

**SECTION 4: APPENDICES**
- Methodology and tools used
- Raw assessment output and logs
- Reference materials and compliance frameworks

Format: Professional document suitable for both business stakeholders and technical teams. Include executive summary, detailed findings, and actionable roadmap.`;
}

function generateTemplateReport(type: string, run: RunData, findingsText: string, outputSummary: string): string {
  const findings = JSON.parse(run.findings || "[]");
  const severityCounts = {
    critical: findings.filter((f: any) => f.severity === 'critical').length,
    high: findings.filter((f: any) => f.severity === 'high').length,
    medium: findings.filter((f: any) => f.severity === 'medium').length,
    low: findings.filter((f: any) => f.severity === 'low').length,
    info: findings.filter((f: any) => f.severity === 'info').length,
  };

  const totalFindings = findings.length;
  const criticalAndHigh = severityCounts.critical + severityCounts.high;
  const riskLevel = criticalAndHigh > 5 ? "HIGH" : criticalAndHigh > 2 ? "MEDIUM" : criticalAndHigh > 0 ? "LOW" : "MINIMAL";

  const header = `# 🔒 RedBox Security Assessment Report

**Target System:** ${run.target}
**Assessment Type:** ${run.test_type}
**Business Purpose:** ${run.purpose}
**Testing Pipeline:** ${run.pipeline}
**Assessment Date:** ${new Date(run.created_at).toLocaleDateString()}
**Report Status:** ${run.status.toUpperCase()}
**Overall Risk Level:** **${riskLevel} RISK**

---

## 📊 Executive Dashboard

| Metric | Count | Status |
|--------|-------|---------|
| 🔴 Critical Vulnerabilities | ${severityCounts.critical} | ${severityCounts.critical > 0 ? '⚠️ URGENT' : '✅ Good'} |
| 🟠 High Risk Issues | ${severityCounts.high} | ${severityCounts.high > 0 ? '🚨 Priority' : '✅ Good'} |
| 🟡 Medium Risk Issues | ${severityCounts.medium} | ${severityCounts.medium > 0 ? '⚡ Monitor' : '✅ Good'} |
| 🔵 Low Risk Issues | ${severityCounts.low} | ${severityCounts.low > 0 ? '📋 Review' : '✅ Good'} |
| ⚪ Informational | ${severityCounts.info} | 📝 Note |
| **Total Findings** | **${totalFindings}** | ${totalFindings === 0 ? '🎯 Clean' : '📊 Review'} |

---`;

  if (type === "executive") {
    return `${header}

## 🎯 Executive Summary

RedBox conducted a comprehensive ${run.test_type} security assessment of **${run.target}** for the purpose of ${run.purpose}. This assessment identified **${totalFindings} security findings** across multiple categories.

### 🔥 Critical Security Issues
${severityCounts.critical > 0 ?
  `⚠️ **${severityCounts.critical} CRITICAL vulnerabilities** were discovered that require immediate attention. These issues could lead to complete system compromise if exploited by attackers.` :
  '✅ **No critical vulnerabilities** were identified in this assessment.'
}

### ⚡ Risk Assessment

**Overall Security Posture:** ${riskLevel} RISK

- **Immediate Action Required:** ${criticalAndHigh} high-priority vulnerabilities
- **Business Impact:** ${criticalAndHigh > 3 ? 'Significant risk of data breach and service disruption' : criticalAndHigh > 0 ? 'Moderate risk requiring timely remediation' : 'Low risk with manageable security issues'}
- **Compliance Implications:** ${criticalAndHigh > 0 ? 'May impact regulatory compliance requirements' : 'No major compliance issues identified'}

### 📋 Security Findings Summary

${findingsText}

### 🛡️ Recommended Actions

**IMMEDIATE (0-7 days):**
- Address all critical vulnerabilities immediately
- Review and validate high-risk findings
- Implement emergency security patches

**SHORT TERM (1-4 weeks):**
- Remediate high and medium severity issues
- Strengthen security configurations
- Implement additional monitoring

**LONG TERM (1-3 months):**
- Address remaining low-priority issues
- Conduct follow-up security assessment
- Enhance security training and processes

### 💰 Resource Investment

Based on the findings, we recommend:
- **Security Team:** Immediate allocation of ${criticalAndHigh > 5 ? '2-3 security engineers' : criticalAndHigh > 0 ? '1-2 security engineers' : '1 security engineer'}
- **Timeline:** ${criticalAndHigh > 5 ? '2-4 weeks' : criticalAndHigh > 0 ? '1-2 weeks' : '1 week'} for critical remediations
- **Budget:** Consider investment in ${criticalAndHigh > 3 ? 'security tools and additional staff' : 'security improvements and training'}

---

*This report was generated by RedBox Security Platform. For questions, contact your security team.*`;
  }

  if (type === "technical") {
    return `${header}

## 🔬 Technical Assessment Details

### 🛠️ Methodology
**Assessment Pipeline:** ${run.pipeline}
**Scanning Technologies:** Automated security testing with manual validation
**Coverage:** ${run.test_type} assessment targeting multiple attack vectors

### 🎯 Scope and Target Analysis
**Target System:** ${run.target}
**Assessment Focus:** ${run.purpose}

### 🔍 Detailed Security Findings

${findingsText}

### 📊 Vulnerability Breakdown by Category

**Web Application Security:** ${findings.filter((f: any) => f.title.toLowerCase().includes('sql') || f.title.toLowerCase().includes('xss') || f.title.toLowerCase().includes('csrf')).length} findings
**Network Security:** ${findings.filter((f: any) => f.title.toLowerCase().includes('port') || f.title.toLowerCase().includes('ssl') || f.title.toLowerCase().includes('tls')).length} findings
**Authentication & Authorization:** ${findings.filter((f: any) => f.title.toLowerCase().includes('auth') || f.title.toLowerCase().includes('login')).length} findings
**Information Disclosure:** ${findings.filter((f: any) => f.title.toLowerCase().includes('disclosure') || f.title.toLowerCase().includes('leak')).length} findings
**Configuration Issues:** ${findings.filter((f: any) => f.title.toLowerCase().includes('config') || f.title.toLowerCase().includes('default')).length} findings

### 🔧 Technical Remediation Guide

#### Critical Priority Fixes
${severityCounts.critical > 0 ?
  'The following critical vulnerabilities require immediate patching:' :
  '✅ No critical vulnerabilities require immediate attention.'
}

#### Security Hardening Recommendations
1. **Input Validation:** Implement comprehensive input validation and sanitization
2. **Access Controls:** Review and strengthen authentication mechanisms
3. **Network Security:** Configure firewalls and network segmentation
4. **Monitoring:** Implement security logging and alerting
5. **Patches:** Maintain current security patches and updates

### 🧪 Assessment Technical Output

${outputSummary}

### ✅ Validation and Testing

To verify remediation efforts:
1. Re-run security scans after implementing fixes
2. Conduct penetration testing for high-risk findings
3. Validate security configurations against benchmarks
4. Monitor for any regression in security posture

---

*Technical Report Generated by RedBox Security Platform*`;
  }

  // Full Report
  return `${header}

## 🎯 Executive Summary

RedBox conducted a comprehensive security assessment of **${run.target}** identifying **${totalFindings} security findings** with an overall risk rating of **${riskLevel}**.

### Key Findings
- 🔴 **Critical:** ${severityCounts.critical} vulnerabilities requiring immediate attention
- 🟠 **High:** ${severityCounts.high} issues needing priority remediation
- 🟡 **Medium:** ${severityCounts.medium} security improvements recommended
- 🔵 **Low:** ${severityCounts.low} minor issues for routine maintenance

## 🔬 Technical Analysis

### Methodology
**Assessment Pipeline:** ${run.pipeline}
**Testing Approach:** ${run.test_type} assessment
**Business Context:** ${run.purpose}

### Detailed Security Findings

${findingsText}

## 🛠️ Implementation Roadmap

### Phase 1: Critical Response (0-7 days)
- [ ] Address all critical vulnerabilities
- [ ] Implement emergency security patches
- [ ] Validate critical system integrity

### Phase 2: High Priority (1-4 weeks)
- [ ] Remediate high-severity findings
- [ ] Strengthen access controls
- [ ] Implement security monitoring

### Phase 3: Security Enhancement (1-3 months)
- [ ] Address medium and low findings
- [ ] Security training and awareness
- [ ] Follow-up assessment

### Phase 4: Continuous Improvement (Ongoing)
- [ ] Regular security assessments
- [ ] Security metrics and reporting
- [ ] Threat intelligence integration

## 📋 Assessment Technical Output

${outputSummary}

## 📚 Appendices

### Resources and References
- OWASP Top 10 Security Risks
- CWE/CVE vulnerability databases
- Industry security benchmarks
- Regulatory compliance frameworks

### Methodology Details
- Automated vulnerability scanning
- Manual security testing
- Configuration review
- Risk assessment methodology

---

*Comprehensive Security Assessment Report - RedBox Security Platform*`;
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

export function generateStyledHtmlReport(reportId: string): string {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      r.id AS report_id,
      r.type AS report_type,
      r.content AS report_content,
      r.created_at AS report_created_at,
      r.run_id AS run_id,
      run.target AS target,
      run.test_type AS test_type,
      run.purpose AS purpose,
      run.pipeline AS pipeline,
      run.status AS run_status,
      run.findings AS findings,
      run.output AS output,
      run.created_at AS run_created_at,
      run.completed_at AS run_completed_at
    FROM reports r
    JOIN runs run ON run.id = r.run_id
    WHERE r.id = ?
  `).get(reportId) as RenderContext | undefined;

  if (!row) {
    throw new Error("Report not found");
  }

  const findings = safeParseArray<{
    severity?: string;
    title?: string;
    cwe?: string;
    cve?: string;
    confidence?: string;
    evidence?: string;
  }>(row.findings);

  const output = safeParseArray<OutputStep>(row.output);
  const severityCounts = countSeverities(findings);
  const criticalHigh = severityCounts.critical + severityCounts.high;
  const riskLevel = criticalHigh > 5 ? "HIGH" : criticalHigh > 2 ? "MEDIUM" : criticalHigh > 0 ? "LOW" : "MINIMAL";
  const flagCandidates = extractFlags(findings, output);

  const insights = buildInsights(row.report_type, findings, severityCounts, riskLevel);
  const timeline = output.slice(-5);

  const findingsHtml = findings.length === 0
    ? `<div class="empty">No vulnerabilities were recorded for this run.</div>`
    : findings.map((finding, index) => {
        const sev = normalizeSeverity(finding.severity);
        const title = finding.title || `Finding ${index + 1}`;
        const tags = [finding.cwe, finding.cve, finding.confidence].filter(Boolean).join(" | ");
        const evidence = truncate(finding.evidence || "No technical evidence provided.", 420);

        return `
          <article class="finding-card sev-${sev}">
            <div class="finding-head">
              <span class="sev-pill sev-${sev}">${sev.toUpperCase()}</span>
              <span class="finding-index">#${index + 1}</span>
            </div>
            <h3>${escapeHtml(title)}</h3>
            ${tags ? `<p class="meta">${escapeHtml(tags)}</p>` : ""}
            <p class="evidence">${escapeHtml(evidence)}</p>
          </article>
        `;
      }).join("");

  const timelineHtml = timeline.length === 0
    ? `<div class="empty">No execution timeline captured.</div>`
    : timeline.map((step, index) => `
        <li>
          <div class="step-number">${index + 1}</div>
          <div>
            <p class="step-title">${escapeHtml(step.step || `Step ${index + 1}`)}</p>
            <p class="step-output">${escapeHtml(truncate((step.output || "").replace(/\s+/g, " "), 220) || "No output snippet")}</p>
          </div>
        </li>
      `).join("");

  const markdownAppendix = row.report_content
    ? `
      <section class="panel">
        <h2>Generated Narrative (Appendix)</h2>
        <details>
          <summary>Open full markdown report</summary>
          <pre>${escapeHtml(row.report_content)}</pre>
        </details>
      </section>
    `
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RedBox ${escapeHtml(row.report_type)} report</title>
  <style>
    :root {
      --bg: #07090f;
      --bg-soft: #0f1422;
      --panel: #111827;
      --text: #e5e7eb;
      --muted: #9ca3af;
      --accent: #facc15;
      --danger: #f87171;
      --warning: #fb923c;
      --ok: #4ade80;
      --line: rgba(148, 163, 184, 0.25);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "Noto Sans", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 10% 10%, rgba(250, 204, 21, 0.08), transparent 38%),
        radial-gradient(circle at 85% 0%, rgba(248, 113, 113, 0.10), transparent 40%),
        linear-gradient(180deg, #05070c 0%, #0a1020 100%);
    }
    .wrap {
      max-width: 1120px;
      margin: 28px auto;
      padding: 0 18px 28px;
    }
    .hero {
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 22px;
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.82), rgba(15, 23, 42, 0.92));
      box-shadow: 0 18px 45px rgba(0, 0, 0, 0.35);
    }
    .hero-top {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      margin-bottom: 10px;
    }
    .title {
      margin: 0;
      font-size: clamp(1.2rem, 2.2vw, 1.8rem);
      letter-spacing: 0.02em;
      word-break: break-word;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border: 1px solid rgba(250, 204, 21, 0.45);
      color: #fde68a;
      background: rgba(250, 204, 21, 0.12);
      font-weight: 700;
    }
    .hero-meta {
      color: var(--muted);
      font-size: 0.92rem;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 8px 16px;
    }
    .metrics {
      margin-top: 14px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 10px;
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.65);
      padding: 11px 12px;
    }
    .metric .label {
      display: block;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 11px;
      margin-bottom: 4px;
    }
    .metric .value {
      font-size: 1.05rem;
      font-weight: 700;
    }
    .section-grid {
      margin-top: 14px;
      display: grid;
      gap: 14px;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 16px;
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.82), rgba(2, 6, 23, 0.82));
      padding: 16px;
    }
    .panel h2 {
      margin: 0 0 12px;
      font-size: 1.1rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .flags {
      border-color: rgba(250, 204, 21, 0.45);
      background: linear-gradient(135deg, rgba(133, 77, 14, 0.35), rgba(69, 26, 3, 0.22));
    }
    .flags-list {
      margin: 0;
      padding-left: 20px;
    }
    .flags-list li {
      font-family: "Consolas", "Courier New", monospace;
      color: #fde68a;
      margin-bottom: 6px;
      word-break: break-all;
    }
    .insight-list {
      margin: 0;
      padding-left: 18px;
      color: #d1d5db;
    }
    .insight-list li {
      margin-bottom: 8px;
      line-height: 1.5;
    }
    .findings-grid {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }
    .finding-card {
      border-radius: 12px;
      border: 1px solid var(--line);
      padding: 12px;
      background: rgba(2, 6, 23, 0.75);
    }
    .finding-card h3 {
      margin: 8px 0 6px;
      font-size: 1rem;
      line-height: 1.3;
    }
    .finding-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    .sev-pill {
      display: inline-block;
      border-radius: 999px;
      padding: 3px 9px;
      font-size: 11px;
      letter-spacing: 0.08em;
      font-weight: 700;
      border: 1px solid transparent;
    }
    .finding-index {
      color: var(--muted);
      font-size: 12px;
    }
    .meta {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
    }
    .evidence {
      margin: 8px 0 0;
      font-size: 0.92rem;
      color: #d1d5db;
      line-height: 1.45;
      white-space: pre-wrap;
    }
    .sev-critical { border-color: rgba(248, 113, 113, 0.45); }
    .sev-high { border-color: rgba(251, 146, 60, 0.45); }
    .sev-medium { border-color: rgba(250, 204, 21, 0.45); }
    .sev-low, .sev-info { border-color: rgba(74, 222, 128, 0.35); }
    .sev-pill.sev-critical { color: #fecaca; background: rgba(239, 68, 68, 0.18); border-color: rgba(248, 113, 113, 0.45); }
    .sev-pill.sev-high { color: #fed7aa; background: rgba(249, 115, 22, 0.18); border-color: rgba(251, 146, 60, 0.45); }
    .sev-pill.sev-medium { color: #fde68a; background: rgba(250, 204, 21, 0.15); border-color: rgba(250, 204, 21, 0.45); }
    .sev-pill.sev-low, .sev-pill.sev-info { color: #bbf7d0; background: rgba(34, 197, 94, 0.16); border-color: rgba(74, 222, 128, 0.4); }
    .timeline {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 10px;
    }
    .timeline li {
      display: grid;
      grid-template-columns: 32px 1fr;
      gap: 10px;
      padding: 10px;
      border-radius: 10px;
      background: rgba(15, 23, 42, 0.68);
      border: 1px solid rgba(148, 163, 184, 0.18);
    }
    .step-number {
      height: 24px;
      width: 24px;
      border-radius: 999px;
      border: 1px solid rgba(250, 204, 21, 0.45);
      display: grid;
      place-items: center;
      color: #fde68a;
      font-size: 12px;
      margin-top: 1px;
    }
    .step-title { margin: 0; font-weight: 700; }
    .step-output { margin: 4px 0 0; color: #cbd5e1; font-size: 0.88rem; line-height: 1.4; }
    .empty {
      color: var(--muted);
      padding: 8px 0;
      font-size: 0.95rem;
    }
    details {
      margin-top: 8px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-radius: 10px;
      overflow: hidden;
      background: rgba(2, 6, 23, 0.82);
    }
    summary {
      padding: 10px 12px;
      cursor: pointer;
      color: #e2e8f0;
      background: rgba(15, 23, 42, 0.8);
      font-weight: 600;
    }
    pre {
      margin: 0;
      padding: 12px;
      font-family: "Consolas", "Courier New", monospace;
      font-size: 12px;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre-wrap;
      color: #f1f5f9;
    }
    .footer {
      margin-top: 14px;
      color: var(--muted);
      font-size: 12px;
      text-align: right;
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="hero-top">
        <h1 class="title">${escapeHtml(row.target)}</h1>
        <span class="badge">${row.report_type.toUpperCase()} REPORT</span>
      </div>
      <div class="hero-meta">
        <span>Test Type: ${escapeHtml(row.test_type)}</span>
        <span>Purpose: ${escapeHtml(row.purpose)}</span>
        <span>Pipeline: ${escapeHtml(row.pipeline)}</span>
        <span>Run ID: ${escapeHtml(row.run_id.slice(0, 8))}...</span>
      </div>

      <div class="metrics">
        <div class="metric"><span class="label">Created</span><span class="value">${escapeHtml(formatDate(row.run_created_at))}</span></div>
        <div class="metric"><span class="label">Completed</span><span class="value">${escapeHtml(formatDate(row.run_completed_at || row.report_created_at))}</span></div>
        <div class="metric"><span class="label">Findings</span><span class="value">${findings.length}</span></div>
        <div class="metric"><span class="label">Risk Level</span><span class="value">${riskLevel}</span></div>
      </div>
    </section>

    <section class="section-grid">
      ${flagCandidates.length > 0 ? `
        <section class="panel flags">
          <h2>Flag Captured</h2>
          <ol class="flags-list">${flagCandidates.map((flag) => `<li>${escapeHtml(flag)}</li>`).join("")}</ol>
        </section>
      ` : ""}

      <section class="panel">
        <h2>Security Vulnerabilities Discovered</h2>
        <div class="findings-grid">${findingsHtml}</div>
      </section>

      <section class="panel">
        <h2>Action Plan</h2>
        <ol class="insight-list">${insights.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>
      </section>

      <section class="panel">
        <h2>Recent Execution Steps</h2>
        <ol class="timeline">${timelineHtml}</ol>
      </section>

      ${markdownAppendix}
    </section>

    <p class="footer">Generated by RedBox Security Platform</p>
  </main>
</body>
</html>`;
}

function safeParseArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function normalizeSeverity(severity: string | undefined): "critical" | "high" | "medium" | "low" | "info" {
  const normalized = (severity || "info").toLowerCase();
  if (normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "low" || normalized === "info") {
    return normalized;
  }
  return "info";
}

function countSeverities(findings: Array<{ severity?: string }>) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) {
    counts[normalizeSeverity(finding.severity)] += 1;
  }
  return counts;
}

function extractFlags(
  findings: Array<{ evidence?: string }>,
  output: OutputStep[]
): string[] {
  const pattern = /(?:[A-Za-z0-9_]+)?CTF\{[^\s}]{1,200}\}|FLAG\s*[:=]\s*[^\s,;]{3,200}/g;
  const seen = new Set<string>();
  const pushMatches = (text: string) => {
    for (const match of text.matchAll(pattern)) {
      const value = String(match[0]).trim();
      if (!value) continue;
      seen.add(value);
      if (seen.size >= 3) break;
    }
  };

  for (const f of findings) {
    if (f.evidence) pushMatches(f.evidence);
    if (seen.size >= 3) return Array.from(seen);
  }
  for (const step of output) {
    if (step.output) pushMatches(step.output);
    if (seen.size >= 3) return Array.from(seen);
  }
  return Array.from(seen);
}

function buildInsights(
  reportType: "executive" | "technical" | "full",
  findings: Array<{ title?: string; severity?: string }>,
  severityCounts: { critical: number; high: number; medium: number; low: number; info: number },
  riskLevel: string
): string[] {
  const topTitles = findings
    .filter((f) => {
      const sev = normalizeSeverity(f.severity);
      return sev === "critical" || sev === "high";
    })
    .slice(0, 2)
    .map((f) => f.title || "Unnamed finding");

  const shared = [
    `Overall risk posture is ${riskLevel}. Immediate focus should remain on ${severityCounts.critical + severityCounts.high} critical/high findings.`,
    topTitles.length > 0
      ? `Top priority issues: ${topTitles.join("; ")}.`
      : "No critical/high issues were detected. Continue with hardening and validation.",
    `Medium/low backlog contains ${severityCounts.medium + severityCounts.low + severityCounts.info} items and should be scheduled after urgent fixes.`,
  ];

  if (reportType === "executive") {
    return [
      ...shared,
      "Assign an owner for each high-impact item and confirm remediation windows in weekly governance meetings.",
    ];
  }

  if (reportType === "technical") {
    return [
      ...shared,
      "Re-test fixed findings with the same run profile and preserve proof in versioned security tickets.",
    ];
  }

  return [
    ...shared,
    "Run a 30/60/90 day remediation plan: urgent patching, control hardening, then regression testing.",
  ];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatDate(raw: string): string {
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleString();
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
