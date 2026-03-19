import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { mcpPoll } from "@/services/mcpPoll";

export interface McpLog {
  level: "info" | "warn" | "error" | "debug";
  message: string;
  timestamp: string;
}

interface McpContextValue {
  isOnline: boolean;
  isChecking: boolean;
  llmOnline: boolean;
  ragIndexed: boolean;
  logs: McpLog[];
  checkNow: () => void;
  clearLogs: () => void;
  addLog: (level: McpLog["level"], message: string) => void;
}

const McpContext = createContext<McpContextValue>({
  isOnline: false,
  isChecking: true,
  llmOnline: false,
  ragIndexed: false,
  logs: [],
  checkNow: () => {},
  clearLogs: () => {},
  addLog: () => {},
});

export const useMcp = () => useContext(McpContext);

const ts = () => new Date().toLocaleTimeString("en-US", { hour12: false });

export const McpProvider = ({ children }: { children: ReactNode }) => {
  const [isOnline, setIsOnline] = useState(() => mcpPoll.getState().online);
  const [isChecking, setIsChecking] = useState(() => mcpPoll.getState().checking);
  const [llmOnline, setLlmOnline] = useState(() => mcpPoll.getState().llmOnline);
  const [ragIndexed, setRagIndexed] = useState(() => mcpPoll.getState().ragIndexed);
  const [logs, setLogs] = useState<McpLog[]>([]);

  const addLog = useCallback((level: McpLog["level"], message: string) => {
    setLogs((l) => [...l.slice(-300), { level, message, timestamp: ts() }]);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);
  const checkNow = useCallback(() => mcpPoll.checkNow(), []);

  useEffect(() => {
    let prevOnline = mcpPoll.getState().online;
    let prevLlm = mcpPoll.getState().llmOnline;

    const unsub = mcpPoll.subscribe(({ online, checking, llmOnline: llm, ragIndexed: rag }) => {
      setIsOnline(online);
      setIsChecking(checking);
      setLlmOnline(llm);
      setRagIndexed(rag);

      if (!checking && online !== prevOnline) {
        prevOnline = online;
        addLog(
          online ? "info" : "error",
          online
            ? "HexStrike MCP Server connected"
            : "HexStrike MCP Server offline"
        );
      }
      if (!checking && llm !== prevLlm) {
        prevLlm = llm;
        addLog(
          llm ? "info" : "warn",
          llm ? "LLM provider online" : "LLM provider unreachable"
        );
      }
    });

    return unsub;
  }, [addLog]);

  return (
    <McpContext.Provider
      value={{ isOnline, isChecking, llmOnline, ragIndexed, logs, checkNow, clearLogs, addLog }}
    >
      {children}
    </McpContext.Provider>
  );
};
