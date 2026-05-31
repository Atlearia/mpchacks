/**
 * Policy RAG (Node) — uses backend/.env and MongoDB Atlas Vector Search.
 *
 * Atlas index definition (Search → JSON Editor):
 * {
 *   "fields": [
 *     {
 *       "type": "vector",
 *       "path": "embedding",
 *       "numDimensions": 3072,
 *       "similarity": "cosine"
 *     }
 *   ]
 * }
 *
 * Run: node rag.js
 * Ingest PDF first: node rag-ingest.js
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env from backend/.env (same as FastAPI)
dotenv.config({ path: path.join(__dirname, "backend", ".env") });

const MONGODB_URI = process.env.MONGODB_URL || process.env.MONGODB_URI;
const DB_NAME = process.env.DATABASE_NAME || process.env.DB_NAME || "test";
const COLLECTION_NAME = process.env.POLICY_COLLECTION || "policy_chunks";
const VECTOR_INDEX = process.env.POLICY_VECTOR_INDEX || "policy_vector_index";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-2.0-flash";
const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS || 3072);

if (!MONGODB_URI) throw new Error("Set MONGODB_URL in backend/.env");
if (!GEMINI_API_KEY) throw new Error("Set GEMINI_API_KEY in backend/.env");

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const client = new MongoClient(MONGODB_URI);
await client.connect();

const collection = client.db(DB_NAME).collection(COLLECTION_NAME);

async function embed(text) {
  const result = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
  });

  const values = result.embeddings?.[0]?.values;
  if (!values?.length) {
    throw new Error("Empty embedding from Gemini");
  }
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding dimension mismatch: got ${values.length}, expected ${EMBEDDING_DIMENSIONS}. ` +
        "Re-ingest policy chunks and ensure Atlas index numDimensions matches."
    );
  }
  return values;
}

async function retrieve(question, limit = 5) {
  const queryEmbedding = await embed(question);

  const results = await collection
    .aggregate([
      {
        $vectorSearch: {
          index: VECTOR_INDEX,
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: 100,
          limit,
        },
      },
      {
        $project: {
          _id: 0,
          chunk_id: 1,
          text: 1,
          section_title: 1,
          source_file: 1,
          chunk_index: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ])
    .toArray();

  return results;
}

export async function askPolicy(question) {
  const chunks = await retrieve(question);

  const context = chunks
    .map((c, i) => {
      const label = c.section_title || c.source_file || `chunk ${i + 1}`;
      return `Source ${i + 1} (${label}):\n${c.text}`;
    })
    .join("\n\n");

  const prompt = `You are an Expense Policy Compliance Assistant.
Only use the policy context below. Never invent policy rules.
If the answer is not in the context, say you do not have sufficient policy context.

Context:
${context || "No policy chunks retrieved."}

Question:
${question}
`;

  const response = await ai.models.generateContent({
    model: CHAT_MODEL,
    contents: prompt,
  });

  return {
    answer: response.text,
    sources: chunks,
  };
}

// CLI demo when run directly: node rag.js "your question?"
const question = process.argv[2] || "What does the policy say about receipts over $50?";
try {
  const result = await askPolicy(question);
  console.log("\n--- Answer ---\n");
  console.log(result.answer);
  console.log("\n--- Sources ---\n");
  console.log(result.sources.map((s) => ({ score: s.score, section: s.section_title, preview: s.text?.slice(0, 120) })));
} finally {
  await client.close();
}