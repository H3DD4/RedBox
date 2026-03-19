# 🔴 RedBox - AI-Powered Security Orchestration Platform

<div align="center">
  <img src="redbox-ops-core/pic_assets/RedBox-removebg-preview.png" alt="RedBox Logo" width="200"/>

  **Next-Generation Security Testing Platform powered by AI**

  [![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
  [![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://reactjs.org/)
  [![Node.js](https://img.shields.io/badge/Node.js-43853D?logo=node.js&logoColor=white)](https://nodejs.org/)
  [![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white)](https://www.python.org/)
</div>

---

## 📖 Overview

**RedBox** is a comprehensive AI-powered security testing orchestration platform that combines multiple LLM providers with advanced penetration testing capabilities. It provides a unified interface for security assessments, knowledge management, and automated testing workflows.

### 🎯 Key Features

- **🤖 AI Orchestrator**: Multi-stage security assessment pipelines with LLM-powered analysis
- **💻 AI Terminal**: Interactive security assistant with real-time streaming responses
- **📚 RAG Advisor**: Query your security knowledge base with AI-enhanced retrieval
- **🔌 MCP Integration**: HexStrike Model Context Protocol for actual security tool execution
- **📊 Report Generation**: Automated executive, technical, and full security reports
- **🔄 Multi-LLM Support**: Ollama, OpenAI, Anthropic Claude, Google Gemini, and custom endpoints

---

## 🏗️ Architecture

```
RedBox/
├── redbox-ops-core/          # Main application
│   ├── backend/              # Express + TypeScript backend
│   │   ├── src/
│   │   │   ├── routes/       # API endpoints
│   │   │   ├── services/     # Core services (LLM, RAG, Orchestrator)
│   │   │   └── db.ts         # SQLite database
│   │   └── prompts/          # Security testing templates
│   └── src/                  # React + TypeScript frontend
│       ├── components/       # UI components
│       ├── pages/            # Application pages
│       ├── context/          # State management
│       └── services/         # API clients
└── hexstrike/                # MCP server for security tools
    └── hexstrike-ai/         # Python-based tool execution server
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.8+ (for HexStrike MCP server)
- **Ollama** (optional - for local LLM) or API keys for cloud LLMs

### Installation

#### 1. Clone the Repository

```bash
git clone https://github.com/H3DD4/RedBox.git
cd RedBox
```

#### 2. Setup Frontend & Backend

```bash
cd redbox-ops-core

# Install frontend dependencies
npm install

# Install backend dependencies
cd backend
npm install
cd ..
```

#### 3. Configure Environment

```bash
# Frontend
cp .env.example .env

# Backend
cp backend/.env.example backend/.env
```

Edit `.env` files with your configuration:
- Database path
- API ports
- LLM provider endpoints

#### 4. Setup HexStrike MCP Server (Optional)

```bash
cd ../hexstrike/hexstrike-ai

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

#### 5. Start the Platform

**Terminal 1 - Backend:**
```bash
cd redbox-ops-core/backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd redbox-ops-core
npm run dev
```

**Terminal 3 - HexStrike MCP (Optional):**
```bash
cd hexstrike/hexstrike-ai
python hexstrike_server.py
```

#### 6. Access RedBox

Open your browser and navigate to:
```
http://localhost:5173
```

**Default Login:**
- Email: `admin@redbox.io`
- Password: `redbox`

---

## 💡 Usage

### 1. **Configure LLM Provider**
- Navigate to **Settings** → **LLM Providers**
- Add your preferred provider (Ollama, OpenAI, Claude, etc.)
- Test connection and set as active

### 2. **Run Security Assessment**
- Go to **Orchestrator**
- Select pipeline (CTF Solving, Pentest, etc.)
- Enter target and test parameters
- Watch real-time AI analysis

### 3. **Query Knowledge Base**
- Upload security documents in **RAG Advisor**
- Ask questions about your knowledge base
- Get AI-powered answers with sources

### 4. **Interactive Terminal**
- Use **AI Terminal** for ad-hoc security queries
- Stream responses in real-time
- Execute security analysis on-the-fly

---

## 🛠️ Technology Stack

### Frontend
- **React 18** with TypeScript
- **Vite** for blazing-fast builds
- **TailwindCSS** for styling
- **shadcn/ui** component library
- **React Query** for state management

### Backend
- **Express.js** with TypeScript
- **SQLite** with better-sqlite3
- **JWT** authentication
- **Server-Sent Events (SSE)** for streaming
- **Multer** for file uploads

### AI/ML
- **Multiple LLM Providers**: OpenAI, Anthropic, Gemini, Ollama
- **RAG Engine**: TF-IDF + Provider embeddings
- **Streaming Chat**: Real-time response streaming
- **Prompt Templates**: Structured security testing workflows

### Security Tools
- **HexStrike MCP Server**: Python-based tool execution
- **Model Context Protocol**: Standardized AI-tool communication

---

## 📁 Project Structure

```
redbox-ops-core/
├── backend/
│   ├── src/
│   │   ├── routes/           # API endpoints
│   │   │   ├── auth.ts       # Authentication
│   │   │   ├── orchestrator.ts  # Pipeline execution
│   │   │   ├── rag.ts        # RAG queries
│   │   │   ├── llm-providers.ts  # LLM management
│   │   │   └── ...
│   │   ├── services/
│   │   │   ├── orchestrator.ts   # Core orchestration logic
│   │   │   ├── rag-engine.ts     # RAG implementation
│   │   │   ├── llm-gateway.ts    # Multi-LLM interface
│   │   │   ├── prompt-engine.ts  # Template system
│   │   │   └── report-generator.ts
│   │   ├── db.ts             # Database schema
│   │   └── index.ts          # Server entry point
│   └── prompts/              # Security testing templates
│       ├── ctf-solving/
│       ├── real-pentesting/
│       └── shared/
└── src/
    ├── pages/
    │   ├── Dashboard.tsx     # Overview
    │   ├── Orchestrator.tsx  # Pipeline management
    │   ├── Terminal.tsx      # AI chat
    │   ├── RAGAdvisor.tsx    # Knowledge base
    │   └── SettingsPage.tsx  # Configuration
    ├── components/           # Reusable UI components
    ├── context/              # Global state
    └── services/             # API clients
```

---

## 🔐 Security Features

- **JWT Authentication**: Secure user sessions
- **Password Hashing**: bcrypt with salt
- **Shell Command Audit**: All commands logged
- **Blocklist**: Dangerous commands prevented
- **API Rate Limiting**: Protection against abuse
- **CORS Configuration**: Controlled cross-origin access

---

## 📚 Documentation

- **[MCP Integration Guide](MCP_INTEGRATION_GUIDE.md)**: HexStrike setup and usage
- **[HexStrike README](hexstrike/hexstrike-ai/README.md)**: Tool server documentation
- **Backend API**: RESTful endpoints with SSE streaming
- **Frontend**: Component-based React architecture

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Built with ❤️ using React, TypeScript, and Express
- Powered by multiple LLM providers
- Security tools integration via Model Context Protocol
- UI components from [shadcn/ui](https://ui.shadcn.com/)

---

## 📧 Contact

**Project Link**: [https://github.com/H3DD4/RedBox](https://github.com/H3DD4/RedBox)

---

<div align="center">
  <sub>Built with Claude Opus 4.6</sub>
</div>
