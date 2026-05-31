// Vercel Serverless Function — proxies Gemini API calls so the API key
// stays server-side (read from GEMINI_API_KEY env var on Vercel).

const GEMINI_MODEL = "gemini-2.5-flash";

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[api/gemini] GEMINI_API_KEY is not set in environment");
    return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
  }

  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  try {
    const { contents, generationConfig } = req.body;

    if (!contents || !Array.isArray(contents)) {
      return res.status(400).json({ error: "Missing or invalid 'contents' in request body" });
    }

    const geminiRes = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents, generationConfig }),
    });

    const geminiData = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error("[api/gemini] Gemini API error:", geminiRes.status, JSON.stringify(geminiData).slice(0, 500));
      return res.status(geminiRes.status).json(geminiData);
    }

    return res.status(200).json(geminiData);
  } catch (err) {
    console.error("[api/gemini] Proxy error:", err);
    return res.status(500).json({ error: "Internal server error proxying to Gemini" });
  }
}
