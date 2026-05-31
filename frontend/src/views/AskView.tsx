import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { askGemini, answerQuestion, SUGGESTED_PROMPTS, type AiAnswer, type AiFocus, type ChartSpec } from "../data/ai";
import { BarChart, DataTable, DonutChart } from "../components/charts";
import { Avatar } from "../components/charts";
import { SendIcon, SparkIcon } from "../components/icons";

interface Message {
  id: number;
  role: "user" | "ai";
  text: string;
  answer?: AiAnswer;
  pending?: boolean;
}

function ResultRenderer({ spec }: { spec: ChartSpec }) {
  if (spec.kind === "bars") return <BarChart data={spec.data} />;
  if (spec.kind === "donut") return <DonutChart data={spec.data} />;
  if (spec.kind === "table")
    return (
      <DataTable
        columns={spec.columns}
        rows={spec.rows.map((r) => r.map((c) => String(c)))}
        align={spec.columns.map((_, i) => (i === 0 ? "left" : "right"))}
      />
    );
  if (spec.kind === "stat")
    return (
      <div className="kpi-row" style={{ marginBottom: 0 }}>
        {spec.stats.map((s) => (
          <div className="stat-card" key={s.label}>
            <div className="stat-card-label">{s.label}</div>
            <div className="stat-card-value">{s.value}</div>
          </div>
        ))}
      </div>
    );
  return null;
}

export default function AskView() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLive, setIsLive] = useState<boolean | null>(null);
  const focusRef = useRef<AiFocus>({});
  const idRef = useRef(0);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = async (text: string) => {
    const q = text.trim();
    if (!q) return;
    const userId = ++idRef.current;
    const aiId = ++idRef.current;
    setMessages((m) => [
      ...m,
      { id: userId, role: "user", text: q },
      { id: aiId, role: "ai", text: "", pending: true },
    ]);
    setInput("");

    // Build conversation history for the API
    const history = messages
      .filter((m) => !m.pending)
      .map((m) => ({
        role: m.role as "user" | "ai",
        content: m.role === "ai" ? (m.answer?.summary ?? m.text) : m.text,
      }));

    try {
      // Try the live AI API first
      const answer = await askGemini(q, history);
      setIsLive(true);
      setMessages((m) =>
        m.map((msg) =>
          msg.id === aiId ? { ...msg, pending: false, text: answer.summary, answer } : msg
        )
      );
    } catch {
      // Fallback to local intent matcher if backend is down
      setIsLive(false);
      const answer = answerQuestion(q, focusRef.current);
      focusRef.current = answer.focus;
      setMessages((m) =>
        m.map((msg) =>
          msg.id === aiId ? { ...msg, pending: false, text: answer.summary, answer } : msg
        )
      );
    }
  };

  const empty = messages.length === 0;

  return (
    <div className="ask-wrap">
      <div className="ask-thread" ref={threadRef}>
        <div className="ask-inner">
          {empty && (
            <div className="ask-empty">
              <div className="spark-badge">
                <SparkIcon size={26} />
              </div>
              <h2>Ask anything about your spend</h2>
              <p>
                Ask in plain English and get charts back. Try a suggestion below, then ask
                follow-ups. Context carries over.
              </p>
              {isLive !== null && (
                <div className={`ai-mode-badge ${isLive ? "live" : "offline"}`}>
                  {isLive ? "✦ Live analysis" : "⚡ Offline mode (local engine)"}
                </div>
              )}
            </div>
          )}

          {messages.map((msg) =>
            msg.role === "user" ? (
              <div className="msg user" key={msg.id}>
                <div className="bubble">{msg.text}</div>
              </div>
            ) : (
              <motion.div
                className="msg ai"
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Avatar name="AI" hue={214} size={34} />
                <div className="bubble">
                  <div className="ai-head">
                    <SparkIcon size={13} /> Crest AI

                  </div>
                  {msg.pending ? (
                    <div className="typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : (
                    <>
                      <div>{msg.text}</div>
                      {msg.answer?.spec && (
                        <div className="ai-result">
                          <ResultRenderer spec={msg.answer.spec} />
                        </div>
                      )}
                      {msg.answer && msg.answer.followups.length > 0 && (
                        <div className="followups">
                          {msg.answer.followups.map((f) => (
                            <span className="followup-chip" key={f} onClick={() => submit(f)}>
                              {f}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            )
          )}
        </div>
      </div>

      <div className="ask-composer">
        <div className="ask-composer-inner">
          {empty && (
            <div className="suggested-row">
              {SUGGESTED_PROMPTS.map((p) => (
                <span className="followup-chip" key={p} onClick={() => submit(p)}>
                  {p}
                </span>
              ))}
            </div>
          )}
          <form
            className="composer-box"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about departments, categories, vendors, time periods…"
            />
            <button className="send-btn" type="submit" disabled={!input.trim()}>
              <SendIcon size={18} />
            </button>
          </form>
          {isLive !== null && !empty && (
            <div className="composer-status">
              {isLive ? "✦ Live analysis" : "⚡ Local engine (backend unavailable)"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
