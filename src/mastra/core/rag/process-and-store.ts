import path from "path";
import crypto from "crypto";
import { MDocument } from "@mastra/rag";
import { embedMany } from "ai";

import { vectorStore, INDEX_NAME } from "./vector-store";
import { extractText } from "./ingest-files";
import { getEmbeddingModel } from "../llm/provider";

type ProcessInput = {
  filePath: string;
  docId: string;
  originalName: string;
};

/**
 * Chunks, embeds, and upserts a document into the vector store.
 * Always appends — existing chunks for the same docId are removed first
 * to avoid duplicates on re-upload, but all other documents are untouched.
 */
export async function processAndStore(input: ProcessInput) {
  const { filePath, docId, originalName } = input;

  // 1. Extract text
  const text = await extractText(filePath, originalName);
  if (!text?.trim()) throw new Error("Empty document: nothing to index");

  // 2. Build base metadata
  const metadataBase = {
    filename: originalName,
    createdAt: new Date().toISOString(),
    hash: crypto.createHash("sha256").update(text).digest("hex"),
    docId,
    source: "upload",
  };

  // 3. Remove previous vectors for this docId (idempotent re-index)
  await safeDeleteByDocId(docId);

  // 4. Chunk
  const doc = MDocument.fromText(text);
  const chunks = await doc.chunk({
    strategy: "recursive",
    maxSize: 512,
    overlap: 50,
  });
  if (!chunks.length) throw new Error("Chunking failed: no content generated");

  // 5. Embed
  const { embeddings } = await embedMany({
    model: getEmbeddingModel(),
    values: chunks.map((c) => c.text),
  });

  // 6. Upsert
  await vectorStore.upsert({
    indexName: INDEX_NAME,
    vectors: embeddings,
    metadata: chunks.map((chunk, i) => ({
      ...metadataBase,
      text: chunk.text,
      chunkIndex: i,
      chunkId: chunk.id_,
    })),
  });

  return {
    success: true,
    docId,
    filename: originalName,
    totalChunks: chunks.length,
  };
}

/**
 * Removes all vector chunks belonging to a specific docId.
 * Silently skips if the index does not exist yet.
 */
export async function safeDeleteByDocId(docId: string) {
  try {
    await vectorStore.deleteVectors({
      indexName: INDEX_NAME,
      filter: { docId },
    });
  } catch (err: any) {
    if (!err.message?.includes("does not exist")) throw err;
    console.log(`[RAG] Skipping delete: index not yet created.`);
  }
}
