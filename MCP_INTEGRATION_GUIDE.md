# RedBox + HexStrike MCP Integration

This project connects the RedBox frontend (React/Vite) with the HexStrike AI MCP (Model Context Protocol) server for cybersecurity operations.

## 🚀 Quick Start

### 1. Start HexStrike MCP Server

First, start the HexStrike backend server:

```bash
cd hexstrike\hexstrike-ai

# Activate virtual environment (if using one)
.\hexstrike-venv\Scripts\Activate.ps1

# Start the server
python hexstrike_server.py
```

The server will start on `http://127.0.0.1:8888`

### 2. Start RedBox Frontend

In a new terminal:

```bash
cd redbox-ops-core

# Install dependencies (first time only)
npm install

# Start the development server
npm run dev
```

The frontend will be available at `http://localhost:5173`

### 3. Use the AI Terminal

1. Navigate to the **Terminal** page in the RedBox UI
2. Look for the connection status indicator in the top-right:
   - 🟢 **"HexStrike Connected"** = Server is online and ready
   - 🔴 **"Server Offline"** = Server needs to be started

3. Use the **AI Chat** panel to interact with HexStrike AI:
   - Type security commands or questions
   - Get real-time responses from the AI
   - View MCP logs in real-time

4. Use the **Shell** panel for terminal commands:
   - `help` - Show available commands
   - `status` - Check connection status
   - `health` - Test server connectivity
   - `scan <target>` - Scan a target
   - `analyze <target>` - Analyze a target
   - `clear` - Clear terminal

## 🔧 Configuration

The connection settings are in `.env`:

```env
VITE_HEXSTRIKE_API_URL=http://127.0.0.1:8888
VITE_HEXSTRIKE_API_TIMEOUT=30000
```

You can modify these if your HexStrike server runs on a different host/port.

## 📡 Available API Endpoints

The HexStrike server provides many endpoints:

- `/health` - Health check
- `/api/command` - Execute any command
- `/api/tools/*` - Run specific security tools (nmap, nuclei, etc.)
- `/api/intelligence/*` - AI-powered analysis
- `/api/processes/*` - Process management
- And many more...

See `src/services/hexstrike-api.ts` for the full API client.

## 🐛 Troubleshooting

### "Server Offline" Error

1. Check if HexStrike server is running:
   ```bash
   cd hexstrike\hexstrike-ai
   python hexstrike_server.py
   ```

2. Verify the server URL in `.env` matches where the server is running

3. Check firewall settings - port 8888 must be accessible

### Connection Timeouts

- Increase `VITE_HEXSTRIKE_API_TIMEOUT` in `.env`
- Check network connectivity
- Ensure no antivirus is blocking local connections

### TypeScript Errors

If you see import.meta.env errors:
- Make sure `vite-env.d.ts` includes the environment variable types
- Restart the Vite dev server

## 📂 Project Structure

```
RedBox/
├── hexstrike/
│   └── hexstrike-ai/
│       ├── hexstrike_server.py   # Flask API server
│       ├── hexstrike_mcp.py      # MCP client
│       └── hexstrike-ai-mcp.json # MCP config
│
└── redbox-ops-core/              # Frontend
    ├── .env                      # Environment config
    ├── src/
    │   ├── services/
    │   │   └── hexstrike-api.ts  # API service layer
    │   └── pages/
    │       └── Terminal.tsx      # AI Terminal page
    └── ...
```

## ✨ Features

- ✅ Real-time chat with HexStrike AI
- ✅ Terminal command execution
- ✅ MCP monitoring and logging
- ✅ Connection health checks
- ✅ Error handling and recovery
- ✅ Loading states and user feedback
- ✅ Automatic reconnection attempts

## 🔐 Security Notes

- The MCP server runs locally on 127.0.0.1
- All communication happens on localhost
- No external network access required
- Review command execution carefully before running

## 📝 Next Steps

Now that the basic connection is established, you can:

1. Add more API endpoints to `hexstrike-api.ts`
2. Create dedicated UI components for specific security tools
3. Add result visualization components
4. Implement advanced features like:
   - File upload for analysis
   - Report generation and export
   - Multi-target scanning
   - Automated exploit chains


