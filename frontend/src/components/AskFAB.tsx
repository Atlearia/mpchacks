import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { askGemini, SUGGESTED_PROMPTS, type AiAnswer, type ChartSpec } from "../data/ai";
import { BarChart, DataTable, DonutChart } from "./charts";
import { SendIcon, SparkIcon } from "./icons";
import { useNav } from "../state/store";

// ---------------------------------------------------------------------------
// Context-aware floating AI assistant. Flow:
//   1. FAB at bottom-right (resting state)
//   2. Click FAB → enters "pick mode" (cursor becomes crosshair, elements highlight)
//   3. Click any element → captures context, opens chat panel anchored to FAB
//   4. User types query → AI answers using the captured context + section info
//   5. Subsequent messages keep the conversation going
// ---------------------------------------------------------------------------

interface ContextInfo {
  section: string;
  element?: string;
  value?: string;
  extra?: string;
}

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
          <div className="stat-card" key={s.label} style={{ padding: "10px 12px" }}>
            <div className="stat-card-label" style={{ fontSize: 10 }}>{s.label}</div>
            <div className="stat-card-value" style={{ fontSize: 18 }}>{s.value}</div>
          </div>
        ))}
      </div>
    );
  return null;
}

function extractContext(el: HTMLElement, section: string): ContextInfo {
  // Walk up from the clicked element to find meaningful data attributes or text
  let node: HTMLElement | null = el;
  const ctx: ContextInfo = { section };

  while (node && node !== document.body) {
    // Check for data-ai-context attributes we sprinkle on key elements
    const aiCtx = node.getAttribute("data-ai-ctx");
    if (aiCtx) {
      ctx.element = aiCtx;
      ctx.value = node.getAttribute("data-ai-val") ?? node.textContent?.trim().slice(0, 120);
      break;
    }

    // Heuristic: known CSS classes → context type
    if (node.classList.contains("stat-card")) {
      ctx.element = "stat-card";
      ctx.value = node.textContent?.trim().slice(0, 100);
      break;
    }
    if (node.classList.contains("violation-row")) {
      ctx.element = "violation";
      ctx.value = node.textContent?.trim().slice(0, 200);
      break;
    }
    if (node.classList.contains("queue-card")) {
      ctx.element = "approval-request";
      ctx.value = node.textContent?.trim().slice(0, 200);
      break;
    }
    if (node.classList.contains("offender-row")) {
      ctx.element = "repeat-offender";
      ctx.value = node.textContent?.trim().slice(0, 150);
      break;
    }
    if (node.classList.contains("panel")) {
      const heading = node.querySelector("h3");
      ctx.element = "panel";
      ctx.value = heading?.textContent?.trim() ?? node.textContent?.trim().slice(0, 150);
      break;
    }
    if (node.classList.contains("bar-col")) {
      ctx.element = "chart-bar";
      ctx.value = node.textContent?.trim().slice(0, 80);
      break;
    }
    if (node.classList.contains("emp-card")) {
      ctx.element = "employee";
      ctx.value = node.textContent?.trim().slice(0, 150);
      break;
    }
    if (node.classList.contains("report-card")) {
      ctx.element = "expense-report";
      ctx.value = node.textContent?.trim().slice(0, 200);
      break;
    }
    if (node.classList.contains("nav-item")) {
      ctx.element = "navigation";
      ctx.value = node.textContent?.trim();
      break;
    }
    if (node.classList.contains("kpi")) {
      ctx.element = "kpi";
      ctx.value = node.textContent?.trim();
      break;
    }

    node = node.parentElement;
  }

  if (!ctx.element) {
    ctx.element = "general";
    ctx.value = el.textContent?.trim().slice(0, 100) || section;
  }

  return ctx;
}

function contextToPromptPrefix(ctx: ContextInfo): string {
  const sectionNames: Record<string, string> = {
    overview: "the Executive Overview dashboard",
    explore: "the Spend Explorer",
    policy: "the Policy Compliance view",
    approvals: "the Pre-Approval Queue",
    reports: "the Expense Reports view",
  };

  const where = sectionNames[ctx.section] ?? ctx.section;
  const what = ctx.element !== "general"
    ? `I'm looking at a ${ctx.element} element showing: "${ctx.value}".`
    : "";

  return `[Context: The user is on ${where}. ${what}]\n\n`;
}

export default function AskFAB() {
  const section = useNav((s) => s.section);
  const [mode, setMode] = useState<"idle" | "picking" | "chat">("idle");
  const [context, setContext] = useState<ContextInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLive, setIsLive] = useState<boolean | null>(null);
  const idRef = useRef(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);


  // Auto-scroll chat thread
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Pick mode: listen for clicks on the page
  const handlePickClick = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;

    // Ignore clicks on the FAB itself or the chat panel
    if (target.closest(".ask-fab") || target.closest(".ask-panel")) return;

    e.preventDefault();
    e.stopPropagation();

    const ctx = extractContext(target, section);
    setContext(ctx);
    setMode("chat");
    setMessages([]);

    // Focus the input after a tick
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [section]);

  useEffect(() => {
    if (mode === "picking") {
      document.body.classList.add("ai-pick-mode");
      document.addEventListener("click", handlePickClick, true);
      return () => {
        document.body.classList.remove("ai-pick-mode");
        document.removeEventListener("click", handlePickClick, true);
      };
    }
  }, [mode, handlePickClick]);

  const handleFABClick = () => {
    if (mode === "idle") {
      setMode("picking");
    } else if (mode === "picking") {
      // Clicking FAB again during pick mode → open chat with general context
      setContext({ section, element: "general", value: section });
      setMode("chat");
      setMessages([]);
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      // Close chat
      setMode("idle");
      setContext(null);
      setMessages([]);
    }
  };

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

    const prefix = context ? contextToPromptPrefix(context) : "";
    const fullQuestion = messages.length === 0 ? prefix + q : q;

    const history = messages
      .filter((m) => !m.pending)
      .map((m) => ({
        role: m.role as "user" | "ai",
        content: m.role === "ai" ? (m.answer?.summary ?? m.text) : m.text,
      }));

    try {
      const answer = await askGemini(fullQuestion, history);
      setIsLive(true);
      setMessages((m) =>
        m.map((msg) =>
          msg.id === aiId ? { ...msg, pending: false, text: answer.summary, answer } : msg
        )
      );
    } catch (err) {
      console.error("[AskFAB] AI error:", err);
      setIsLive(true); // still show Gemini badge — it was attempted
      const errorAnswer: AiAnswer = {
        summary: "I'm having trouble connecting to Gemini right now. Please try again in a moment.",
        followups: ["Try again"],
        focus: {},
      };
      setMessages((m) =>
        m.map((msg) =>
          msg.id === aiId ? { ...msg, pending: false, text: errorAnswer.summary, answer: errorAnswer } : msg
        )
      );
    }
  };

  const contextLabel = context
    ? context.element === "general"
      ? `Asking about ${context.section}`
      : `Asking about this ${context.element}`
    : "";

  const suggestedForContext = context?.element === "violation"
    ? ["Why is this a violation?", "Who else does this?", "How severe is this?"]
    : context?.element === "approval-request"
      ? ["Should we approve this?", "What's their spending history?", "Is this within budget?"]
      : context?.element === "stat-card" || context?.element === "kpi"
        ? ["What's driving this number?", "How has this trended?", "Break it down by department"]
        : context?.element === "repeat-offender"
          ? ["What are their violations?", "How does this compare to peers?", "What action should we take?"]
          : SUGGESTED_PROMPTS.slice(0, 3);

  return (
    <>
      {/* Pick-mode overlay hint */}
      <AnimatePresence>
        {mode === "picking" && (
          <motion.div
            className="pick-hint"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
          >
            <SparkIcon size={14} />
            Click any element to ask about it — or click the button again for general questions
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Panel */}
      <AnimatePresence>
        {mode === "chat" && (
          <motion.div
            className="ask-panel"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 350 }}
          >
            <div className="ask-panel-header">
              <div className="ask-panel-title">
                <SparkIcon size={15} />
                <span>Brim AI</span>
                <span className="ai-model-tag">Gemini 3.1 Pro</span>
              </div>
              <button className="ask-panel-close" onClick={() => { setMode("idle"); setContext(null); setMessages([]); }}>
                ✕
              </button>
            </div>

            {contextLabel && (
              <div className="ask-panel-context">
                {contextLabel}
              </div>
            )}

            <div className="ask-panel-thread" ref={threadRef}>
              {messages.length === 0 && (
                <div className="ask-panel-empty">
                  <p>Ask anything about what you see</p>
                  <div className="ask-panel-suggestions">
                    {suggestedForContext.map((p) => (
                      <button className="ask-suggestion" key={p} onClick={() => submit(p)}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((msg) =>
                msg.role === "user" ? (
                  <div className="ask-msg user" key={msg.id}>
                    <div className="ask-bubble">{msg.text}</div>
                  </div>
                ) : (
                  <motion.div
                    className="ask-msg ai"
                    key={msg.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <div className="ask-bubble">
                      {msg.pending ? (
                        <div className="typing">
                          <span /><span /><span />
                        </div>
                      ) : (
                        <>
                          <div>{msg.text}</div>
                          {msg.answer?.spec && (
                            <div className="ask-result">
                              <ResultRenderer spec={msg.answer.spec} />
                            </div>
                          )}
                          {msg.answer && msg.answer.followups.length > 0 && (
                            <div className="ask-followups">
                              {msg.answer.followups.map((f) => (
                                <button className="ask-suggestion" key={f} onClick={() => submit(f)}>
                                  {f}
                                </button>
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

            <form
              className="ask-panel-composer"
              onSubmit={(e) => {
                e.preventDefault();
                submit(input);
              }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about this element…"
              />
              <button className="ask-send" type="submit" disabled={!input.trim()}>
                <SendIcon size={16} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FAB */}
      <motion.button
        className={`ask-fab ${mode === "picking" ? "picking" : ""} ${mode === "chat" ? "active" : ""}`}
        onClick={handleFABClick}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        layout
      >
        {mode === "chat" ? (
          <span style={{ fontSize: 18, lineHeight: 1 }}>✕</span>
        ) : (
          <SparkIcon size={22} />
        )}
      </motion.button>
    </>
  );
}
