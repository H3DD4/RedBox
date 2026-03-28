import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { getDb } from "../db.js";
import { getActiveProvider } from "./llm-gateway.js";

// Simple TF-IDF based embedding as fallback
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t.length > 2);
}

// Build vocabulary from all chunks  
let vocabulary: string[] = [];
let idfMap: Map<string, number> = new Map();

function buildVocabulary() {
  const db = getDb();
  const chunks = db.prepare("SELECT content FROM rag_chunks").all() as { content: string }[];
  
  const docFreq = new Map<string, number>();
  const allTokens = new Set<string>();
  
  for (const chunk of chunks) {
    const tokens = new Set(tokenize(chunk.content));
    for (const t of tokens) {
      allTokens.add(t);
      docFreq.set(t, (docFreq.get(t) || 0) + 1);
    }
  }
  
  vocabulary = Array.from(allTokens).slice(0, 5000); // Limit vocab size
  idfMap = new Map();
  const N = chunks.length || 1;
  for (const term of vocabulary) {
    idfMap.set(term, Math.log(N / (1 + (docFreq.get(term) || 0))));
  }
}

function tfidfEmbed(text: string): number[] {
  const tokens = tokenize(text);
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  
  return vocabulary.map(term => {
    const termFreq = (tf.get(term) || 0) / (tokens.length || 1);
    const idf = idfMap.get(term) || 0;
    return termFreq * idf;
  });
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// Try to get embeddings from the active LLM provider
async function getEmbedding(text: string): Promise<number[] | null> {
  const provider = getActiveProvider();
  if (!provider) return null;
  
  try {
    if (provider.type === "ollama") {
      const resp = await fetch(`${provider.endpoint}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: provider.model, prompt: text }),
      });
      if (resp.ok) {
        const data = await resp.json() as { embedding?: number[] };
        return data.embedding || null;
      }
    } else if (provider.type === "openai" || provider.type === "custom") {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (provider.api_key) headers["Authorization"] = `Bearer ${provider.api_key}`;
      const baseUrl = provider.endpoint.replace(/\/+$/, "");
      const resp = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
      });
      if (resp.ok) {
        const data = await resp.json() as { data?: { embedding: number[] }[] };
        return data.data?.[0]?.embedding || null;
      }
    }
  } catch {
    // Fall through to TF-IDF
  }
  return null;
}

// Chunk text into overlapping segments
function chunkText(text: string, chunkSize = 512, overlap = 64): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(" ");
    if (chunk.trim()) chunks.push(chunk.trim());
    if (i + chunkSize >= words.length) break;
  }
  
  return chunks.length > 0 ? chunks : [text.trim()];
}

// Ingest a document
export async function ingestDocument(
  name: string,
  originalName: string,
  content: string,
  mimeType: string,
  size: number
): Promise<{ id: string; chunkCount: number }> {
  const db = getDb();
  const docId = uuidv4();
  
  db.prepare(
    "INSERT INTO rag_documents (id, name, original_name, mime_type, size, status) VALUES (?, ?, ?, ?, ?, 'indexing')"
  ).run(docId, name, originalName, mimeType, size);
  
  const chunks = chunkText(content);
  
  const insertChunk = db.prepare(
    "INSERT INTO rag_chunks (id, document_id, content, embedding, chunk_index) VALUES (?, ?, ?, ?, ?)"
  );
  
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await getEmbedding(chunks[i]);
    insertChunk.run(uuidv4(), docId, chunks[i], embedding ? JSON.stringify(embedding) : null, i);
  }
  
  db.prepare("UPDATE rag_documents SET chunk_count = ?, status = 'indexed' WHERE id = ?")
    .run(chunks.length, docId);
  
  // Rebuild TF-IDF vocabulary
  buildVocabulary();
  
  return { id: docId, chunkCount: chunks.length };
}

// Query the RAG index
export async function queryRAG(
  question: string,
  topK = 5
): Promise<{ answer: string; sources: { name: string; chunk: string; score: number }[] }> {
  const db = getDb();
  
  // Get all chunks
  const chunks = db.prepare(`
    SELECT c.id, c.content, c.embedding, c.document_id, d.name as doc_name
    FROM rag_chunks c JOIN rag_documents d ON c.document_id = d.id
    WHERE d.status = 'indexed'
  `).all() as { id: string; content: string; embedding: string | null; document_id: string; doc_name: string }[];
  
  if (chunks.length === 0) {
    return { answer: "No documents have been indexed yet. Upload documents to the knowledge base first.", sources: [] };
  }
  
  // Try to get query embedding from provider
  const queryEmbedding = await getEmbedding(question);
  
  // Score each chunk
  const scored = chunks.map(chunk => {
    let score = 0;
    
    if (queryEmbedding && chunk.embedding) {
      try {
        const chunkEmbed = JSON.parse(chunk.embedding) as number[];
        score = cosineSimilarity(queryEmbedding, chunkEmbed);
      } catch {
        score = 0;
      }
    }
    
    // If no provider embeddings, use TF-IDF
    if (score === 0) {
      if (vocabulary.length === 0) buildVocabulary();
      const qEmbed = tfidfEmbed(question);
      const cEmbed = tfidfEmbed(chunk.content);
      score = cosineSimilarity(qEmbed, cEmbed);
    }
    
    return { ...chunk, score };
  });
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  const topChunks = scored.slice(0, topK);
  
  // Build context for LLM
  const context = topChunks.map((c, i) => `[Source ${i + 1}: ${c.doc_name}]\n${c.content}`).join("\n\n---\n\n");
  
  // Generate answer using LLM
  const provider = getActiveProvider();
  let answer: string;
  
  if (provider) {
  try {
    const { chat: llmChat } = await import("./llm-gateway.js");
    const trimmedContext = topChunks
      .map((c, i) => `[Source ${i + 1}: ${c.doc_name}]\n${c.content.slice(0, 800)}`)
      .join("\n\n---\n\n");
    const result = await llmChat([
      { role: "system", content: "You are a security knowledge assistant. Answer questions based on the provided context. Always cite your sources. If the context doesn't contain relevant information, say so." },
      { role: "user", content: `Context:\n${trimmedContext}\n\nQuestion: ${question}` },
    ]);
    answer = result.content;
  } catch (err: any) {
    // LLM unavailable (rate limit, network, etc.) — fall back to extractive answer
    answer = `⚠️ LLM unavailable (${err?.message?.includes("RATE_LIMIT") ? "rate limit hit" : "provider error"}).\n\nMost relevant excerpts:\n\n${
      topChunks.map((c, i) =>
        `**[${c.doc_name}]** (relevance: ${(c.score * 100).toFixed(1)}%)\n${c.content.slice(0, 300)}...`
      ).join("\n\n")
    }`;
  }
} else {
  answer = `Based on the indexed documents, here are the most relevant excerpts:\n\n${
    topChunks.map((c, i) =>
      `**[${c.doc_name}]** (relevance: ${(c.score * 100).toFixed(1)}%)\n${c.content.slice(0, 300)}...`
    ).join("\n\n")
  }`;
}
  
  const sources = topChunks.map(c => ({
    name: c.doc_name,
    chunk: c.content.slice(0, 200),
    score: Math.round(c.score * 1000) / 1000,
  }));
  
  return { answer, sources };
}

export function getRAGStats() {
  const db = getDb();
  const docs = db.prepare("SELECT COUNT(*) as count FROM rag_documents WHERE status = 'indexed'").get() as { count: number };
  const chunks = db.prepare("SELECT COUNT(*) as count FROM rag_chunks").get() as { count: number };
  const totalSize = db.prepare("SELECT COALESCE(SUM(size), 0) as total FROM rag_documents").get() as { total: number };
  
  return {
    documentCount: docs.count,
    chunkCount: chunks.count,
    totalSize: totalSize.total,
    indexStatus: docs.count > 0 ? "ready" : "empty",
  };
}

export function listDocuments() {
  const db = getDb();
  return db.prepare("SELECT id, name, original_name, mime_type, size, chunk_count, status, created_at FROM rag_documents ORDER BY created_at DESC").all();
}

export function deleteDocument(docId: string) {
  const db = getDb();
  db.prepare("DELETE FROM rag_chunks WHERE document_id = ?").run(docId);
  db.prepare("DELETE FROM rag_documents WHERE id = ?").run(docId);
  buildVocabulary();
}

// Initialize vocabulary on module load
try { buildVocabulary(); } catch { /* DB might not exist yet */ }
