"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { formatRelativeTimestamp } from "@/lib/format";
import type { GatewayEventFrame } from "@/lib/gateway";
import type {
  SessionsListResult,
  GatewaySessionRow,
  SessionsPatchResult,
  ModelCatalogEntry,
  ModelsCatalogResult,
} from "@/lib/types";
import { useGateway, useGatewayEvents } from "@/lib/use-gateway";

// ============================================
// Types
// ============================================

type ChatMessage = {
  idempotencyKey?: string; // Optional key to prevent duplicate messages
  role: "user" | "assistant" | "system";
  content: string | { type: string; text: string }[];
  timestamp?: number;
};

type ChatHistoryResult = {
  sessionKey: string;
  messages: ChatMessage[];
  thinkingLevel?: string;
};

type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
};

// ============================================
// Styles
// ============================================

const styles = {
  pageContainer: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100vh",
    background: "var(--bg)",
    overflow: "hidden",
    padding: 16,
  } as React.CSSProperties,
  topbarSpacer: {
    height: "var(--topbar-height)",
    flexShrink: 0,
  } as React.CSSProperties,
  contentArea: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  } as React.CSSProperties,
  layout: {
    display: "flex",
    flex: 1,
    minHeight: 0,
  } as React.CSSProperties,
  sidebar: {
    background: "var(--bg)",
    borderRight: "1px solid var(--border)",
    padding: 16,
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
    width: 260,
    flexShrink: 0,
    minHeight: 0,
    overflow: "auto",
  } as React.CSSProperties,
  card: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    display: "flex",
    flexDirection: "column" as const,
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  } as React.CSSProperties,
  chatBody: {
    display: "flex",
    gap: 16,
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-strong)",
    margin: 0,
  } as React.CSSProperties,
  cardSub: {
    fontSize: 12,
    color: "var(--muted)",
    marginTop: 2,
  } as React.CSSProperties,
  btn: {
    height: 28,
    padding: "0 12px",
    fontSize: 12,
    fontWeight: 500,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: "var(--radius-md)",
    background: "var(--secondary)",
    color: "var(--text)",
    cursor: "pointer",
    width: "100%",
  } as React.CSSProperties,
  btnPrimary: {
    background: "var(--accent)",
    color: "#fff",
    borderColor: "var(--accent)",
  } as React.CSSProperties,
  sessionList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
    flex: 1,
    overflow: "auto",
    marginTop: 8,
  } as React.CSSProperties,
  sessionRow: {
    padding: "8px 10px",
    borderRadius: "var(--radius-md)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
    background: "transparent",
    cursor: "pointer",
    textAlign: "left" as const,
    width: "100%",
    transition: "background 0.15s, border-color 0.15s",
  } as React.CSSProperties,
  sessionRowActive: {
    background: "var(--bg-hover)",
    borderColor: "var(--border)",
  } as React.CSSProperties,
  sessionTitle: {
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-strong)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  sessionSub: {
    fontSize: 11,
    color: "var(--muted)",
    marginTop: 2,
  } as React.CSSProperties,
  messagesArea: {
    flex: 1,
    overflow: "auto",
    padding: 16,
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
  } as React.CSSProperties,
  messageRow: {
    display: "flex",
    flexDirection: "column" as const,
    maxWidth: "80%",
    gap: 4,
  } as React.CSSProperties,
  messageRowUser: {
    alignSelf: "flex-end",
    alignItems: "flex-end",
  } as React.CSSProperties,
  messageRowAssistant: {
    alignSelf: "flex-start",
    alignItems: "flex-start",
  } as React.CSSProperties,
  bubble: {
    padding: "10px 14px",
    borderRadius: "var(--radius-lg)",
    fontSize: 14,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  } as React.CSSProperties,
  bubbleUser: {
    background: "var(--accent)",
    color: "#fff",
    borderBottomRightRadius: 4,
  } as React.CSSProperties,
  bubbleAssistant: {
    background: "var(--bg-hover)",
    color: "var(--text)",
    borderBottomLeftRadius: 4,
  } as React.CSSProperties,
  timestamp: {
    fontSize: 10,
    color: "var(--muted)",
  } as React.CSSProperties,
  compose: {
    padding: 16,
    borderTop: "1px solid var(--border)",
    display: "flex",
    gap: 8,
  } as React.CSSProperties,
  input: {
    flex: 1,
    minHeight: 38,
    padding: "8px 12px",
    fontSize: 14,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: "var(--radius-md)",
    background: "var(--bg)",
    color: "var(--text)",
    outline: "none",
    resize: "none" as const,
    fontFamily: "inherit",
  } as React.CSSProperties,
  muted: {
    color: "var(--muted)",
    fontSize: 13,
  } as React.CSSProperties,
  callout: {
    padding: "10px 14px",
    borderRadius: "var(--radius-md)",
    fontSize: 13,
    margin: 16,
  } as React.CSSProperties,
  calloutDanger: {
    background: "var(--danger-subtle)",
    color: "var(--danger)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--danger)",
  } as React.CSSProperties,
  emptyState: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--muted)",
    fontSize: 14,
  } as React.CSSProperties,
  modelBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text)",
    padding: "4px 8px",
    borderRadius: "var(--radius-md)",
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
  } as React.CSSProperties,
  modelSelector: {
    position: "absolute" as const,
    top: 48,
    right: 16,
    zIndex: 1000,
    minWidth: 280,
    maxHeight: 400,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column" as const,
  } as React.CSSProperties,
  modelSelectorHeader: {
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-hover)",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-strong)",
  } as React.CSSProperties,
  modelItem: {
    padding: "8px 12px",
    cursor: "pointer",
    transition: "background 0.1s",
    borderBottom: "1px solid var(--border)",
  } as React.CSSProperties,
  modelItemHover: {
    background: "var(--bg-hover)",
  } as React.CSSProperties,
  modelItemSelected: {
    background: "var(--accent-subtle)",
    borderColor: "var(--accent)",
  } as React.CSSProperties,
  modelItemName: {
    fontSize: 12,
    fontWeight: 500,
    color: "var(--text-strong)",
  } as React.CSSProperties,
  modelItemMeta: {
    fontSize: 10,
    color: "var(--muted)",
    marginTop: 2,
    display: "flex",
    gap: 8,
    alignItems: "center",
  } as React.CSSProperties,
  modelSelectorFooter: {
    padding: "8px 12px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-hover)",
    display: "flex",
    justifyContent: "flex-end",
  } as React.CSSProperties,
};

// ============================================
// Message Component
// ============================================

function Message({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  let contentToRender: React.ReactNode;
  if (typeof message.content === "string") {
    contentToRender = message.content;
  } else if (message.content && typeof message.content === "object") {
    if (Array.isArray(message.content) && message.content.length > 0) {
      contentToRender = message.content.map((part, idx) => {
        if (part.type === "text") {
          return <span key={idx}>{part.text}</span>;
        }
        return null;
      });
    } else {
      return "";
    }
  }

  return (
    <div
      style={{
        ...styles.messageRow,
        ...(isUser ? styles.messageRowUser : styles.messageRowAssistant),
      }}
    >
      <div
        style={{
          ...styles.bubble,
          ...(isUser ? styles.bubbleUser : styles.bubbleAssistant),
        }}
      >
        {contentToRender}
      </div>
      {message.timestamp && (
        <div style={styles.timestamp}>{formatRelativeTimestamp(message.timestamp)}</div>
      )}
    </div>
  );
}

// ============================================
// Main Chat Page
// ============================================

export default function ChatPage() {
  const { state, request, client } = useGateway();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<GatewaySessionRow[]>([]);
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatStream, setChatStream] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [models, setModels] = useState<ModelCatalogEntry[]>([]);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [isChangingModel, setIsChangingModel] = useState(false);
  const [hoveredModelIndex, setHoveredModelIndex] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedSessionKeyRef = useRef<string | null>(null);
  const modelSelectorRef = useRef<HTMLDivElement>(null);
  selectedSessionKeyRef.current = selectedSessionKey;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const loadSessions = useCallback(async () => {
    if (state !== "connected") {
      return;
    }

    try {
      const res = await request<SessionsListResult>("sessions.list", {});
      setSessions(res.sessions ?? []);
      // Auto-select first session if none selected
      if (!selectedSessionKey && res.sessions?.length) {
        setSelectedSessionKey(res.sessions[0].key);
      }
    } catch (err) {
      console.error("Failed to load sessions:", err);
    }
  }, [state, request, selectedSessionKey]);

  const loadChatHistory = useCallback(async () => {
    // Read from ref to always use the LATEST session key (avoids stale closure)
    const sessionKey = selectedSessionKeyRef.current;
    if (state !== "connected" || !sessionKey) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await request<ChatHistoryResult>("chat.history", {
        sessionKey,
      });
      // Only update if session hasn't changed while we were fetching
      if (selectedSessionKeyRef.current === sessionKey) {
        setMessages(res.messages ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chat history");
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [state, request]);

  const loadModels = useCallback(async () => {
    if (state !== "connected") {
      return;
    }

    try {
      const res = await request<ModelsCatalogResult>("models.list", {});
      setModels(res.models ?? []);
    } catch (err) {
      console.error("Failed to load models:", err);
    }
  }, [state, request]);

  const changeModel = useCallback(
    async (modelId: string) => {
      if (!selectedSessionKey || state !== "connected") {
        return;
      }

      setIsChangingModel(true);
      setError(null);

      try {
        const res = await request<SessionsPatchResult>("sessions.patch", {
          key: selectedSessionKey,
          model: modelId,
        });

        // Update the session in the local sessions list
        if (res.ok) {
          setSessions((prev) =>
            prev.map((s) =>
              s.key === selectedSessionKey
                ? { ...s, model: modelId, modelProvider: res.entry?.modelProvider }
                : s,
            ),
          );
        }

        setShowModelSelector(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to change model");
      } finally {
        setIsChangingModel(false);
      }
    },
    [selectedSessionKey, state, request],
  );

  const sendMessage = useCallback(async () => {
    if (!draft.trim() || !selectedSessionKey || state !== "connected") {
      return;
    }

    const text = draft.trim();
    setDraft("");
    setSending(true);
    setError(null);
    setChatStream("");

    // Optimistically add user message
    const userMessage: ChatMessage = {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      // chat.send only acknowledges receipt — actual response comes via "chat" events
      await request("chat.send", {
        sessionKey: selectedSessionKey,
        message: text,
        deliver: false,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      setChatStream(null);
    } finally {
      setSending(false);
    }
  }, [draft, selectedSessionKey, state, request]);

  // Listen for real-time "chat" events from the gateway
  useGatewayEvents(client, (evt: GatewayEventFrame) => {
    if (evt.event !== "chat") {
      return;
    }

    const payload = evt.payload as ChatEventPayload | undefined;
    if (!payload) {
      return;
    }

    // Only process events for the currently selected session
    const currentSessionKey = selectedSessionKeyRef.current;
    if (payload.sessionKey !== currentSessionKey) {
      return;
    }

    if (payload.state === "delta") {
      // Streaming text delta — accumulate into chatStream
      const msg = payload.message as Record<string, unknown> | undefined;
      const content = msg?.content;
      let delta = "";
      if (typeof content === "string") {
        delta = content;
      } else if (Array.isArray(content)) {
        delta = (content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("");
      } else if (typeof msg?.text === "string") {
        delta = msg.text;
      }
      if (typeof delta === "string") {
        setChatStream((prev) =>
          // Gateway sends cumulative text — use it directly if longer
          delta.length >= (prev?.length ?? 0) ? delta : prev,
        );
      }
    } else if (payload.state === "final") {
      // Final message — commit to messages list, clear stream
      const msg = payload.message as Record<string, unknown> | undefined;
      if (msg) {
        const finalMsg: ChatMessage = {
          role: "assistant",
          content:
            typeof msg.content === "string"
              ? msg.content
              : Array.isArray(msg.content)
                ? (msg.content as Array<{ type: string; text: string }>)
                : typeof msg.text === "string"
                  ? msg.text
                  : "",
          timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
        };
        setMessages((prev) => [...prev, finalMsg]);
      }
      setChatStream(null);
    } else if (payload.state === "aborted") {
      // Aborted — if we had streamed text, save it
      setChatStream((currentStream) => {
        if (currentStream?.trim()) {
          const abortedMsg: ChatMessage = {
            role: "assistant",
            content: currentStream,
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, abortedMsg]);
        }
        return null;
      });
    } else if (payload.state === "error") {
      setError(payload.errorMessage ?? "Chat error");
      setChatStream(null);
    }
  });

  const handleNewSession = useCallback(async () => {
    if (state !== "connected") {
      alert("Not connected to gateway");
      return;
    }

    try {
      const res = await request<{ key: string }>("sessions.reset", {
        key: `agent:main:${new Date().getTime()}`,
      });
      if (res.key) {
        // Clear all chat state BEFORE switching session
        // to prevent loadChatHistory from overwriting with old data
        setMessages([]);
        setChatStream(null);
        setError(null);
        setSelectedSessionKey(res.key);
        void loadSessions();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
      alert(err instanceof Error ? err.message : "Failed to create session");
    }
  }, [state, request, loadSessions]);

  const handleDeleteSession = useCallback(
    async (key: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!window.confirm("Are you sure you want to delete this session?")) {
        return;
      }

      if (state !== "connected") {
        alert("Not connected to gateway");
        return;
      }

      try {
        const res = await request<{ deleted: boolean }>("sessions.delete", {
          key,
        });
        if (res.deleted) {
          if (selectedSessionKey === key) {
            setSelectedSessionKey(null);
            setMessages([]);
            setChatStream(null);
            setError(null);
          }
          void loadSessions();
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to delete session");
      }
    },
    [state, request, selectedSessionKey, loadSessions],
  );

  useEffect(() => {
    if (state === "connected") {
      void loadSessions();
      void loadModels();
    }
  }, [state, loadSessions, loadModels]);

  useEffect(() => {
    if (selectedSessionKey) {
      void loadChatHistory();
    }
  }, [selectedSessionKey, loadChatHistory]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showModelSelector) {
        setShowModelSelector(false);
      }
    };
    if (showModelSelector) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [showModelSelector]);

  useEffect(() => {
    if (!showModelSelector) {
      return;
    }
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(target)) {
        setShowModelSelector(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showModelSelector]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const isDisabled = state !== "connected";

  return (
    <div style={styles.pageContainer}>
      <div style={styles.topbarSpacer} />
      <div style={styles.contentArea}>
        <div style={styles.layout}>
          {/* Chat Area */}
          <div style={styles.card}>
            {/* Chat Header */}
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "var(--bg-hover)",
                borderTopLeftRadius: "var(--radius-lg)",
                borderTopRightRadius: "var(--radius-lg)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  onClick={() => setIsSidebarVisible(!isSidebarVisible)}
                  style={{
                    ...styles.btn,
                    width: "auto",
                    padding: "4px 8px",
                    background: "var(--card)",
                  }}
                  title={isSidebarVisible ? "Hide Sidebar" : "Show Sidebar"}
                >
                  {isSidebarVisible ? "◧ Hide" : "◨ Show Sidebar"}
                </button>
                <h2
                  style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "var(--text-strong)" }}
                >
                  {selectedSessionKey
                    ? sessions.find((s) => s.key === selectedSessionKey)?.label ||
                      sessions.find((s) => s.key === selectedSessionKey)?.displayName ||
                      selectedSessionKey
                    : "Select a Session"}
                </h2>
              </div>
              {selectedSessionKey && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <button
                    style={styles.modelBadge}
                    onClick={() => setShowModelSelector(!showModelSelector)}
                    disabled={isChangingModel}
                    title="Change model"
                  >
                    {isChangingModel ? "⏳" : "🤖"}
                    {(() => {
                      const session = sessions.find((s) => s.key === selectedSessionKey);
                      const modelId = session?.model;
                      if (!modelId) {
                        return "Default model";
                      }
                      const model = models.find((m) => m.id === modelId);
                      if (model) {
                        return `${model.provider}/${model.name}`;
                      }
                      return modelId;
                    })()}
                    <span style={{ marginLeft: 4 }}>✏️</span>
                  </button>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ok)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontWeight: 500,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        background: "var(--ok)",
                        borderRadius: "50%",
                      }}
                    />
                    Active Session
                  </div>
                </div>
              )}
            </div>

            {/* Model Selector Dropdown */}
            {showModelSelector && (
              <div style={styles.modelSelector} ref={modelSelectorRef}>
                <div style={styles.modelSelectorHeader}>Select Model</div>
                <div style={{ flex: 1, overflowY: "auto" }}>
                  {models.length === 0 ? (
                    <div
                      style={{
                        padding: 16,
                        textAlign: "center" as const,
                        color: "var(--muted)",
                        fontSize: 12,
                      }}
                    >
                      Loading models...
                    </div>
                  ) : (
                    models.map((model, index) => {
                      const session = sessions.find((s) => s.key === selectedSessionKey);
                      const currentModelId = session?.model;
                      const isSelected = currentModelId === model.id;
                      return (
                        <div
                          key={model.id}
                          style={{
                            ...styles.modelItem,
                            ...(isSelected ? styles.modelItemSelected : {}),
                            ...(hoveredModelIndex === index ? styles.modelItemHover : {}),
                          }}
                          onMouseEnter={() => setHoveredModelIndex(index)}
                          onMouseLeave={() => setHoveredModelIndex(null)}
                          onClick={() => changeModel(model.id)}
                        >
                          <div style={styles.modelItemName}>
                            {model.name}{" "}
                            <span style={{ color: "var(--muted)" }}>({model.provider})</span>
                          </div>
                          <div style={styles.modelItemMeta}>
                            {model.contextWindow && (
                              <span>📊 {Math.round(model.contextWindow / 1000)}K ctx</span>
                            )}
                            {model.reasoning && <span>🧠 Reasoning</span>}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <div style={styles.modelSelectorFooter}>
                  <button
                    style={{ ...styles.btn, width: "auto" }}
                    onClick={() => setShowModelSelector(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div style={styles.chatBody}>
              {/* Sessions Sidebar */}
              {isSidebarVisible && (
                <div style={styles.sidebar}>
                  <div style={styles.cardTitle}>Sessions</div>
                  <button
                    style={{ ...styles.btn, ...styles.btnPrimary }}
                    disabled={isDisabled}
                    onClick={handleNewSession}
                  >
                    New Session
                  </button>

                  <div style={styles.sessionList}>
                    {sessions.length === 0 ? (
                      <div style={styles.muted}>No sessions yet.</div>
                    ) : (
                      sessions.map((session) => {
                        const isActive = selectedSessionKey === session.key;
                        return (
                          <div
                            key={session.key}
                            style={{
                              ...styles.sessionRow,
                              ...(isActive ? styles.sessionRowActive : {}),
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                            onClick={() => setSelectedSessionKey(session.key)}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={styles.sessionTitle}>
                                {session.label || session.displayName || session.key}
                              </div>
                              <div style={styles.sessionSub}>
                                {session.updatedAt
                                  ? formatRelativeTimestamp(session.updatedAt)
                                  : "No activity"}
                              </div>
                            </div>
                            <button
                              title="Delete Session"
                              onClick={(e) => handleDeleteSession(session.key, e)}
                              style={{
                                background: "transparent",
                                borderWidth: 0,
                                color: "var(--muted)",
                                cursor: "pointer",
                                padding: "4px",
                                fontSize: "14px",
                                lineHeight: 1,
                              }}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Messages and Compose Area */}
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                {error && <div style={{ ...styles.callout, ...styles.calloutDanger }}>{error}</div>}

                {!selectedSessionKey ? (
                  <div style={styles.emptyState}>
                    Select a session or create a new one to start chatting.
                  </div>
                ) : loading ? (
                  <div style={styles.emptyState}>Loading...</div>
                ) : (
                  <>
                    <div style={styles.messagesArea}>
                      {messages.length === 0 && !chatStream ? (
                        <div style={styles.emptyState}>
                          No messages yet. Start the conversation!
                        </div>
                      ) : (
                        messages.map((msg, idx) => <Message key={idx} message={msg} />)
                      )}
                      {/* Streaming response — shown while AI is typing */}
                      {chatStream !== null && (
                        <div
                          style={{
                            ...styles.messageRow,
                            ...styles.messageRowAssistant,
                          }}
                        >
                          <div
                            style={{
                              ...styles.bubble,
                              ...styles.bubbleAssistant,
                              opacity: 0.85,
                            }}
                          >
                            {chatStream === "" ? (
                              <span style={{ color: "var(--muted)", fontStyle: "italic" }}>
                                ●●● typing…
                              </span>
                            ) : (
                              chatStream
                            )}
                          </div>
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </div>

                    <div style={styles.compose}>
                      <textarea
                        style={styles.input}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={
                          isDisabled
                            ? "Connect to gateway to chat..."
                            : "Type a message (Enter to send)"
                        }
                        disabled={isDisabled || sending}
                        rows={1}
                      />
                      <button
                        style={{ ...styles.btn, ...styles.btnPrimary, width: "auto" }}
                        disabled={isDisabled || sending || !draft.trim()}
                        onClick={sendMessage}
                      >
                        {sending ? "Sending..." : "Send"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
