import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { askGemini, SUGGESTED_PROMPTS, type AiAnswer, type ChartSpec } from "../data/ai";
import { BarChart, DataTable, DonutChart } from "./charts";
import { SendIcon, SparkIcon } from "./icons";
import { useNav } from "../state/store";

// ---------------------------------------------------------------------------
// Context-aware floating AI assistant. Flow:
//   1. FAB at bottom-right (resting state)
//   2. Click FAB → enters "pick mode" (crosshair + drag to select a region)
//   3. Drag a rectangle → captures visible content inside, opens chat panel
//   4. User types query → AI answers using the captured context + section info
//   5. Subsequent messages keep the conversation going
// ---------------------------------------------------------------------------

interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ContextInfo {
  section: string;
  element?: string;
  value?: string;
  extra?: string;
}

const MIN_SELECTION_PX = 12;

function rectsIntersect(a: DOMRect | SelectionRect, b: DOMRect): boolean {
  const aRight = a.left + a.width;
  const aBottom = a.top + a.height;
  return a.left < b.right && aRight > b.left && a.top < b.bottom && aBottom > b.top;
}

function normalizeRect(start: { x: number; y: number }, end: { x: number; y: number }): SelectionRect {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  return {
    left,
    top,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
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

function extractRegionContext(rect: SelectionRect, section: string): ContextInfo {
  const root = document.querySelector(".main-content");
  const ctx: ContextInfo = { section, element: "region" };

  if (!root) {
    ctx.element = "general";
    ctx.value = section;
    return ctx;
  }

  const textSnippets: string[] = [];
  const seen = new Set<string>();
  const domRect = new DOMRect(rect.left, rect.top, rect.width, rect.height);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent?.replace(/\s+/g, " ").trim();
      if (!text || text.length < 2) return NodeFilter.FILTER_REJECT;

      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (rectsIntersect(domRect, r)) {
          return NodeFilter.FILTER_ACCEPT;
        }
      }
      return NodeFilter.FILTER_REJECT;
    },
  });

  let textNode: Node | null;
  while ((textNode = walker.nextNode())) {
    const text = textNode.textContent?.replace(/\s+/g, " ").trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      textSnippets.push(text);
    }
  }

  const tagged: string[] = [];
  root.querySelectorAll("[data-ai-ctx]").forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    if (!rectsIntersect(domRect, el.getBoundingClientRect())) return;
    const label = el.getAttribute("data-ai-ctx");
    const val = el.getAttribute("data-ai-val") ?? el.textContent?.replace(/\s+/g, " ").trim().slice(0, 120);
    if (label && val) tagged.push(`${label}: ${val}`);
  });

  const combined = textSnippets.join(" · ").slice(0, 1200);
  ctx.value = combined || section;
  if (tagged.length > 0) {
    ctx.extra = tagged.join("; ");
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

  if (ctx.element === "region") {
    const tagged = ctx.extra ? ` Structured highlights: ${ctx.extra}.` : "";
    return `[Context: The user is on ${where}. They selected an area on screen containing: "${ctx.value}".${tagged}]\n\n`;
  }

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
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<SelectionRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const openChatWithContext = useCallback((ctx: ContextInfo) => {
    setContext(ctx);
    setMode("chat");
    setMessages([]);
    setDragRect(null);
    setIsDragging(false);
    dragStartRef.current = null;
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const cancelPickMode = useCallback(() => {
    setDragRect(null);
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  // Auto-scroll chat thread
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const finishSelection = useCallback(
    (rect: SelectionRect) => {
      if (rect.width < MIN_SELECTION_PX || rect.height < MIN_SELECTION_PX) {
        cancelPickMode();
        return;
      }
      openChatWithContext(extractRegionContext(rect, section));
    },
    [section, openChatWithContext, cancelPickMode]
  );

  const handleOverlayMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
    setDragRect({ left: e.clientX, top: e.clientY, width: 0, height: 0 });
  }, []);

  useEffect(() => {
    if (mode !== "picking") return;

    document.body.classList.add("ai-pick-mode");

    const onMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      setDragRect(normalizeRect(dragStartRef.current, { x: e.clientX, y: e.clientY }));
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const rect = normalizeRect(dragStartRef.current, { x: e.clientX, y: e.clientY });
      dragStartRef.current = null;
      setIsDragging(false);
      finishSelection(rect);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelPickMode();
        setMode("idle");
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.classList.remove("ai-pick-mode");
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mode, finishSelection, cancelPickMode]);

  const handleFABClick = () => {
    if (mode === "idle") {
      cancelPickMode();
      setMode("picking");
    } else if (mode === "picking") {
      // Clicking FAB again during pick mode → open chat with general context
      openChatWithContext({ section, element: "general", value: section });
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
      setIsLive(true); // still show AI badge — it was attempted
      const errorAnswer: AiAnswer = {
        summary: "I'm having trouble connecting right now. Please try again in a moment.",
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
      : context.element === "region"
        ? "Asking about selected area"
        : `Asking about this ${context.element}`
    : "";

  const suggestedForContext = context?.element === "region"
    ? ["Summarize what's in this area", "What stands out here?", "Explain these numbers"]
    : context?.element === "violation"
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
      {/* Drag-to-select overlay (Windows snipping-tool style) */}
      <AnimatePresence>
        {mode === "picking" && (
          <>
            <motion.div
              className={`ai-selection-overlay${isDragging ? " dragging" : ""}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onMouseDown={handleOverlayMouseDown}
            />
            {dragRect && dragRect.width > 0 && dragRect.height > 0 && (
              <div
                className="ai-selection-box"
                style={{
                  left: dragRect.left,
                  top: dragRect.top,
                  width: dragRect.width,
                  height: dragRect.height,
                }}
              >
                <span className="ai-selection-size">
                  {Math.round(dragRect.width)} × {Math.round(dragRect.height)}
                </span>
              </div>
            )}
            <motion.div
              className="pick-hint"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
            >
              <SparkIcon size={14} />
              {isDragging
                ? "Release to capture this area"
                : "Drag to select an area — Esc to cancel, or click the button for general questions"}
            </motion.div>
          </>
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
                <span>Crest AI</span>
                <span className="ai-model-tag">Crest AI</span>
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
                placeholder="Ask about this selection…"
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
