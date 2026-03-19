import { useState, useRef, useEffect } from "react";
import {
  Brain, Send, Database, ChevronRight, MessageSquare,
  Upload, Trash2, RefreshCw, FileText, Loader2,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { rag, type RagDocument, type RagSource } from "@/services/api-client";
import { useToast } from "@/hooks/use-toast";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: RagSource[];
  loading?: boolean;
}

const RAGAdvisor = () => {
  const { toast } = useToast();
  const [messages,    setMessages]    = useState<Message[]>([]);
  const [input,       setInput]       = useState("");
  const [showSources, setShowSources] = useState(true);
  const [isQuerying,  setIsQuerying]  = useState(false);
  const [documents,   setDocuments]   = useState<RagDocument[]>([]);
  const [stats,       setStats]       = useState<{ documentCount: number; chunkCount: number; indexStatus: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef       = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const loadData = () => {
    rag.listDocuments().then(({ documents: d }) => setDocuments(d)).catch(() => {});
    rag.stats().then((s) => setStats(s)).catch(() => {});
  };

  useEffect(() => { loadData(); }, []);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    for (const file of Array.from(files)) {
      try {
        await rag.uploadDocument(file);
        toast({ title: "Document indexed", description: file.name });
      } catch (err) {
        toast({ title: "Upload failed", description: `${file.name}: ${(err as {error?:string}).error || "error"}`, variant: "destructive" });
      }
    }
    setIsUploading(false);
    loadData();
  };

  const handleDelete = async (id: string, name: string) => {
    try {
      await rag.deleteDocument(id);
      toast({ title: "Removed", description: name });
      loadData();
    } catch (err) {
      toast({ title: "Delete failed", description: (err as {error?:string}).error || "error", variant: "destructive" });
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isQuerying) return;
    const question = input.trim();
    setInput("");
    setMessages((m) => [...m, { role: "user", content: question }]);
    setIsQuerying(true);
    setMessages((m) => [...m, { role: "assistant", content: "", loading: true }]);

    try {
      const res = await rag.query(question);
      setMessages((m) => {
        const updated = [...m];
        updated[updated.length - 1] = {
          role: "assistant",
          content: res.answer,
          sources: res.sources,
          loading: false,
        };
        return updated;
      });
    } catch (err) {
      setMessages((m) => {
        const updated = [...m];
        updated[updated.length - 1] = {
          role: "assistant",
          content: `Error: ${(err as {error?:string}).error || "Query failed. Ensure documents are indexed and a LLM provider is active."}`,
          loading: false,
        };
        return updated;
      });
    } finally {
      setIsQuerying(false);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6 animate-slide-up h-[calc(100vh-8rem)] flex flex-col">
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-2xl font-mono font-bold uppercase tracking-[0.15em] text-zinc-100 flex items-center gap-2">
              <Brain className="w-6 h-6 text-red-500" /> // RAG Security Advisor
            </h1>
            <p className="text-xs font-mono text-zinc-400 mt-1">AI-powered security knowledge retrieval</p>
          </div>
          <button
            onClick={() => setShowSources(!showSources)}
            className="flex items-center gap-1 text-sm font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <Database className="w-4 h-4" />
            Knowledge Sources {stats ? `(${stats.documentCount})` : ""}
            <ChevronRight className={`w-4 h-4 transition-transform ${showSources ? "rotate-90" : ""}`} />
          </button>
        </div>

        <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
          {/* Chat */}
          <div className="flex-1 bg-zinc-900/80 border border-zinc-700/50 rounded-lg flex flex-col overflow-hidden">
            <div className="flex-1 overflow-auto p-6 space-y-6">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-zinc-500 font-mono gap-3">
                  <MessageSquare className="w-10 h-10 opacity-25" />
                  <p className="text-sm">Ask questions about your security knowledge base.</p>
                  {stats && stats.documentCount === 0 && (
                    <p className="text-xs text-center">
                      No documents indexed yet — upload documents in the Knowledge Sources panel.
                    </p>
                  )}
                  {stats && stats.documentCount > 0 && (
                    <p className="text-xs opacity-60">
                      {stats.documentCount} document{stats.documentCount !== 1 ? "s" : ""} · {stats.chunkCount} chunks indexed
                    </p>
                  )}
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-lg px-4 py-3 text-sm ${
                    msg.role === "user"
                      ? "bg-red-500/10 text-zinc-100 font-mono border border-red-500/20"
                      : "bg-zinc-800/80 text-zinc-200 font-mono border border-zinc-700"
                  }`}>
                    {msg.loading ? (
                      <div className="flex items-center gap-2 text-zinc-500 font-mono">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span className="text-xs">Searching knowledge base...</span>
                      </div>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-zinc-700">
                            <p className="text-[10px] text-red-400/70 font-mono uppercase tracking-wider mb-2">Sources</p>
                            <div className="space-y-1">
                              {msg.sources.map((s, si) => (
                                <div key={si} className="flex items-start gap-2 text-[11px] font-mono">
                                  <span className="bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded font-mono shrink-0">{s.name}</span>
                                  <span className="text-zinc-500 truncate">{s.chunk}</span>
                                  <span className="shrink-0 font-mono text-red-400">{(s.score * 100).toFixed(0)}%</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>

            <form onSubmit={handleSend} className="border-t border-zinc-700/50 p-4 flex gap-2 shrink-0">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about CVEs, techniques, mitigations..."
                disabled={isQuerying}
                className="flex-1 bg-zinc-800/80 border border-zinc-700 rounded-md px-4 py-2.5 text-sm text-zinc-100 font-mono placeholder:text-zinc-500 outline-none focus:border-red-500/30 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isQuerying}
                className="bg-red-600 text-white px-4 py-2.5 rounded-md hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                {isQuerying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </form>
          </div>

          {/* Sources Panel */}
          {showSources && (
            <div className="w-72 bg-zinc-900/80 border border-zinc-700/50 rounded-lg flex flex-col overflow-hidden animate-slide-up shrink-0">
              <div className="p-4 border-b border-zinc-700/50 flex items-center justify-between">
                <h3 className="text-xs font-mono uppercase tracking-[0.15em] text-zinc-200">// Knowledge Sources</h3>
                <div className="flex gap-2">
                  <button
                    onClick={loadData}
                    className="text-zinc-500 hover:text-zinc-200 transition-colors"
                    title="Refresh"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-zinc-500 hover:text-red-400 transition-colors"
                    title="Upload document"
                  >
                    {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".txt,.md,.pdf,.json,.csv"
                    className="hidden"
                    onChange={(e) => handleUpload(e.target.files)}
                  />
                </div>
              </div>

              {/* Stats bar */}
              {stats && (
                <div className="px-4 py-2 bg-zinc-800/50 border-b border-zinc-700/50 text-[10px] font-mono text-zinc-400 flex gap-4">
                  <span>{stats.documentCount} docs</span>
                  <span>{stats.chunkCount} chunks</span>
                  <span className={stats.indexStatus === "ready" ? "text-red-400" : "text-zinc-500"}>
                    {stats.indexStatus}
                  </span>
                </div>
              )}

              <div className="flex-1 overflow-auto p-3 space-y-2">
                {documents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-zinc-500 font-mono gap-2">
                    <Database className="w-6 h-6 opacity-30" />
                    <p className="text-xs text-center">
                      No documents indexed.<br />
                      Upload PDFs, markdown, or text files.
                    </p>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-2 flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                    >
                      <Upload className="w-3 h-3" /> Upload document
                    </button>
                  </div>
                ) : (
                  documents.map((doc) => (
                    <div key={doc.id} className="flex items-start gap-2 p-2.5 rounded-md bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300 font-mono transition-colors group">
                      <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-zinc-200 truncate font-medium">{doc.name}</p>
                        <p className="text-[10px] text-zinc-500 font-mono">
                          {doc.chunk_count} chunks · {doc.status}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDelete(doc.id, doc.name)}
                        className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-400 transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="p-3 border-t border-zinc-700/50">
                <div
                  className="border border-dashed border-zinc-700 rounded-md p-3 text-center cursor-pointer hover:border-red-500/30 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); handleUpload(e.dataTransfer.files); }}
                >
                  <Upload className="w-4 h-4 text-zinc-500 mx-auto mb-1" />
                  <p className="text-[10px] text-zinc-500 font-mono">Drop PDF, TXT, MD files</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default RAGAdvisor;
