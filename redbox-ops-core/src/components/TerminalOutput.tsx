import { cn } from "@/lib/utils";

interface TerminalLine {
  type: "input" | "output" | "error" | "info" | "system";
  content: string;
  timestamp?: string;
}

const lineStyles: Record<TerminalLine["type"], string> = {
  input: "text-foreground",
  output: "text-terminal",
  error: "text-primary",
  info: "text-info",
  system: "text-muted-foreground italic",
};

const prefixes: Record<TerminalLine["type"], string> = {
  input: "$ ",
  output: "→ ",
  error: "✗ ",
  info: "ℹ ",
  system: "# ",
};

interface TerminalOutputProps {
  lines: TerminalLine[];
  className?: string;
}

const TerminalOutput = ({ lines, className }: TerminalOutputProps) => (
  <div className={cn("bg-muted rounded-md border border-border p-4 font-mono text-sm overflow-auto", className)}>
    {lines.length === 0 && (
      <div className="text-muted-foreground text-xs">Waiting for input...</div>
    )}
    {lines.map((line, i) => (
      <div key={i} className={cn("py-0.5 flex gap-2", lineStyles[line.type])}>
        {line.timestamp && (
          <span className="text-muted-foreground text-[10px] shrink-0 pt-0.5">{line.timestamp}</span>
        )}
        <span className="text-muted-foreground shrink-0">{prefixes[line.type]}</span>
        <span className="whitespace-pre-wrap">{line.content}</span>
      </div>
    ))}
    <div className="terminal-cursor text-xs mt-1" />
  </div>
);

export { TerminalOutput, type TerminalLine };
