# RedBox — Functional Architecture (Mermaid)

## How to use
1. Go to https://mermaid.live
2. Copy the code below
3. Paste it in the editor
4. Click "Actions" → "Download PNG" or "Download SVG"
5. Change theme to "dark" in settings for dark background

---

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'fontSize': '13px', 'fontFamily': 'monospace'}}}%%
flowchart TD
    %% ── 1. USER ENTRY ──
    A["Authentication
    JWT login, bcrypt hashing"] --> B

    B["Dashboard
    Active runs, findings overview
    LLM + MCP server status"] --> C

    C["Assessment Configuration
    ─────────────────────────────────
    Select: Test Type × Purpose → Task Router (35 routes)
    9 types: Web · API · RevEng · PWN · Crypto
    Forensics · Network · Mobile · OSINT
    4 purposes: CTF · Pentest · Red Team · Research
    Set: target, scope, LLM provider, MCP server, uploads"] --> D

    %% ── 2. ORCHESTRATION SETUP ──
    D["Route Resolution
    Task Router maps testType + purpose
    → prompt template + pipeline + MCP tools"] --> E

    E["Prompt Template Loading
    Load from prompts/ (ctf · pentesting · shared)
    Cached with 5-min TTL, @include resolution"] --> F

    F["Context Injection & Validation
    Inject 20+ vars: TARGET_URL, BINARY_PATH, CIPHER_TEXT...
    Sanitize inputs, security validation"] --> G

    G["Runtime Tool Discovery
    MCP Client → listTools from HexStrike
    Build agent context: built-in + MCP tools"] --> H

    %% ── 3. AGENT LOOP ──
    subgraph LOOP ["AGENT LOOP — max 30 iterations"]
        H["LLM Chat Completion
        ─────────────────────────────────
        LLM Gateway → active provider
        Ollama · OpenAI · Claude · Gemini
        Cerebras · Groq · Together · DeepSeek
        Auto-retry 5x, rate limiter, circuit breaker"] --> I

        I["Response Analysis
        Parse ACTION: directives from LLM output
        Anti-hallucination checks
        Flag extraction (15+ CTF patterns)
        Vulnerability detection (NLP)"] --> J1 & J2 & J3 & J4 & J5

        J1["Web Tools
        curl, headers
        dir_brute"]

        J2["Network
        nc, dns_lookup
        port_scan"]

        J3["File Analysis
        readfile, strings
        hexdump, fileinfo"]

        J4["Crypto
        base64, hash
        python scripts"]

        J5["MCP / HexStrike
        150+ security tools
        JSON-RPC + REST"]

        J1 & J2 & J3 & J4 & J5 --> K

        K["Findings & Flag Check
        ─────────────────────────────────
        Parse findings: SQLi · XSS · SSTI · RCE
        Path Traversal · Auth Bypass ...
        Auto-detect vuln type on flag capture
        Emit SSE events → live stream to frontend
        Break: flag captured OR assessment complete"]
    end

    K --> L

    %% ── 4. RESULTS & REPORTING ──
    L["Results Persistence
    Store to SQLite: findings, output
    flag_captured, iteration_count, token_usage"] --> M1 & M2 & M3

    M1["Executive Report
    C-level audience
    Risk + business impact
    Remediation timeline"]

    M2["Technical Report
    Security engineers
    CWE/CVE mappings
    Code-level fixes"]

    M3["Full Report
    Combined audience
    Exec + Technical
    30/60/90 day plan"]

    M1 & M2 & M3 --> N

    N["Export & Download
    Markdown + PDF generation
    LLM-powered with template fallback"]

    %% ── 5. PARALLEL FEATURES ──
    N --> O1 & O2

    O1["RAG Advisor — Knowledge Base
    Upload docs → chunk (512w) → embed
    TF-IDF or provider embeddings
    Semantic search → LLM-powered Q&A"]

    O2["AI Terminal — Interactive Shell
    LLM streaming chat
    Shell command execution (audit logged)
    Direct HexStrike MCP connectivity"]

    %% ── 6. EXTERNAL SYSTEMS ──
    H --> P1
    H --> P2

    P1["LLM Providers (10 supported)
    ─────────────────────────────────
    Ollama (local) · OpenAI · Claude
    Gemini · Cerebras · Groq · Together
    DeepSeek · OpenRouter · Custom
    LLM Registry → auto-detect API style"]

    P2["HexStrike MCP Server v6.0
    ─────────────────────────────────
    Python / Flask on 127.0.0.1:8888
    Network: nmap, masscan, rustscan
    Web: nuclei, sqlmap, gobuster, ffuf
    Cloud: prowler, trivy, kube-hunter
    Binary: ghidra, pwntools, ropper
    + OSINT, Forensics, Crypto"]

    %% ── 7. DATA LAYER ──
    L --> Q1
    L --> Q2

    Q1["SQLite Database (WAL mode)
    users · runs · reports
    llm_providers · mcp_servers
    rag_documents · rag_chunks
    uploads · shell_audit · settings"]

    Q2["Security Controls
    JWT auth · bcrypt hashing
    Command whitelist · blocklist
    Input sanitization · 50KB limit
    60s timeout · CORS · rate limiter"]

    %% ── STYLES ──
    style LOOP stroke-dasharray: 5 5
```

---

## Alternative: Simple Vertical Version (Paste in mermaid.live)

If the above is too complex for Mermaid rendering, use this simpler linear version:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'fontSize': '12px', 'fontFamily': 'monospace'}}}%%
flowchart TD
    A["🔐 Authentication\nJWT + bcrypt"] --> B["📊 Dashboard\nRuns · Findings · Status"]
    B --> C["⚙️ Assessment Config\n9 Test Types × 4 Purposes\n= 35 Route Combinations"]
    C --> D["🗺️ Route Resolution\nTask Router → prompt + pipeline"]
    D --> E["📄 Prompt Loading\nTemplates cached 5-min TTL"]
    E --> F["💉 Context Injection\n20+ variables · input sanitization"]
    F --> G["🔌 Tool Discovery\nMCP listTools · built-in tools"]

    G --> LOOP

    subgraph LOOP ["🔁 AGENT LOOP — max 30 iterations"]
        direction TB
        H["🤖 LLM Chat Completion\n10 providers · auto-retry · rate limiter"]
        H --> I["🔍 Response Analysis\nACTION parsing · anti-hallucination\nflag extraction · vuln detection"]
        I --> J["🔧 Tool Execution"]
        J --> J1["Web\ncurl · headers\ndir_brute"]
        J --> J2["Network\nnc · dns\nport_scan"]
        J --> J3["Files\nreadfile\nstrings · hex"]
        J --> J4["Crypto\nbase64 · hash\npython"]
        J --> J5["MCP\n150+ tools\nHexStrike"]
        J1 & J2 & J3 & J4 & J5 --> K["📋 Findings & Flags\nSQLi · XSS · SSTI · RCE\nflag capture → break"]
        K -.->|iterate| H
    end

    K --> L["💾 Store Results\nSQLite: findings · output · flags"]

    L --> M1["📊 Executive\nReport"]
    L --> M2["🔬 Technical\nReport"]
    L --> M3["📑 Full\nReport"]
    M1 & M2 & M3 --> N["📥 Export\nMD + PDF"]

    style LOOP stroke-dasharray: 5 5
```
