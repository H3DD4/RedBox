import { useState, useEffect } from "react";
import {
  AlertTriangle, ShieldCheck, Info, Clock, Target, FileText, Flag,
  Loader2, Trash2, Download, X, ChevronDown, ChevronUp, Trophy,
  Shield, Bug, Zap, Eye, Copy, CheckCircle2, AlertCircle,
  ExternalLink, Lightbulb, TrendingUp, Clock3, Users, DollarSign
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/StatusBadge";
import { experiences, orchestrator, reports, type Run, type Finding } from "@/services/api-client";
import { useToast } from "@/hooks/use-toast";

interface RunDetailModalProps {
  runId: string | null;
  open: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}

type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export function RunDetailModal({ runId, open, onClose, onDeleted }: RunDetailModalProps) {
  const { toast } = useToast();
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [expandedFindings, setExpandedFindings] = useState<Set<number>>(new Set());
  const [savingValidatedFindings, setSavingValidatedFindings] = useState<Set<string>>(new Set());
  const [savedValidatedFindings, setSavedValidatedFindings] = useState<Set<string>>(new Set());
  const [generatingReport, setGeneratingReport] = useState(false);
  const [copiedFlag, setCopiedFlag] = useState(false);

  useEffect(() => {
    if (!runId || !open) {
      setRun(null);
      return;
    }

    setLoading(true);
    orchestrator
      .getRun(runId)
      .then(({ run: r }) => setRun(r))
      .catch((err) => {
        toast({
          title: "Failed to load run",
          description: err.error || "Unknown error",
          variant: "destructive",
        });
        onClose();
      })
      .finally(() => setLoading(false));
  }, [runId, open]);

  const handleDelete = async () => {
    if (!runId) return;
    setDeleting(true);
    try {
      await orchestrator.deleteRun(runId);
      toast({ title: "Run deleted", description: "The scan has been removed from history." });
      onDeleted?.();
      onClose();
    } catch (err) {
      toast({
        title: "Delete failed",
        description: (err as { error?: string }).error || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleGenerateReport = async (type: "executive" | "technical" | "full") => {
    if (!runId) return;
    setGeneratingReport(true);
    try {
      console.log(`[Report] Generating ${type} report for run ${runId}...`);
      const { report } = await reports.generate(runId, type);

      // Give user clear feedback about what happened
      toast({
        title: "✅ Report Generated Successfully!",
        description: `${type.charAt(0).toUpperCase() + type.slice(1)} report is ready for download`,
        duration: 5000
      });

      console.log(`[Report] Generated report ${report.id}, opening download...`);

      // Open download in new tab
      const downloadUrl = reports.downloadUrl(report.id, "html");
      console.log(`[Report] Download URL: ${downloadUrl}`);

      // Try to download the report
      const newWindow = window.open(downloadUrl, "_blank");
      if (!newWindow) {
        // If popup blocked, show clickable link
        toast({
          title: "📄 Report Ready - Click to Download",
          description: (
            <div className="space-y-2">
              <p>Your {type} report is ready!</p>
              <button
                onClick={() => window.open(downloadUrl, "_blank")}
                className="underline text-blue-400 hover:text-blue-300"
              >
                Click here to download the report
              </button>
            </div>
          ),
          duration: 10000,
        });
      } else {
        // Additional feedback that download started
        setTimeout(() => {
          toast({
            title: "📥 Download Started",
            description: "Check your Downloads folder for the report file",
            duration: 3000
          });
        }, 1000);
      }
    } catch (err) {
      console.error("[Report] Generation failed:", err);
      const errorMessage = (err as { error?: string }).error || "Unknown error occurred";
      toast({
        title: "❌ Report Generation Failed",
        description: `Failed to generate ${type} report: ${errorMessage}`,
        variant: "destructive",
        duration: 8000
      });
    } finally {
      setGeneratingReport(false);
    }
  };

  const toggleStep = (idx: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleFinding = (idx: number) => {
    setExpandedFindings((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const copyFlag = async (flag: string) => {
    await navigator.clipboard.writeText(flag);
    setCopiedFlag(true);
    setTimeout(() => setCopiedFlag(false), 2000);
    toast({ title: "Flag copied!", description: "Flag has been copied to clipboard" });
  };

  const findingKey = (finding: Finding) =>
    `${finding.title}|${finding.cwe || ""}|${finding.cve || ""}|${(finding.evidence || "").slice(0, 120)}`;

  const handleValidateFindingToMemory = async (finding: Finding) => {
    if (!runId) return;

    const key = findingKey(finding);
    if (savingValidatedFindings.has(key) || savedValidatedFindings.has(key)) return;

    setSavingValidatedFindings((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });

    try {
      const result = await experiences.validateRunFinding(runId, {
        severity: finding.severity,
        title: finding.title,
        cwe: finding.cwe,
        cve: finding.cve,
        confidence: finding.confidence,
        evidence: finding.evidence,
      }, "validated");

      setSavedValidatedFindings((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });

      toast({
        title: result.created ? "Finding saved to experience memory" : "Finding validation updated",
        description: result.findingTitle,
      });
    } catch (err) {
      toast({
        title: "Validation failed",
        description: (err as { error?: string }).error || "Could not persist finding to experience memory",
        variant: "destructive",
      });
    } finally {
      setSavingValidatedFindings((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // Parse findings to separate flags from vulnerabilities
  const flags = run?.findings?.filter(f => f.title.includes("🚩 Flag Captured:")) || [];
  const vulnerabilities = run?.findings?.filter(f => !f.title.includes("🚩 Flag Captured:")) || [];
  const isCTF = run?.purpose === "ctf";

  // Group vulnerabilities by severity
  const vulnsBySeverity = {
    critical: vulnerabilities.filter(v => v.severity === "critical"),
    high: vulnerabilities.filter(v => v.severity === "high"),
    medium: vulnerabilities.filter(v => v.severity === "medium"),
    low: vulnerabilities.filter(v => v.severity === "low"),
    info: vulnerabilities.filter(v => v.severity === "info"),
  };

  const severityIcon = (s: FindingSeverity) => {
    if (s === "critical") return <AlertTriangle className="w-4 h-4 text-red-500" />;
    if (s === "high") return <Shield className="w-4 h-4 text-orange-500" />;
    if (s === "medium") return <Bug className="w-4 h-4 text-yellow-500" />;
    if (s === "low") return <Eye className="w-4 h-4 text-blue-400" />;
    return <Info className="w-4 h-4 text-zinc-400" />;
  };

  const severityColor = (s: string) => {
    if (s === "critical") return "text-red-500 bg-red-500/10 border-red-500/30";
    if (s === "high") return "text-orange-500 bg-orange-500/10 border-orange-500/30";
    if (s === "medium") return "text-yellow-500 bg-yellow-500/10 border-yellow-500/30";
    if (s === "low") return "text-blue-400 bg-blue-400/10 border-blue-400/30";
    return "text-zinc-400 bg-zinc-400/10 border-zinc-400/30";
  };

  const getSeverityPriority = (s: string) => {
    const priorities = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
    return priorities[s as keyof typeof priorities] || 0;
  };

  // Enhanced vulnerability helpers - ALL SECURITY CATEGORIES
  const getVulnerabilityExplanation = (title: string, severity: string) => {
    const lowerTitle = title.toLowerCase();

    // WEB APPLICATION VULNERABILITIES
    if (lowerTitle.includes('sql') || lowerTitle.includes('injection')) {
      return {
        what: "SQL Injection allows attackers to manipulate database queries through untrusted input.",
        risk: "Attackers can access, modify, or delete sensitive data, potentially compromising the entire database.",
        impact: severity === 'critical' ? "Complete database takeover possible" : "Data breach and manipulation possible"
      };
    }

    if (lowerTitle.includes('xss') || lowerTitle.includes('cross-site scripting')) {
      return {
        what: "Cross-Site Scripting (XSS) allows attackers to inject malicious scripts into web pages.",
        risk: "Attackers can steal user sessions, redirect users to malicious sites, or deface the website.",
        impact: "User accounts and sensitive information at risk"
      };
    }

    if (lowerTitle.includes('csrf') || lowerTitle.includes('cross-site request')) {
      return {
        what: "Cross-Site Request Forgery tricks users into performing unintended actions.",
        risk: "Attackers can perform actions on behalf of legitimate users without their consent.",
        impact: "Unauthorized actions and data modification"
      };
    }

    if (lowerTitle.includes('directory traversal') || lowerTitle.includes('path traversal')) {
      return {
        what: "Directory Traversal allows access to files and directories outside the intended scope.",
        risk: "Attackers can read sensitive files, configuration data, or system information.",
        impact: "Sensitive file exposure and potential system compromise"
      };
    }

    // AUTHENTICATION & AUTHORIZATION
    if (lowerTitle.includes('authentication') || lowerTitle.includes('login')) {
      return {
        what: "Authentication vulnerabilities allow bypassing or weakening login security.",
        risk: "Attackers can gain unauthorized access to user accounts or administrative functions.",
        impact: "Account takeover and privilege escalation"
      };
    }

    if (lowerTitle.includes('authorization') || lowerTitle.includes('access control')) {
      return {
        what: "Authorization flaws allow accessing resources or actions beyond granted permissions.",
        risk: "Users can access data or perform actions they shouldn't be allowed to.",
        impact: "Data exposure and privilege escalation"
      };
    }

    // CODE EXECUTION VULNERABILITIES
    if (lowerTitle.includes('rce') || lowerTitle.includes('remote code execution') || lowerTitle.includes('command injection')) {
      return {
        what: "Remote Code Execution allows attackers to run arbitrary code on the target system.",
        risk: "Complete system compromise - attackers can control the entire application and server.",
        impact: "Full system takeover and data breach"
      };
    }

    if (lowerTitle.includes('deserialization') || lowerTitle.includes('unsafe deserialization')) {
      return {
        what: "Unsafe Deserialization can lead to remote code execution through malicious serialized objects.",
        risk: "Attackers can execute arbitrary code by crafting malicious serialized payloads.",
        impact: "Complete system compromise via object manipulation"
      };
    }

    // NETWORK & INFRASTRUCTURE
    if (lowerTitle.includes('open port') || lowerTitle.includes('exposed service')) {
      return {
        what: "Open ports or exposed services provide unnecessary attack surface to potential attackers.",
        risk: "Attackers can probe and potentially exploit services that shouldn't be publicly accessible.",
        impact: "Increased attack surface and potential service exploitation"
      };
    }

    if (lowerTitle.includes('ssl') || lowerTitle.includes('tls') || lowerTitle.includes('certificate')) {
      return {
        what: "SSL/TLS security issues compromise encrypted communications between client and server.",
        risk: "Attackers can intercept, modify, or decrypt sensitive communications.",
        impact: "Data interception and man-in-the-middle attacks"
      };
    }

    if (lowerTitle.includes('dns') || lowerTitle.includes('subdomain takeover')) {
      return {
        what: "DNS vulnerabilities allow attackers to hijack domain resolution or take over subdomains.",
        risk: "Attackers can redirect traffic, steal credentials, or serve malicious content.",
        impact: "Domain hijacking and traffic redirection"
      };
    }

    if (lowerTitle.includes('ssh') || lowerTitle.includes('weak password') || lowerTitle.includes('brute force')) {
      return {
        what: "Weak authentication mechanisms allow attackers to guess or brute-force credentials.",
        risk: "Attackers can gain unauthorized system access through credential attacks.",
        impact: "System compromise via credential theft"
      };
    }

    // INFORMATION DISCLOSURE
    if (lowerTitle.includes('information disclosure') || lowerTitle.includes('sensitive data') || lowerTitle.includes('data leak')) {
      return {
        what: "Information Disclosure exposes sensitive data that should be protected.",
        risk: "Confidential information like passwords, tokens, or personal data becomes visible to attackers.",
        impact: "Privacy breach and potential system compromise"
      };
    }

    if (lowerTitle.includes('version disclosure') || lowerTitle.includes('banner grabbing')) {
      return {
        what: "Version disclosure reveals software versions and technologies used by the system.",
        risk: "Attackers can identify known vulnerabilities in specific software versions.",
        impact: "Reconnaissance aid for targeted attacks"
      };
    }

    if (lowerTitle.includes('error message') || lowerTitle.includes('stack trace')) {
      return {
        what: "Verbose error messages reveal internal system information and application structure.",
        risk: "Attackers gain insight into system architecture and potential attack vectors.",
        impact: "Information leakage aiding further attacks"
      };
    }

    // MOBILE & API SECURITY
    if (lowerTitle.includes('api') || lowerTitle.includes('rest') || lowerTitle.includes('json')) {
      return {
        what: "API security vulnerabilities expose application programming interfaces to abuse.",
        risk: "Attackers can manipulate API calls to access unauthorized data or functionality.",
        impact: "Data breach and unauthorized functionality access"
      };
    }

    if (lowerTitle.includes('mobile') || lowerTitle.includes('android') || lowerTitle.includes('ios')) {
      return {
        what: "Mobile application vulnerabilities expose sensitive data or functionality on mobile devices.",
        risk: "Attackers can access device resources, steal data, or compromise mobile functionality.",
        impact: "Mobile device compromise and data theft"
      };
    }

    // CRYPTOGRAPHIC VULNERABILITIES
    if (lowerTitle.includes('crypto') || lowerTitle.includes('encryption') || lowerTitle.includes('hash')) {
      return {
        what: "Cryptographic vulnerabilities use weak or broken encryption implementations.",
        risk: "Attackers can break encryption, forge signatures, or decrypt sensitive data.",
        impact: "Compromise of data confidentiality and integrity"
      };
    }

    if (lowerTitle.includes('weak cipher') || lowerTitle.includes('insecure algorithm')) {
      return {
        what: "Weak cryptographic algorithms or ciphers provide insufficient protection for sensitive data.",
        risk: "Attackers can break weak encryption through various cryptographic attacks.",
        impact: "Data decryption and security bypass"
      };
    }

    // BUSINESS LOGIC FLAWS
    if (lowerTitle.includes('business logic') || lowerTitle.includes('workflow')) {
      return {
        what: "Business logic flaws allow bypassing intended application workflows and restrictions.",
        risk: "Attackers can manipulate application flow to gain unauthorized advantages.",
        impact: "Circumvention of business rules and security controls"
      };
    }

    if (lowerTitle.includes('race condition') || lowerTitle.includes('time-of-check')) {
      return {
        what: "Race conditions occur when application behavior depends on timing of uncontrolled events.",
        risk: "Attackers can manipulate timing to bypass security checks or cause unexpected behavior.",
        impact: "Security bypass through timing manipulation"
      };
    }

    // CONFIGURATION & DEPLOYMENT
    if (lowerTitle.includes('misconfiguration') || lowerTitle.includes('default') || lowerTitle.includes('hardening')) {
      return {
        what: "Security misconfigurations leave systems in vulnerable states due to improper setup.",
        risk: "Attackers can exploit known default configurations or missing security settings.",
        impact: "System compromise due to weak configuration"
      };
    }

    if (lowerTitle.includes('cors') || lowerTitle.includes('cross-origin')) {
      return {
        what: "Cross-Origin Resource Sharing (CORS) misconfigurations allow unauthorized cross-domain requests.",
        risk: "Attackers can make requests from malicious sites to steal data or perform actions.",
        impact: "Cross-domain data theft and unauthorized actions"
      };
    }

    // SUPPLY CHAIN & DEPENDENCIES
    if (lowerTitle.includes('dependency') || lowerTitle.includes('library') || lowerTitle.includes('component')) {
      return {
        what: "Vulnerable dependencies or third-party components introduce security risks to applications.",
        risk: "Attackers can exploit known vulnerabilities in outdated or insecure libraries.",
        impact: "Application compromise through third-party vulnerabilities"
      };
    }

    // CLOUD & CONTAINER SECURITY
    if (lowerTitle.includes('cloud') || lowerTitle.includes('aws') || lowerTitle.includes('azure') || lowerTitle.includes('gcp')) {
      return {
        what: "Cloud security misconfigurations expose cloud resources to unauthorized access.",
        risk: "Attackers can access cloud services, data, or compute resources.",
        impact: "Cloud infrastructure compromise and data exposure"
      };
    }

    if (lowerTitle.includes('docker') || lowerTitle.includes('container') || lowerTitle.includes('kubernetes')) {
      return {
        what: "Container security issues expose containerized applications to compromise.",
        risk: "Attackers can escape containers, access host systems, or compromise orchestration.",
        impact: "Container escape and cluster compromise"
      };
    }

    // SOCIAL ENGINEERING & PHYSICAL SECURITY
    if (lowerTitle.includes('social engineering') || lowerTitle.includes('phishing')) {
      return {
        what: "Social engineering attacks manipulate people to divulge confidential information.",
        risk: "Attackers can trick users into revealing credentials or performing malicious actions.",
        impact: "Human-based security bypass and information theft"
      };
    }

    // Default explanation for unknown vulnerabilities
    return {
      what: "Security vulnerability identified through comprehensive security analysis.",
      risk: "This security issue could be exploited by attackers to compromise system security.",
      impact: severity === 'critical' ? "Severe security risk requiring immediate attention" :
              severity === 'high' ? "High security risk with significant potential impact" :
              severity === 'medium' ? "Moderate security risk needing attention" :
              "Security issue identified for review"
    };
  };

  const getRemediationAdvice = (title: string) => {
    const lowerTitle = title.toLowerCase();

    // WEB APPLICATION FIXES
    if (lowerTitle.includes('sql') || lowerTitle.includes('injection')) {
      return "Use parameterized queries and input validation. Never concatenate user input into SQL statements.";
    }
    if (lowerTitle.includes('xss')) {
      return "Sanitize all user input and use Content Security Policy (CSP) headers. Encode output data.";
    }
    if (lowerTitle.includes('csrf')) {
      return "Implement CSRF tokens and verify referrer headers. Use SameSite cookies.";
    }
    if (lowerTitle.includes('directory traversal')) {
      return "Validate file paths and use allow-lists. Avoid direct file path construction from user input.";
    }

    // AUTHENTICATION & AUTHORIZATION
    if (lowerTitle.includes('authentication')) {
      return "Implement multi-factor authentication and secure session management.";
    }
    if (lowerTitle.includes('authorization')) {
      return "Implement proper access controls and validate permissions on every request.";
    }
    if (lowerTitle.includes('weak password') || lowerTitle.includes('brute force')) {
      return "Enforce strong password policies, implement account lockouts, and use rate limiting.";
    }

    // CODE EXECUTION
    if (lowerTitle.includes('rce') || lowerTitle.includes('command injection')) {
      return "Never execute user input as code. Use safe APIs and validate all inputs rigorously.";
    }
    if (lowerTitle.includes('deserialization')) {
      return "Avoid deserializing untrusted data. Use safe serialization formats like JSON instead of binary formats.";
    }

    // NETWORK & INFRASTRUCTURE
    if (lowerTitle.includes('open port') || lowerTitle.includes('exposed service')) {
      return "Close unnecessary ports and services. Use firewalls to restrict access to essential services only.";
    }
    if (lowerTitle.includes('ssl') || lowerTitle.includes('tls')) {
      return "Update SSL/TLS configurations. Use strong cipher suites and disable deprecated protocols.";
    }
    if (lowerTitle.includes('dns')) {
      return "Secure DNS configurations and monitor for subdomain takeovers. Use DNS security extensions.";
    }
    if (lowerTitle.includes('ssh')) {
      return "Disable SSH password authentication. Use key-based authentication and restrict SSH access.";
    }

    // INFORMATION DISCLOSURE
    if (lowerTitle.includes('information disclosure') || lowerTitle.includes('data leak')) {
      return "Review and restrict information exposure. Implement proper error handling and logging controls.";
    }
    if (lowerTitle.includes('version disclosure')) {
      return "Configure servers to hide version information. Use security headers to prevent information leakage.";
    }
    if (lowerTitle.includes('error message')) {
      return "Implement generic error messages for users. Log detailed errors securely for administrators only.";
    }

    // API & MOBILE
    if (lowerTitle.includes('api')) {
      return "Implement proper API authentication and rate limiting. Validate all API inputs and outputs.";
    }
    if (lowerTitle.includes('mobile')) {
      return "Follow mobile security best practices. Implement certificate pinning and secure data storage.";
    }

    // CRYPTOGRAPHIC
    if (lowerTitle.includes('crypto') || lowerTitle.includes('encryption')) {
      return "Use strong, up-to-date cryptographic algorithms. Implement proper key management practices.";
    }
    if (lowerTitle.includes('weak cipher')) {
      return "Update to strong cipher suites. Remove support for deprecated and weak cryptographic algorithms.";
    }

    // BUSINESS LOGIC
    if (lowerTitle.includes('business logic')) {
      return "Review and test business logic flows. Implement proper validation at each step of processes.";
    }
    if (lowerTitle.includes('race condition')) {
      return "Implement proper locking mechanisms and atomic operations to prevent race conditions.";
    }

    // CONFIGURATION
    if (lowerTitle.includes('misconfiguration') || lowerTitle.includes('default')) {
      return "Review and harden all system configurations. Change default passwords and remove unnecessary features.";
    }
    if (lowerTitle.includes('cors')) {
      return "Configure CORS policies restrictively. Only allow necessary origins and methods.";
    }

    // SUPPLY CHAIN
    if (lowerTitle.includes('dependency') || lowerTitle.includes('library')) {
      return "Update all dependencies to latest secure versions. Monitor for known vulnerabilities in components.";
    }

    // CLOUD & CONTAINERS
    if (lowerTitle.includes('cloud') || lowerTitle.includes('aws') || lowerTitle.includes('azure') || lowerTitle.includes('gcp')) {
      return "Review cloud security configurations. Follow cloud provider security best practices and enable security monitoring.";
    }
    if (lowerTitle.includes('docker') || lowerTitle.includes('container')) {
      return "Secure container images and runtime. Use minimal base images and implement proper security contexts.";
    }

    // SOCIAL ENGINEERING
    if (lowerTitle.includes('social engineering') || lowerTitle.includes('phishing')) {
      return "Implement security awareness training. Use email security measures and user behavior monitoring.";
    }

    // Default remediation
    return "Follow security best practices and validate all inputs. Implement defense in depth security measures.";
  };

  const getDifficultyIndicator = (severity: string, confidence?: string) => {
    if (severity === 'critical') return { label: 'Trivial', color: 'text-red-400', icon: '🚨' };
    if (severity === 'high') return { label: 'Easy', color: 'text-orange-400', icon: '⚠️' };
    if (severity === 'medium') return { label: 'Moderate', color: 'text-yellow-400', icon: '🔍' };
    if (severity === 'low') return { label: 'Hard', color: 'text-blue-400', icon: '🔒' };
    return { label: 'Research', color: 'text-gray-400', icon: '📋' };
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-6xl max-h-[95vh] overflow-hidden bg-zinc-900 border-zinc-700 p-0">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-red-500" />
          </div>
        ) : run ? (
          <div className="flex flex-col h-full max-h-[95vh]">
            {/* Header */}
            <DialogHeader className="px-6 py-4 border-b border-zinc-700/50 bg-zinc-900/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isCTF ? (
                    <Trophy className="w-5 h-5 text-yellow-500" />
                  ) : (
                    <Target className="w-5 h-5 text-red-500" />
                  )}
                  <div>
                    <DialogTitle className="text-zinc-100 font-mono text-lg">
                      {run.target}
                    </DialogTitle>
                    <DialogDescription className="text-zinc-400 font-mono text-xs mt-1">
                      {run.test_type} · {run.pipeline} · {run.purpose}
                      {isCTF && flags.length > 0 && <span className="text-yellow-500 ml-2">🚩 {flags.length} flag{flags.length !== 1 ? 's' : ''} captured</span>}
                    </DialogDescription>
                  </div>
                </div>
                <StatusBadge
                  variant={
                    run.status === "completed" ? "online"
                    : run.status === "failed" ? "offline"
                    : run.status === "running" ? "warning"
                    : "offline"
                  }
                  label={run.status}
                  pulse={run.status === "running"}
                />
              </div>
            </DialogHeader>

            {/* Content - scrollable */}
            <div className="flex-1 overflow-auto p-6 space-y-6">
              {/* Metadata Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/30">
                  <p className="text-[10px] font-mono text-zinc-500 uppercase">Created</p>
                  <p className="text-sm font-mono text-zinc-200">
                    {new Date(run.created_at).toLocaleString()}
                  </p>
                </div>
                {run.completed_at && (
                  <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/30">
                    <p className="text-[10px] font-mono text-zinc-500 uppercase">Completed</p>
                    <p className="text-sm font-mono text-zinc-200">
                      {new Date(run.completed_at).toLocaleString()}
                    </p>
                  </div>
                )}
                <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/30">
                  <p className="text-[10px] font-mono text-zinc-500 uppercase">
                    {isCTF ? "Flags/Findings" : "Findings"}
                  </p>
                  <p className="text-sm font-mono text-zinc-200">
                    {isCTF && flags.length > 0 ? `🚩 ${flags.length} / ${vulnerabilities.length}` : vulnerabilities.length}
                  </p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/30">
                  <p className="text-[10px] font-mono text-zinc-500 uppercase">Run ID</p>
                  <p className="text-sm font-mono text-zinc-400 truncate" title={run.id}>
                    {run.id.slice(0, 8)}...
                  </p>
                </div>
              </div>

              {/* Scope */}
              {run.scope && (
                <div className="bg-zinc-800/30 rounded-lg p-4 border border-zinc-700/30">
                  <p className="text-[10px] font-mono text-red-400/70 uppercase mb-2 flex items-center gap-2">
                    <FileText className="w-3 h-3" /> Scope / Notes
                  </p>
                  <p className="text-sm font-mono text-zinc-300 whitespace-pre-wrap">{run.scope}</p>
                </div>
              )}

              {/* CTF FLAGS SECTION - Prominent for CTF challenges */}
              {isCTF && flags.length > 0 && (
                <div className="bg-gradient-to-r from-yellow-500/10 to-orange-500/10 rounded-lg p-6 border border-yellow-500/30">
                  <div className="flex items-center gap-3 mb-4">
                    <Trophy className="w-6 h-6 text-yellow-500" />
                    <h3 className="text-lg font-mono text-yellow-400 uppercase tracking-wider">
                      🚩 FLAG{flags.length !== 1 ? 'S' : ''} CAPTURED
                    </h3>
                    <div className="bg-yellow-500/20 px-2 py-1 rounded text-xs font-mono text-yellow-300">
                      {flags.length} found
                    </div>
                  </div>
                  <div className="space-y-3">
                    {flags.map((flag, i) => {
                      const flagValue = flag.title.replace("🚩 Flag Captured: ", "");
                      return (
                        <div key={i} className="bg-black/30 rounded-lg p-4 border border-yellow-500/20">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-mono text-yellow-500 uppercase">Flag {i + 1}</span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-3 bg-yellow-500/10 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20"
                              onClick={() => copyFlag(flagValue)}
                            >
                              {copiedFlag ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                              {copiedFlag ? "Copied!" : "Copy"}
                            </Button>
                          </div>
                          <div className="font-mono text-lg text-yellow-300 bg-black/50 p-3 rounded border-l-4 border-yellow-500">
                            {flagValue}
                          </div>
                          {flag.evidence && (
                            <p className="text-xs text-zinc-400 font-mono mt-2">{flag.evidence}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* VULNERABILITY FINDINGS SECTION - ENHANCED FOR CLARITY */}
              {vulnerabilities.length > 0 && (
                <div className="space-y-6">
                  {/* Header with Summary */}
                  <div className="bg-gradient-to-r from-red-500/10 to-orange-500/10 rounded-lg p-4 border border-red-500/30">
                    <div className="flex items-center gap-3 mb-3">
                      <AlertTriangle className="w-6 h-6 text-red-500" />
                      <h3 className="text-lg font-semibold text-red-400 uppercase tracking-wider">
                        🔥 SECURITY VULNERABILITIES DISCOVERED
                      </h3>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      {(["critical", "high", "medium", "low", "info"] as const).map(severity => {
                        const count = vulnsBySeverity[severity].length;
                        if (count === 0) return null;
                        return (
                          <div key={severity} className={`text-center p-3 rounded-lg border ${severityColor(severity)}`}>
                            {severityIcon(severity)}
                            <div className="text-lg font-bold mt-1">{count}</div>
                            <div className="text-xs uppercase font-mono">{severity}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Findings by Severity - Enhanced */}
                  {(["critical", "high", "medium", "low", "info"] as const).map(severity => {
                    const severityFindings = vulnsBySeverity[severity];
                    if (severityFindings.length === 0) return null;

                    return (
                      <div key={severity} className="space-y-3">
                        <div className={`flex items-center gap-3 text-base font-semibold px-4 py-3 rounded-lg border ${severityColor(severity)}`}>
                          {severityIcon(severity)}
                          <span className="uppercase">{severity} RISK</span>
                          <span className="ml-auto bg-black/20 px-2 py-1 rounded text-sm">{severityFindings.length}</span>
                        </div>

                        <div className="space-y-4">
                          {severityFindings.map((finding, i) => {
                            const findingIdx = vulnerabilities.indexOf(finding);
                            const isExpanded = expandedFindings.has(findingIdx);
                            const explanation = getVulnerabilityExplanation(finding.title, finding.severity);
                            const remediation = getRemediationAdvice(finding.title);
                            const difficulty = getDifficultyIndicator(finding.severity, finding.confidence);

                            return (
                              <div key={findingIdx} className="bg-zinc-800/60 rounded-xl border border-zinc-700/50 overflow-hidden shadow-lg">
                                {/* Vulnerability Header */}
                                <div className="p-5 bg-gradient-to-r from-zinc-800/80 to-zinc-900/60">
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-3 mb-2">
                                        {severityIcon(finding.severity as FindingSeverity)}
                                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${severityColor(finding.severity)}`}>
                                          {finding.severity}
                                        </span>
                                        <div className="flex items-center gap-1">
                                          <Clock3 className="w-3 h-3" />
                                          <span className={`text-xs font-mono ${difficulty.color}`}>
                                            {difficulty.icon} {difficulty.label} to exploit
                                          </span>
                                        </div>
                                      </div>
                                      <h4 className="text-lg font-semibold text-zinc-100 mb-2">{finding.title}</h4>
                                      <p className="text-sm text-zinc-300 leading-relaxed">{explanation.what}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleValidateFindingToMemory(finding)}
                                        disabled={savingValidatedFindings.has(findingKey(finding)) || savedValidatedFindings.has(findingKey(finding)) || run?.status !== "completed"}
                                        className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                                      >
                                        {savingValidatedFindings.has(findingKey(finding)) ? (
                                          <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Saving...
                                          </>
                                        ) : savedValidatedFindings.has(findingKey(finding)) ? (
                                          <>
                                            <CheckCircle2 className="w-4 h-4 mr-2" />
                                            Validated
                                          </>
                                        ) : (
                                          <>
                                            <ShieldCheck className="w-4 h-4 mr-2" />
                                            Validate to Memory
                                          </>
                                        )}
                                      </Button>

                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => toggleFinding(findingIdx)}
                                        className="text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/30"
                                      >
                                        {isExpanded ? (
                                          <ChevronUp className="w-5 h-5" />
                                        ) : (
                                          <ChevronDown className="w-5 h-5" />
                                        )}
                                      </Button>
                                    </div>
                                  </div>

                                  {/* Risk & Impact Summary */}
                                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-red-500/10 rounded-lg p-3 border border-red-500/30">
                                      <div className="flex items-center gap-2 mb-1">
                                        <AlertCircle className="w-4 h-4 text-red-400" />
                                        <span className="text-xs font-bold text-red-400 uppercase">Potential Risk</span>
                                      </div>
                                      <p className="text-sm text-red-200">{explanation.risk}</p>
                                    </div>
                                    <div className="bg-orange-500/10 rounded-lg p-3 border border-orange-500/30">
                                      <div className="flex items-center gap-2 mb-1">
                                        <TrendingUp className="w-4 h-4 text-orange-400" />
                                        <span className="text-xs font-bold text-orange-400 uppercase">Business Impact</span>
                                      </div>
                                      <p className="text-sm text-orange-200">{explanation.impact}</p>
                                    </div>
                                  </div>

                                  {/* Technical Details */}
                                  <div className="mt-4 flex flex-wrap gap-4 text-xs">
                                    {finding.cwe && (
                                      <div className="flex items-center gap-1">
                                        <Bug className="w-3 h-3 text-zinc-500" />
                                        <span className="text-zinc-500">CWE:</span>
                                        <span className="text-zinc-300 font-mono">{finding.cwe}</span>
                                      </div>
                                    )}
                                    {finding.cve && (
                                      <div className="flex items-center gap-1">
                                        <ExternalLink className="w-3 h-3 text-zinc-500" />
                                        <span className="text-zinc-500">CVE:</span>
                                        <span className="text-zinc-300 font-mono">{finding.cve}</span>
                                      </div>
                                    )}
                                    {finding.confidence && (
                                      <div className="flex items-center gap-1">
                                        <Eye className="w-3 h-3 text-zinc-500" />
                                        <span className="text-zinc-500">Confidence:</span>
                                        <span className="text-zinc-300">{finding.confidence}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Expanded Details */}
                                {isExpanded && (
                                  <div className="border-t border-zinc-700/50">
                                    {/* Remediation */}
                                    <div className="p-5 bg-blue-500/5 border-t border-blue-500/20">
                                      <div className="flex items-center gap-2 mb-3">
                                        <Lightbulb className="w-4 h-4 text-blue-400" />
                                        <span className="text-sm font-bold text-blue-400 uppercase">💡 How to Fix This</span>
                                      </div>
                                      <p className="text-sm text-blue-100 leading-relaxed">{remediation}</p>
                                    </div>

                                    {/* Technical Evidence */}
                                    {finding.evidence && (
                                      <div className="p-5 bg-zinc-900/80">
                                        <div className="flex items-center gap-2 mb-3">
                                          <FileText className="w-4 h-4 text-zinc-400" />
                                          <span className="text-sm font-bold text-zinc-400 uppercase">🔍 Technical Evidence</span>
                                        </div>
                                        <div className="bg-black/50 rounded-lg p-4 border border-zinc-700/50">
                                          <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-64 overflow-auto">
                                            {finding.evidence}
                                          </pre>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {/* Security Recommendations Summary */}
                  <div className="bg-gradient-to-r from-green-500/10 to-blue-500/10 rounded-lg p-5 border border-green-500/30 mt-8">
                    <div className="flex items-center gap-3 mb-3">
                      <ShieldCheck className="w-5 h-5 text-green-400" />
                      <h4 className="text-lg font-semibold text-green-400 uppercase">🛡️ Next Steps</h4>
                    </div>
                    <ul className="text-sm text-green-100 space-y-2">
                      <li>• <strong>Prioritize Critical & High risks</strong> - These can lead to complete system compromise</li>
                      <li>• <strong>Validate findings</strong> - Test each vulnerability in a safe environment</li>
                      <li>• <strong>Apply patches immediately</strong> - Update affected components and libraries</li>
                      <li>• <strong>Implement monitoring</strong> - Set up alerts for similar attack patterns</li>
                      <li>• <strong>Re-scan after fixes</strong> - Verify that vulnerabilities have been resolved</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* Pipeline Output */}
              {run.output && run.output.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Zap className="w-5 h-5 text-blue-500" />
                    <h3 className="text-lg font-mono text-zinc-200 uppercase tracking-wider">Pipeline Output</h3>
                  </div>

                  <div className="space-y-2">
                    {run.output.map((step, i) => (
                      <div key={i} className="bg-zinc-800/40 rounded-lg overflow-hidden border border-zinc-700/40">
                        <button
                          onClick={() => toggleStep(i)}
                          className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-700/30 transition-colors"
                        >
                          <span className="text-sm font-mono text-zinc-200">{step.step}</span>
                          {expandedSteps.has(i) ? (
                            <ChevronUp className="w-4 h-4 text-zinc-500" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-zinc-500" />
                          )}
                        </button>
                        {expandedSteps.has(i) && (
                          <div className="px-4 pb-4 border-t border-zinc-700/30">
                            <pre className="text-xs font-mono text-zinc-400 whitespace-pre-wrap bg-black/30 rounded p-3 max-h-64 overflow-auto mt-3">
                              {step.output}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {(!run.findings || run.findings.length === 0) && (!run.output || run.output.length === 0) && (
                <div className="flex flex-col items-center justify-center py-16 text-zinc-500 space-y-3">
                  <FileText className="w-12 h-12 opacity-30" />
                  <div className="text-center">
                    <p className="text-lg font-mono mb-1">No Results Available</p>
                    <p className="text-sm font-mono opacity-60">
                      {run.status === "running" ? "Task is still running..." : "This run didn't produce any findings or output."}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-zinc-700/50 bg-zinc-900/30 flex items-center justify-between">
              <Button
                variant="outline"
                className="gap-2 border-red-500/40 text-red-400 hover:bg-red-500/10 font-mono"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </Button>

              <div className="flex gap-2">
                {run.status === "completed" && (
                  <div className="flex gap-2">
                    <div className="relative group">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-red-400 font-mono text-xs"
                        onClick={() => handleGenerateReport("executive")}
                        disabled={generatingReport}
                      >
                        <Download className="w-3.5 h-3.5" />
                        Executive
                      </Button>
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-black border border-zinc-700 rounded text-xs text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none w-48 z-50">
                        High-level summary for management: business impact, risk ratings, recommendations
                      </div>
                    </div>
                    <div className="relative group">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-red-400 font-mono text-xs"
                        onClick={() => handleGenerateReport("technical")}
                        disabled={generatingReport}
                      >
                        <Download className="w-3.5 h-3.5" />
                        Technical
                      </Button>
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-black border border-zinc-700 rounded text-xs text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none w-48 z-50">
                        Detailed technical findings: evidence, exploitation steps, remediation guides
                      </div>
                    </div>
                    <div className="relative group">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-red-400 font-mono text-xs"
                        onClick={() => handleGenerateReport("full")}
                        disabled={generatingReport}
                      >
                        <Download className="w-3.5 h-3.5" />
                        Full Report
                      </Button>
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-black border border-zinc-700 rounded text-xs text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none w-48 z-50">
                        Complete assessment: executive summary + technical details + remediation roadmap
                      </div>
                    </div>
                  </div>
                )}
                <Button
                  variant="outline"
                  className="gap-2 bg-zinc-800 border-zinc-700 text-zinc-300 font-mono"
                  onClick={onClose}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-20 text-zinc-500 font-mono">
            No run selected
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default RunDetailModal;
