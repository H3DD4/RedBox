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
