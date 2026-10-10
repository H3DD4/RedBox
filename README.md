# 🔴 RedBox — Autonomous AI Penetration-Testing Orchestrator

<div align="center">
  <img src="redbox-ops-core/pic_assets/RedBox-removebg-preview.png" alt="RedBox Logo" width="200"/>

  **An autonomous security-testing agent where the LLM proposes — and deterministic engines confirm.**

  [![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
  [![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://reactjs.org/)
  [![Node.js](https://img.shields.io/badge/Node.js-43853D?logo=node.js&logoColor=white)](https://nodejs.org/)
  [![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white)](https://www.python.org/)
</div>

---

## 📖 Overview

**RedBox** is an autonomous AI penetration-testing orchestrator. It drives real security tools through a multi-phase agent loop, reasons about a target across runs, and produces confirmed findings and reports — not guesses.

Its design answers the core failure mode of autonomous agents: **a language model is good at proposing what to try next and unreliable at knowing whether it worked.** So in RedBox the model is never the authority. It proposes an action; deterministic code executes the real tool; and a deterministic validation layer decides whether a vulnerability is actually there. The model has ideas — it has no authority. Authority lives in deterministic code and verified evidence.

That one principle — **confidence–authority separation** — shapes every part of the system: how findings are confirmed, what is allowed to persist, and how the agent learns across runs.

---

## 🧩 What makes it different

- **LLM proposes, deterministic engine confirms.** Findings are validated by pure functions (boolean / timing / reflection / error-signature differentials) — no model in the confirm path. A finding is *confirmed* because an observable difference was measured, not because the model asserted it.
- **Evidence-gated persistence.** Nothing reaches the knowledge graph from model text alone. A finding is only recorded if it carries real evidence; a technique is only learned from a verified success signal.
- **Cross-run memory.** RedBox doesn't start cold. It remembers which techniques worked on which kinds of target, with probabilistic beliefs and value estimates updated from outcomes.
- **Bounded autonomy.** Per-phase iteration budgets, loop detection, dead-end tracking, and anti-hallucination guards keep the agent from spinning, fabricating, or burning tokens.
- **Resilient by design.** Every external dependency (LLM, tools, graph DB) can fail without crashing the run — the system degrades, notifies, and keeps going.

---

## ⚙️ How it works

### The agent loop

A run carries a **test type** (web, api, reverse-engineering, crypto, forensics…) and a **purpose** (ctf, pentest, redteam, research). A router maps that pair to a tuned pipeline, and a phase engine turns it into ordered phases (e.g. `recon → analyze → exploit → report`), each with its own prompt template and iteration budget. The target model is carried phase to phase, so later phases build on what recon learned.

Each iteration runs a strict cycle:

1. **Assemble context** — system message, mission config (scope and rules injected as *hard constraints*), a competency briefing for this target, and any recalled past experience.
2. **Propose** — one LLM call emits exactly one action in a strict `ACTION: tool | {json}` contract.
3. **Parse strictly** — actions are schema-validated; a malformed action is re-prompted (bounded), never executed. Findings are parsed only with non-empty evidence.
4. **Anti-hallucination gate** — early turns are rejected if the model fabricates analysis, invents tools, or writes a "solution" before touching the target.
5. **Execute for real** — a built-in tool or an MCP-routed HexStrike tool runs; output is capped and sanitized.
6. **Confirm & persist** — deterministic oracles validate findings; only verified evidence updates the belief graph and cross-run memory.
7. **Loop control** — periodic graph refresh, intent-hash loop detection, and phase advancement on repetition; the phase ends on a completion signal or when its budget is spent.

### Memory & learning

RedBox keeps four distinct memory structures, each answering a different question:

| Structure | Question it answers | Store | Key mechanic |
| --- | --- | --- | --- |
| **Target model** | What is true about *this* target now? | in-memory | binary hypotheses: open / confirmed / refuted |
| **Belief graph** | How *confident* am I in each claim? | in-memory | probabilistic nodes `[0,1]`, contradiction penalty |
| **Experience memory** | What worked on *similar* targets? | SQLite | q-values `[-1,1]`, EMA updates, similarity recall |
| **Competency graph** | What's my proven skill per vuln class? | Neo4j | 3-stage, success-rate-weighted retrieval |

The subtle part: the competency score is **never** updated from the model's own post-run self-reflection — it consumes the same *verified* success signals the run produced. Learning is anchored to proof, not to the model's opinion of itself.

### Trust & safety engineering

- **Deterministic validation oracles** — boolean, timing, reflection, and error-signature differentials confirm findings the way a human pentester or `sqlmap` would.
- **Anti-hallucination guards** — reject fabricated analysis, non-existent tools, and placeholder flags; flags found in text are routed to a verification step, never trusted directly.
- **Loop & abuse resistance** — the iteration pipeline is hardened against loop amplification, tool-surface abuse, state poisoning, and token exhaustion ([design notes](redbox-ops-core/docs/ITERATION_ATTACK_TREE.md)).
- **Graceful degradation** — Neo4j offline → run continues without persistent intelligence; a tool/MCP server down → protocol fallback then route-around; a bad LLM response → continue with reduced functionality.

---

## 📈 Track record

- Autonomously solved **60+ CTF challenges** end to end.
- Surfaced **3 real vulnerabilities in production environments** (real-world targets, not just CTFs).
- The **web-testing path is the most mature and proven**; the same architecture is now being extended to **binary analysis** (packer detection, stub recovery, layer-by-layer decryption, memory dump and unpacked-executable reconstruction).

---

## 🏗️ Architecture

```
RedBox/
├── redbox-ops-core/              # Main application
│   ├── backend/                  # Express + TypeScript
│   │   └── src/
│   │       ├── routes/           # API endpoints (SSE-streamed runs)
│   │       ├── services/         # Orchestrator, gateway, memory, validation
│   │       │   ├── orchestrator.ts          # The agent loop
│   │       │   ├── llm-gateway.ts            # Multi-LLM abstraction
│   │       │   ├── validation.ts             # Deterministic confirmation oracles
│   │       │   ├── experience-memory.ts      # Cross-run q-value learning
│   │       │   ├── competency-retrieval.ts   # Neo4j 3-stage skill retrieval
│   │       │   ├── graph-service.ts          # Attack chains / graph intelligence
│   │       │   └── verified-signals-store.ts # Evidence bridge for learning
│   │       └── types/belief-graph.ts         # Probabilistic target beliefs
│   │   └── prompts/              # Per-phase security testing templates
│   └── src/                      # React + TypeScript frontend (live run view)
└── hexstrike/                    # MCP tool server (Python) — real tool execution
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.8+ (for the HexStrike MCP server)
- **Neo4j** 5.x (optional — graph persistence and attack-path analysis)
- **Ollama** (optional, local LLM) or API keys for cloud LLMs (OpenAI, Anthropic, Groq, Gemini…)

### 1. Clone

```bash
git clone https://github.com/H3DD4/RedBox.git
cd RedBox
```

### 2. Install frontend & backend

```bash
cd redbox-ops-core
npm install
cd backend && npm install && cd ..
```

### 3. Configure environment

```bash
cp .env.example .env                 # frontend
cp backend/.env.example backend/.env # backend
```

Edit the `.env` files: database path, API ports, LLM provider endpoints, and (optional) Neo4j connection:

```bash
NEO4J_URI=bolt://localhost:9687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-password
NEO4J_DATABASE=neo4j
```

### 4. (Optional) Neo4j graph store

```bash
docker run -p 9474:7474 -p 9687:7687 -e NEO4J_AUTH=neo4j/password neo4j:latest
cd redbox-ops-core/backend && npm run neo4j:init
```

### 5. (Optional) HexStrike MCP server

```bash
cd hexstrike/hexstrike-ai
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python hexstrike_server.py
```

### 6. Start

```bash
# Terminal 1 — backend
cd redbox-ops-core/backend && npm run dev
# Terminal 2 — frontend
cd redbox-ops-core && npm run dev
```

Then open **http://localhost:5173**. Default login: `admin@redbox.io` / `redbox`.

---

## 🐳 Docker Compose (recommended)

```bash
docker compose up --build                      # full stack incl. Neo4j
docker compose --profile hexstrike up --build  # add the HexStrike MCP server
```

- Frontend: `http://localhost:5173` · Backend: `http://localhost:3001`
- HexStrike (optional): `http://localhost:8888` · Neo4j: `http://localhost:9474`, `bolt://localhost:9687`

---

## 🛠️ Technology Stack

**Frontend** — React 18 + TypeScript, Vite, TailwindCSS, shadcn/ui, React Query.
**Backend** — Express + TypeScript, SQLite (better-sqlite3), Neo4j (`neo4j-driver`), JWT auth, Server-Sent Events for live streaming.
**AI / orchestration** — multi-provider LLM gateway (OpenAI, Anthropic, Groq, Gemini, Ollama, OpenAI-compatible), RAG engine, phased prompt templates, deterministic validation layer.
**Security tooling** — HexStrike MCP server (Python) over the Model Context Protocol, with built-in HTTP/network/crypto/file tools.

The split is deliberate: **Neo4j for relationships** (attack chains, technique graphs) and **SQLite for records** (runs, experiences, signals); **TypeScript** for the I/O-bound orchestrator and **Python** where the security libraries live.

---

## 🔐 Security Features

- JWT authentication and bcrypt password hashing
- Command whitelisting per category + input/URL sanitization
- Full shell-command audit logging
- Output caps and per-tool timeouts
- API rate limiting and controlled CORS

---

## 📚 Documentation

- **[MCP Integration Guide](MCP_INTEGRATION_GUIDE.md)** — HexStrike setup and tool routing
- **[Orchestration notes](ORCHESTRATION_IMPROVEMENTS.md)** — routing, context injection, security controls
- **[Iteration attack tree](redbox-ops-core/docs/ITERATION_ATTACK_TREE.md)** — hardening the agent loop
- **[Rate-limiting design](redbox-ops-core/docs/RATE_LIMITING_SOLUTION.md)** — circuit breaker & provider switching

---

## 📝 License

Licensed under the MIT License — see [LICENSE](LICENSE).

---

<div align="center">
  <sub>Developed by H3DD4</sub>
</div>
