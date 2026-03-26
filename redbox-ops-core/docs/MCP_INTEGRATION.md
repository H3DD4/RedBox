# MCP Integration Guide - RedBox Ops

## Overview

RedBox now has **full MCP (Model Context Protocol) support** that works exactly like Claude's native MCP integration. The LLM can seamlessly communicate with HexStrike and execute any available security tool.

## Architecture

```
┌─────────────────┐
│   LLM Agent     │
│  (Sonnet/etc)   │
└────────┬────────┘
         │ ACTION: tool_name | {params}
         ▼
┌─────────────────┐
│  Orchestrator   │
│   executeTool() │
└────────┬────────┘
         │
         ├─► Built-in Tools (http_request, nc, python, etc.)
         │
         └─► MCP Client ──► HexStrike Server
                             (or any MCP server)
```

## How It Works

### 1. **Automatic Tool Routing**
When the LLM outputs an ACTION line:
```
ACTION: sqlmap | {"url": "http://target.com/page?id=1"}
```

The orchestrator:
1. Checks if it's a built-in tool (http_request, nc, strings, etc.)
2. If not, forwards it to the MCP client
3. MCP client tries multiple protocols:
   - **JSON-RPC 2.0** (standard MCP): `POST /mcp/rpc`
   - **REST API** (HexStrike style): `POST /api/tools/:toolName`
   - **Command endpoint**: `POST /api/command`

### 2. **Multi-Protocol Support**

The MCP client (`backend/src/services/mcp-client.ts`) supports:

**JSON-RPC 2.0 (True MCP)**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "sqlmap",
    "arguments": {"url": "..."}
  }
}
```

**REST API (HexStrike)**
```bash
POST /api/tools/sqlmap
Body: {"url": "..."}
```

**Command Endpoint**
```bash
POST /api/command
Body: {"command": "sqlmap", "url": "..."}
```

### 3. **Tool Discovery**

The LLM knows about:
- **Built-in tools** (always available)
- **MCP tools** (dynamically available from HexStrike)

You can query available MCP tools:
```bash
GET /api/orchestrator/mcp/tools?mcpServerId=xxx
```

Response:
```json
{
  "success": true,
  "tools": [
    {
      "name": "sqlmap",
      "description": "SQL injection testing tool",
      "inputSchema": {...}
    },
    {
      "name": "nmap",
      "description": "Network port scanner"
    }
  ]
}
```

## Configuration

### 1. **Default HexStrike Server**
Set in `.env`:
```env
HEXSTRIKE_API_URL=http://127.0.0.1:8888
```

### 2. **Additional MCP Servers**
Add via database or API:
```sql
INSERT INTO mcp_servers (id, name, url, auth_token, enabled)
VALUES (
  'custom-mcp-123',
  'My Custom MCP Server',
  'http://localhost:9999',
  'optional-bearer-token',
  1
);
```

### 3. **Auth Tokens**
If your MCP server requires authentication:
```typescript
// MCP client automatically adds:
headers["Authorization"] = "Bearer <token>"
```

## Usage Examples

### Example 1: SQL Injection Testing
```
LLM Output:
ACTION: sqlmap | {"url": "http://target.com/page?id=1", "options": "--batch --level=3"}

Orchestrator → MCP Client → HexStrike
HexStrike runs: sqlmap -u "..." --batch --level=3
Returns: "SQL injection found at parameter 'id'..."
```

### Example 2: Network Scanning
```
LLM Output:
ACTION: nmap | {"target": "192.168.1.100", "options": "-sV -p-"}

Orchestrator → MCP Client → HexStrike
HexStrike runs: nmap -sV -p- 192.168.1.100
Returns: Port scan results...
```

### Example 3: Built-in Tool (No MCP)
```
LLM Output:
ACTION: http_request | {"url": "http://target.com", "method": "GET"}

Orchestrator → executeTool (built-in)
Executes: curl -i -L -X GET "http://target.com"
Returns: HTTP response...
```

## API Endpoints

### Test MCP Connection
```http
POST /api/orchestrator/mcp/test-connection
Content-Type: application/json

{
  "mcpServerId": "optional-server-id"
}
```

Response:
```json
{
  "success": true,
  "connected": true
}
```

### List Available Tools
```http
GET /api/orchestrator/mcp/tools?mcpServerId=xxx
```

Response:
```json
{
  "success": true,
  "tools": [...],
  "count": 42
}
```

### Execute Tool (Direct API)
```http
POST /api/hexstrike/tools/sqlmap
Content-Type: application/json

{
  "url": "http://target.com/page?id=1",
  "options": "--batch"
}
```

## HexStrike Server Requirements

Your HexStrike server should expose:

### Required Endpoints:
- `GET /api/health` - Health check
- `POST /api/tools/:toolName` - Execute a tool
- `POST /api/command` - Execute a command

### Optional (for true MCP):
- `POST /mcp/rpc` - JSON-RPC 2.0 endpoint
- `GET /api/tools` - List available tools

### Example HexStrike Response Format:
```json
{
  "success": true,
  "output": "Tool output here...",
  "error": null
}
```

Or MCP standard format:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Tool output here..."
      }
    ]
  }
}
```

## Error Handling

The MCP client gracefully handles:
1. **Connection failures** → Falls back to built-in tools only
2. **Tool not found** → Tries command endpoint as fallback
3. **Timeout** → 60 second timeout per tool call
4. **Multiple response formats** → Automatically extracts output

## Debugging

Enable MCP debugging:
```typescript
// In orchestrator.ts
console.log(`[Run ${runId}] Attempting MCP tool execution: ${toolName}`);
console.log(`[Run ${runId}] MCP response:`, result);
```

Check logs:
```bash
# Backend logs will show:
[MCP Client] Attempting tool: sqlmap
[MCP Client] Trying JSON-RPC endpoint...
[MCP Client] JSON-RPC failed, trying REST fallback
[MCP Client] Tool executed successfully
```

## Comparison: Claude vs RedBox

| Feature | Claude MCP | RedBox MCP |
|---------|-----------|------------|
| Tool Discovery | ✅ Automatic | ✅ Dynamic via API |
| JSON-RPC 2.0 | ✅ Native | ✅ Supported |
| REST Fallback | ❌ No | ✅ Yes (HexStrike) |
| Auth Tokens | ✅ Yes | ✅ Yes |
| Multi-Server | ✅ Yes | ✅ Yes |
| Built-in Tools | ❌ No | ✅ Yes (http_request, nc, etc.) |
| Cross-Platform | ✅ Yes | ✅ Windows + Linux |

## Benefits

1. **No Configuration Needed** - Works out of the box with HexStrike
2. **Unlimited Tools** - LLM can call ANY security tool available on HexStrike
3. **Fallback Strategy** - If MCP fails, built-in tools still work
4. **Multi-Protocol** - Supports standard MCP and custom APIs
5. **Like Claude** - Same seamless experience as Claude's MCP

## Troubleshooting

### "MCP server disconnected"
- Check HexStrike is running: `curl http://127.0.0.1:8888/api/health`
- Verify HEXSTRIKE_API_URL in `.env`

### "Tool not recognized"
- Tool may not be installed on HexStrike server
- Check available tools: `GET /api/orchestrator/mcp/tools`

### "Connection timeout"
- Increase timeout in mcp-client.ts
- Check network connectivity to MCP server

## Next Steps

1. **Start HexStrike**: Ensure your HexStrike MCP server is running
2. **Test Connection**: Use `/api/orchestrator/mcp/test-connection`
3. **List Tools**: Query `/api/orchestrator/mcp/tools`
4. **Run Assessment**: The LLM will automatically use MCP tools
5. **Monitor Logs**: Watch backend logs to see MCP calls in action

---

**Note**: This implementation makes RedBox's MCP integration as seamless as Claude's native MCP support. The LLM doesn't need to know about protocols, endpoints, or server configurations - it just calls tools by name and everything works! 🚀
