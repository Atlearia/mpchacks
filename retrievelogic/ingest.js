/**
 * Ingest Brim Expense Policy.pdf into policy_chunks with gemini-embedding-001 (3072 dims).
 * Run from project root: node rag-ingest.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { GoogleGenAI } from "@google/genai";
import pdf from "pdf-parse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "backend", ".env") });

const MONGODB_URI = process.env.MONGODB_URL || process.env.MONGODB_URI;
const DB_NAME = process.env.DATABASE_NAME || "test";
const COLLECTION_NAME = process.env.POLICY_COLLECTION || "policy_chunks";
const POLICY_PDF_NAME = process.env.POLICY_PDF_NAME || "Brim Expense Policy.pdf";
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS || 3072);
const MIN_CHUNK = 700;
const MAX_CHUNK = 1200;

const PDF_CANDIDATES = [
  path.join(__dirname, "backend", "app", "data", POLICY_PDF_NAME),
  path.join(__dirname, "backend", POLICY_PDF_NAME),
  path.join(__dirname, POLICY_PDF_NAME),
  path.join(__dirname, "docs", POLICY_PDF_NAME),
];

function findPdf() {
  for (const p of PDF_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Place ${POLICY_PDF_NAME} in backend/app/data/ or project root. Tried:\n${PDF_CANDIDATES.join("\n")}`);
}

function splitChunks(text) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= MAX_CHUNK) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    let rest = para;
    while (rest.length > MAX_CHUNK) {
      chunks.push(rest.slice(0, MAX_CHUNK));
      rest = rest.slice(MAX_CHUNK);
    }
    current = rest;
  }
  if (current) chunks.push(current);
  return chunks.filter((c) => c.length >= 80);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const client = new MongoClient(MONGODB_URI);
await client.connect();
const collection = client.db(DB_NAME).collection(COLLECTION_NAME);

async function embed(text) {
  const result = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
  });
  const values = result.embeddings[0].values;
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Expected ${EMBEDDING_DIMENSIONS} dims, got ${values.length}`);
  }
  return values;
}

const pdfPath = findPdf();
const buffer = fs.readFileSync(pdfPath);
const parsed = await pdf(buffer);
const text = parsed.text?.trim();
if (!text) throw new Error("No text extracted from PDF");

const pieces = splitChunks(text);
const now = new Date().toISOString();
const docs = [];

for (let i = 0; i < pieces.length; i++) {
  const piece = pieces[i];
  const chunk_id = `chunk_${crypto.createHash("sha256").update(`${pdfPath}:${i}`).digest("hex").slice(0, 12)}`;
  process.stdout.write(`Embedding ${i + 1}/${pieces.length}...\r`);
  const embedding = await embed(piece);
  docs.push({
    chunk_id,
    source_file: path.basename(pdfPath),
    section_title: "General Policy",
    chunk_index: i,
    text: piece,
    embedding,
    metadata: { char_count: piece.length },
    created_at: now,
    updated_at: now,
  });
}

await collection.deleteMany({ source_file: path.basename(pdfPath) });
if (docs.length) await collection.insertMany(docs);
await collection.createIndex({ chunk_id: 1 }, { unique: true });

console.log(`\nIngested ${docs.length} chunks into ${DB_NAME}.${COLLECTION_NAME}`);
console.log(`Embedding model: ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS} dimensions)`);
console.log(`Create Atlas vector index '${process.env.POLICY_VECTOR_INDEX || "policy_vector_index"}' on path 'embedding'.`);

await client.close();