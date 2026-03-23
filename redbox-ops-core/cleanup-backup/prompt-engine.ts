import fs from "fs";
import path from "path";
import { config } from "../lib/config.js";

export interface PromptContext {
  target: string;
  scope?: string;
  testType?: string;
  purpose?: string;
  priorFindings?: string;
  uploadedArtifacts?: string[];
  mcpServer?: string;
  challengeName?: string;
  authRequired?: string;
  rulesAvoid?: string;
}

// Pipeline name -> folder mapping
const PIPELINE_FOLDERS: Record<string, string> = {
  "ctf-solving": "ctf solving",
  "real-pentesting": "real pentesting",
  "pipeline-testing": "pipeline-testing",
};

// List available pipelines
export function listPipelines(): string[] {
  return Object.keys(PIPELINE_FOLDERS);
}

// List available templates in a pipeline
export function listTemplates(pipeline: string): string[] {
  const folder = PIPELINE_FOLDERS[pipeline];
  if (!folder) return [];

  const dir = path.join(config.promptsDir, folder);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".txt"))
    .map(f => f.replace(".txt", ""));
}

// Load a template file
function loadTemplate(pipeline: string, templateName: string): string | null {
  const folder = PIPELINE_FOLDERS[pipeline];
  if (!folder) return null;

  const filePath = path.join(config.promptsDir, folder, `${templateName}.txt`);
  if (!fs.existsSync(filePath)) return null;

  return fs.readFileSync(filePath, "utf-8");
}

// Load a shared template
function loadShared(templateName: string): string {
  const filePath = path.join(config.promptsDir, "shared", `${templateName}.txt`);
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf-8");
}

// Simple placeholder replacement (no recursive includes)
function replaceSimplePlaceholders(template: string, ctx: PromptContext): string {
  let result = template;
  result = result.replace(/\{\{WEB_URL\}\}/g, ctx.target);
  result = result.replace(/\{\{TARGET_URL\}\}/g, ctx.target);
  result = result.replace(/\{\{TARGET\}\}/g, ctx.target);
  result = result.replace(/\{\{SCOPE\}\}/g, ctx.scope || "Full scope");
  result = result.replace(/\{\{TEST_TYPE\}\}/g, ctx.testType || "");
  result = result.replace(/\{\{PURPOSE\}\}/g, ctx.purpose || "");
  result = result.replace(/\{\{MCP_SERVER\}\}/g, ctx.mcpServer || "hexstrike");
  result = result.replace(/\{\{CHALLENGE_NAME\}\}/g, ctx.challengeName || "");
  result = result.replace(/\{\{AUTH_REQUIRED\}\}/g, ctx.authRequired || "No");
  result = result.replace(/\{\{RULES_AVOID\}\}/g, ctx.rulesAvoid || "None specified");
  result = result.replace(/\{\{PRIOR_FINDINGS\}\}/g, ctx.priorFindings || "None yet");
  return result;
}

// Inject context into template placeholders
function injectContext(template: string, ctx: PromptContext): string {
  // First replace simple placeholders
  let result = replaceSimplePlaceholders(template, ctx);

  // Then handle includes (only one level deep to prevent infinite recursion)
  const includePattern = /\{\{INCLUDE:([^}]+)\}\}/g;
  result = result.replace(includePattern, (_match, templateName: string) => {
    const sharedContent = loadShared(templateName);
    if (!sharedContent) return `[Missing template: ${templateName}]`;
    // Only replace simple placeholders in included templates (no nested includes)
    return replaceSimplePlaceholders(sharedContent, ctx);
  });

  return result;
}

// Get the orchestration steps for a pipeline
export function getOrchestratorPipeline(pipeline: string): string[] {
  const templates = listTemplates(pipeline);

  // Order: pre-recon-code -> recon -> vuln-* -> exploit-* -> report-executive
  const order = [
    "pre-recon-code",
    "recon",
    // vuln analysis
    ...templates.filter(t => t.startsWith("vuln-")).sort(),
    // exploit attempts
    ...templates.filter(t => t.startsWith("exploit-")).sort(),
    // additional analysis templates
    ...templates.filter(t => !t.startsWith("vuln-") && !t.startsWith("exploit-") && !["pre-recon-code", "recon", "report-executive"].includes(t)),
    "report-executive",
  ];

  // Filter to only templates that actually exist
  return order.filter(t => templates.includes(t));
}

// Render a specific pipeline step
export function renderStep(pipeline: string, step: string, context: PromptContext): string | null {
  const template = loadTemplate(pipeline, step);
  if (!template) return null;
  return injectContext(template, context);
}

export default {
  listPipelines,
  listTemplates,
  getOrchestratorPipeline,
  renderStep,
};
