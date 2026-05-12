"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { draftReminderPreview, sendReminderDraft } from "./actions";

export type QueueVehicle = {
  vehicleId: string;
  customerId: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  motExpiry: string | null;
  serviceDue: string | null;
  motDays: number | null;
  svcDays: number | null;
  primaryReminderType: "mot" | "service";
  lastReminderAt: string | null;
};

export type SentReminder = {
  key: string;
  subject: string;
  type: string;
  sentAt: string;
  customerName: string | null;
  customerId: string | null;
  registration: string | null;
  email: "sent" | "failed" | null;
  sms: "sent" | "failed" | null;
  whatsapp: "sent" | "failed" | null;
  emailText: string | null;
  smsText: string | null;
  whatsappText: string | null;
};

type DraftState =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "ready"; email: string; sms: string; subject: string }
  | { type: "sending" }
  | { type: "sent"; channels: string[] }
  | { type: "error"; message: string };

type Tone = "friendly" | "direct" | "warm";

const TONES: { id: Tone; label: string; n: string }[] = [
  { id: "friendly", label: "FRIENDLY", n: "01" },
  { id: "direct", label: "DIRECT", n: "02" },
  { id: "warm", label: "WARM", n: "03" },
];

function Plate({ reg }: { reg: string }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-geist-mono, monospace)",
        fontWeight: 700,
        letterSpacing: "0.06em",
        background: "#f4d35e",
        color: "var(--background)",
        padding: "2px 7px",
        borderRadius: 3,
        fontSize: 11,
        border: "1px solid #c9a435",
        whiteSpace: "nowrap",
        display: "inline-block",
      }}
    >
      {reg}
    </span>
  );
}

function dueDaysLabel(days: number | null): string {
  if (days === null) return "—";
  if (days < 0) return `${Math.abs(days)}d ago`;
  return `+${days}d`;
}

function dueDaysColor(days: number | null, accent: string): string {
  if (days === null) return "var(--muted-foreground)";
  if (days < 0) return "#ff5b5b";
  if (days <= 14) return accent;
  return "var(--muted-foreground)";
}

function ChannelDot({ status }: { status: "sent" | "failed" | null }) {
  if (!status) return null;
  return (
    <span
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: 99,
        background: status === "sent" ? "#5fdd9d" : "#ff5b5b",
      }}
    />
  );
}

export function ReminderComposer({
  queue,
  history,
  brandColor = "#6366f1",
}: {
  queue: QueueVehicle[];
  history: SentReminder[];
  brandColor?: string;
}) {
  const accent = brandColor;
  const accentBg = `${brandColor}18`;
  const [mode, setMode] = useState<"queue" | "history">("queue");
  const [selectedHistory, setSelectedHistory] = useState<SentReminder | null>(null);
  const [selected, setSelected] = useState<QueueVehicle | null>(null);
  const [tone, setTone] = useState<Tone>("friendly");
  const [draft, setDraft] = useState<DraftState>({ type: "idle" });
  const [editEmail, setEditEmail] = useState("");
  const [editSms, setEditSms] = useState("");
  const [channels, setChannels] = useState<{ email: boolean; sms: boolean; whatsapp: boolean }>({
    email: true,
    sms: true,
    whatsapp: false,
  });
  const [sentVehicleIds, setSentVehicleIds] = useState<Set<string>>(new Set());
  const [draftPending, startDraft] = useTransition();
  const [sendPending, startSend] = useTransition();

  function selectVehicle(v: QueueVehicle) {
    setSelected(v);
    setTone("friendly");
    setDraft({ type: "idle" });
    setChannels({
      email: !!v.customerEmail,
      sms: !!v.customerPhone,
      whatsapp: false,
    });
    triggerDraft(v, "friendly");
  }

  function triggerDraft(v: QueueVehicle, t: Tone) {
    setDraft({ type: "loading" });
    startDraft(async () => {
      const result = await draftReminderPreview(v.vehicleId, v.primaryReminderType, t);
      if ("error" in result) {
        setDraft({ type: "error", message: result.error });
      } else {
        setEditEmail(result.email);
        setEditSms(result.sms);
        setDraft({ type: "ready", email: result.email, sms: result.sms, subject: result.subject });
      }
    });
  }

  function changeTone(t: Tone) {
    if (!selected) return;
    setTone(t);
    triggerDraft(selected, t);
  }

  function handleSend() {
    if (!selected || draft.type !== "ready") return;
    setDraft({ type: "sending" });
    const emailToSend = channels.email ? editEmail : null;
    const smsToSend = channels.sms || channels.whatsapp ? editSms : null;
    startSend(async () => {
      const result = await sendReminderDraft(
        selected.vehicleId,
        selected.primaryReminderType,
        emailToSend,
        smsToSend,
        channels,
      );
      if ("error" in result) {
        setDraft({ type: "error", message: result.error });
      } else {
        setDraft({ type: "sent", channels: result.channels });
        setSentVehicleIds((prev) => new Set([...prev, selected.vehicleId]));
      }
    });
  }

  function handleSkip() {
    if (!selected) return;
    const remaining = queue.filter(
      (v) => !sentVehicleIds.has(v.vehicleId) && v.vehicleId !== selected.vehicleId,
    );
    if (remaining.length > 0) {
      selectVehicle(remaining[0]);
    } else {
      setSelected(null);
      setDraft({ type: "idle" });
    }
  }

  function handleNextAfterSent() {
    const remaining = queue.filter((v) => !sentVehicleIds.has(v.vehicleId));
    if (remaining.length > 0) {
      selectVehicle(remaining[0]);
    } else {
      setSelected(null);
      setDraft({ type: "idle" });
    }
  }

  const pendingQueue = queue.filter((v) => !sentVehicleIds.has(v.vehicleId));
  const draftIndex = selected
    ? pendingQueue.findIndex((v) => v.vehicleId === selected.vehicleId) + 1
    : 0;
  const isLoading = draft.type === "loading" || draftPending;
  const isSending = draft.type === "sending" || sendPending;

  const mono = "var(--font-geist-mono, monospace)";
  const sans = "var(--font-geist-sans, system-ui, sans-serif)";

  return (
    <div
      className="-mx-6 -mb-6 lg:-mx-8 lg:-mb-8"
      style={{
        display: "grid",
        gridTemplateColumns: "260px 1fr 280px",
        minHeight: 680,
        borderTop: "1px solid var(--border)",
        fontFamily: sans,
        color: "var(--foreground)",
      }}
    >
      {/* ── LEFT: Queue ── */}
      <aside
        style={{
          background: "var(--card)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          maxHeight: "calc(100vh - 64px)",
        }}
      >
        {/* Mode tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
          {(["queue", "history"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setSelectedHistory(null); }}
              style={{
                flex: 1,
                padding: "10px 0",
                fontFamily: mono,
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase" as const,
                background: mode === m ? accentBg : "transparent",
                color: mode === m ? accent : "var(--muted-foreground)",
                borderBottom: `2px solid ${mode === m ? accent : "transparent"}`,
                borderTop: "none",
                borderLeft: "none",
                borderRight: "none",
                cursor: "pointer",
                outline: "none",
              }}
            >
              {m === "queue" ? `Queue (${pendingQueue.length})` : `History (${history.length})`}
            </button>
          ))}
        </div>

        {mode === "queue" && (
          <>
            {/* Queue header */}
            <div style={{ padding: "16px 16px 10px", borderBottom: "1px solid var(--border)" }}>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  color: "var(--muted-foreground)",
                  letterSpacing: "0.16em",
                  marginBottom: 4,
                }}
              >
                // QUEUE · {pendingQueue.length} PENDING
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>
                Ready to send
              </div>
              <div style={{ fontFamily: mono, fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>
                MOT &amp; service reminders
              </div>
            </div>

            {/* Pending vehicles */}
            {pendingQueue.length === 0 ? (
              <div
                style={{
                  padding: "20px 16px",
                  fontFamily: mono,
                  fontSize: 11,
                  color: "var(--muted-foreground)",
                  textAlign: "center",
                }}
              >
                // ALL SENT
              </div>
            ) : (
              pendingQueue.map((v) => {
                const isActive = selected?.vehicleId === v.vehicleId;
                const primaryDays =
                  v.primaryReminderType === "mot" ? v.motDays : v.svcDays;
                const label = v.primaryReminderType === "mot" ? "MOT" : "SVC";
                const dayLabel = dueDaysLabel(primaryDays);
                const dayColor = dueDaysColor(primaryDays, accent);
                const lastSentDays = v.lastReminderAt
                  ? Math.floor(
                      (Date.now() - new Date(v.lastReminderAt).getTime()) / (1000 * 60 * 60 * 24),
                    )
                  : null;

                return (
                  <button
                    key={v.vehicleId}
                    type="button"
                    onClick={() => selectVehicle(v)}
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      borderBottom: "1px solid var(--border)",
                      borderLeft: `3px solid ${isActive ? accent : "transparent"}`,
                      background: isActive ? accentBg : "transparent",
                      textAlign: "left",
                      cursor: "pointer",
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 8,
                      alignItems: "start",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: isActive ? "var(--foreground)" : "var(--foreground)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {v.customerName ?? "Unknown"}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginTop: 5,
                          flexWrap: "wrap",
                        }}
                      >
                        <Plate reg={v.registration} />
                        <span style={{ fontFamily: mono, fontSize: 10, color: dayColor }}>
                          {label} {dayLabel}
                        </span>
                      </div>
                      {lastSentDays !== null && (
                        <div
                          style={{ fontFamily: mono, fontSize: 10, color: "var(--muted-foreground)", marginTop: 4 }}
                        >
                          last sent {lastSentDays}d ago
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                      {v.customerEmail && (
                        <span
                          style={{
                            fontFamily: mono,
                            fontSize: 9,
                            color: "var(--muted-foreground)",
                            padding: "1px 5px",
                            border: "1px solid var(--border)",
                            borderRadius: 2,
                          }}
                        >
                          E
                        </span>
                      )}
                      {v.customerPhone && (
                        <span
                          style={{
                            fontFamily: mono,
                            fontSize: 9,
                            color: "var(--muted-foreground)",
                            padding: "1px 5px",
                            border: "1px solid var(--border)",
                            borderRadius: 2,
                          }}
                        >
                          SMS
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}

          </>
        )}

        {mode === "history" && (
          <>
            {history.length === 0 ? (
              <div style={{ padding: "20px 16px", fontFamily: mono, fontSize: 11, color: "var(--muted-foreground)", textAlign: "center" }}>
                // NO MESSAGES SENT YET
              </div>
            ) : (
              history.map((h) => {
                const isActive = selectedHistory?.key === h.key;
                return (
                  <button
                    key={h.key}
                    type="button"
                    onClick={() => setSelectedHistory(h)}
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      borderBottom: "1px solid var(--border)",
                      borderLeft: `3px solid ${isActive ? accent : "transparent"}`,
                      background: isActive ? accentBg : "transparent",
                      textAlign: "left",
                      cursor: "pointer",
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 8,
                      alignItems: "start",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: isActive ? "var(--foreground)" : "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {h.customerName ?? "Unknown"}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                        {h.registration && <Plate reg={h.registration} />}
                        <span style={{ fontFamily: mono, fontSize: 10, color: "var(--muted-foreground)", textTransform: "capitalize" as const }}>{h.type}</span>
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 10, color: "var(--muted-foreground)", marginTop: 3 }}>
                        {h.sentAt ? new Date(h.sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column" as const, gap: 3, alignItems: "flex-end" }}>
                      <ChannelDot status={h.email} />
                      <ChannelDot status={h.sms} />
                      <ChannelDot status={h.whatsapp} />
                    </div>
                  </button>
                );
              })
            )}
          </>
        )}
      </aside>

      {/* ── MIDDLE: Composer ── */}
      <section
        style={{
          background: "var(--background)",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          maxHeight: "calc(100vh - 64px)",
        }}
      >
        {mode === "history" && !selectedHistory && (
          <div
            style={{
              flex: 1,
              display: "grid",
              placeItems: "center",
              color: "var(--muted-foreground)",
              fontFamily: mono,
              fontSize: 12,
              letterSpacing: "0.1em",
            }}
          >
            // SELECT A MESSAGE FROM HISTORY
          </div>
        )}
        {mode === "history" && selectedHistory && (
          <div style={{ padding: "24px 32px", flex: 1 }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: "var(--muted-foreground)", letterSpacing: "0.16em", marginBottom: 4 }}>
              // SENT MESSAGE · READ ONLY
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 600, margin: "8px 0 4px", color: "var(--foreground)" }}>
              {selectedHistory.customerName ?? "Customer"}
            </h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24, fontSize: 12, alignItems: "center" }}>
              {selectedHistory.registration && <Plate reg={selectedHistory.registration} />}
              <span style={{ color: "var(--muted-foreground)", fontFamily: mono }}>·</span>
              <span style={{ fontFamily: mono, fontSize: 11, color: "var(--muted-foreground)", textTransform: "capitalize" as const }}>{selectedHistory.type}</span>
              <span style={{ color: "var(--muted-foreground)", fontFamily: mono }}>·</span>
              <span style={{ fontFamily: mono, fontSize: 11, color: "var(--muted-foreground)" }}>
                {selectedHistory.sentAt ? new Date(selectedHistory.sentAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
              </span>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              {[
                { label: "Email", status: selectedHistory.email },
                { label: "SMS", status: selectedHistory.sms },
                { label: "WhatsApp", status: selectedHistory.whatsapp },
              ].filter(c => c.status !== null).map(c => (
                <span key={c.label} style={{
                  fontFamily: mono,
                  fontSize: 10,
                  padding: "3px 8px",
                  borderRadius: 2,
                  background: c.status === "sent" ? "#13301f" : "#3a1a1a",
                  color: c.status === "sent" ? "#5fdd9d" : "#ff5b5b",
                  border: `1px solid ${c.status === "sent" ? "#2a5a3a" : "#5a2424"}`,
                  letterSpacing: "0.1em",
                }}>
                  {c.label} {c.status === "sent" ? "✓" : "✗"}
                </span>
              ))}
            </div>

            {selectedHistory.emailText && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: mono, fontSize: 10, color: "var(--muted-foreground)", letterSpacing: "0.12em", textTransform: "uppercase" as const, marginBottom: 8 }}>Email</div>
                <div style={{ fontFamily: sans, fontSize: 14, lineHeight: 1.6, color: "var(--muted-foreground)", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 4, padding: "12px 14px", whiteSpace: "pre-wrap" as const }}>
                  {selectedHistory.emailText}
                </div>
              </div>
            )}

            {selectedHistory.smsText && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: mono, fontSize: 10, color: "var(--muted-foreground)", letterSpacing: "0.12em", textTransform: "uppercase" as const, marginBottom: 8 }}>
                  SMS{selectedHistory.whatsappText ? " / WhatsApp" : ""}
                </div>
                <div style={{ fontFamily: sans, fontSize: 14, lineHeight: 1.6, color: "var(--muted-foreground)", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 4, padding: "12px 14px", whiteSpace: "pre-wrap" as const }}>
                  {selectedHistory.smsText}
                </div>
              </div>
            )}

            {!selectedHistory.emailText && !selectedHistory.smsText && (
              <div style={{ fontFamily: mono, fontSize: 12, color: "var(--muted-foreground)" }}>// MESSAGE TEXT NOT STORED</div>
            )}
          </div>
        )}
        {mode === "queue" && !selected ? (
          <div
            style={{
              flex: 1,
              display: "grid",
              placeItems: "center",
              color: "var(--muted-foreground)",
              fontFamily: mono,
              fontSize: 12,
              letterSpacing: "0.1em",
            }}
          >
            // SELECT A VEHICLE FROM THE QUEUE
          </div>
        ) : mode === "queue" && selected ? (
          <div style={{ padding: "24px 32px", flex: 1 }}>
            {/* Draft header */}
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: accent, letterSpacing: "0.16em" }}>
                // DRAFT {String(draftIndex).padStart(2, "0")} OF {String(pendingQueue.length).padStart(2, "0")}
              </span>
              {" "}
              <span style={{ fontFamily: mono, fontSize: 10, color: "var(--muted-foreground)" }}>
                {draft.type === "sent" ? "SENT" : "QUEUED · NOT SENT"}
              </span>
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 600, margin: "8px 0 4px", color: "var(--foreground)" }}>
              To {selected.customerName ?? "Customer"}
            </h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24, fontSize: 12 }}>
              <Plate reg={selected.registration} />
              <span style={{ color: "var(--muted-foreground)", fontFamily: mono }}>·</span>
              <span style={{ fontFamily: mono, fontSize: 11, color: accent }}>
                {selected.primaryReminderType.toUpperCase()}{" "}
                {dueDaysLabel(
                  selected.primaryReminderType === "mot" ? selected.motDays : selected.svcDays,
                )}
              </span>
              <span style={{ color: "var(--muted-foreground)", fontFamily: mono }}>·</span>
              <span style={{ fontFamily: mono, fontSize: 11, color: "var(--muted-foreground)" }}>
                {[selected.customerEmail && "Email", selected.customerPhone && "SMS"]
                  .filter(Boolean)
                  .join(" + ")}
              </span>
            </div>

            {/* Tone selector */}
            {draft.type !== "sent" && (
              <>
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 10,
                    color: "var(--muted-foreground)",
                    letterSpacing: "0.14em",
                    marginBottom: 10,
                  }}
                >
                  // TONE · PICK A STARTING POINT
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 1,
                    background: "var(--border)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    overflow: "hidden",
                    marginBottom: 20,
                  }}
                >
                  {TONES.map((t) => {
                    const isActive = tone === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => changeTone(t.id)}
                        disabled={isLoading || isSending}
                        style={{
                          background: isActive ? accentBg : "var(--card)",
                          borderTop: `2px solid ${isActive ? accent : "transparent"}`,
                          padding: "10px 12px",
                          cursor: "pointer",
                          textAlign: "left",
                          opacity: isLoading || isSending ? 0.5 : 1,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontFamily: mono, fontSize: 10, color: accent }}>
                            {t.n}
                          </span>
                          <span
                            style={{
                              fontFamily: mono,
                              fontSize: 11,
                              color: isActive ? "var(--foreground)" : "var(--muted-foreground)",
                              letterSpacing: "0.1em",
                            }}
                          >
                            {t.label}
                          </span>
                          {isActive && (
                            <span
                              style={{
                                fontFamily: mono,
                                fontSize: 9,
                                color: "var(--background)",
                                background: accent,
                                padding: "1px 5px",
                                borderRadius: 2,
                              }}
                            >
                              {isLoading ? "..." : "ACTIVE"}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Loading state */}
            {isLoading && draft.type === "loading" && (
              <div
                style={{
                  padding: "40px 0",
                  textAlign: "center",
                  fontFamily: mono,
                  fontSize: 12,
                  color: accent,
                  letterSpacing: "0.1em",
                }}
              >
                // CLAUDE IS DRAFTING…
              </div>
            )}

            {/* Error */}
            {draft.type === "error" && (
              <div
                style={{
                  padding: "12px 16px",
                  background: "#3a1a1a",
                  border: "1px solid #5a2424",
                  borderRadius: 4,
                  fontFamily: mono,
                  fontSize: 12,
                  color: "#ff5b5b",
                  marginBottom: 16,
                }}
              >
                {draft.message}
              </div>
            )}

            {/* Draft ready — edit area */}
            {(draft.type === "ready" || draft.type === "sending") && (
              <>
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 10,
                    color: "var(--muted-foreground)",
                    letterSpacing: "0.14em",
                    marginBottom: 10,
                  }}
                >
                  // EDIT BEFORE SEND
                </div>

                {/* Channel tabs */}
                <div style={{ display: "flex", gap: 1, marginBottom: 12 }}>
                  {[
                    { key: "email" as const, label: "Email", avail: !!selected.customerEmail },
                    { key: "sms" as const, label: "SMS", avail: !!selected.customerPhone },
                    { key: "whatsapp" as const, label: "WhatsApp", avail: !!selected.customerPhone },
                  ]
                    .filter((c) => c.avail)
                    .map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() =>
                          setChannels((prev) => ({ ...prev, [c.key]: !prev[c.key] }))
                        }
                        disabled={isSending}
                        style={{
                          fontFamily: mono,
                          fontSize: 11,
                          padding: "4px 10px",
                          borderRadius: 2,
                          border: `1px solid ${channels[c.key] ? accent : "var(--border)"}`,
                          background: channels[c.key] ? accentBg : "transparent",
                          color: channels[c.key] ? accent : "var(--muted-foreground)",
                          cursor: "pointer",
                        }}
                      >
                        {c.label} {channels[c.key] ? "✓" : "—"}
                      </button>
                    ))}
                </div>

                {/* Email text */}
                {selected.customerEmail && channels.email && (
                  <div style={{ marginBottom: 12 }}>
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: 10,
                        color: "var(--muted-foreground)",
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        marginBottom: 6,
                      }}
                    >
                      Email
                    </div>
                    <textarea
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      disabled={isSending}
                      rows={6}
                      style={{
                        width: "100%",
                        fontFamily: sans,
                        fontSize: 14,
                        lineHeight: 1.6,
                        color: "var(--foreground)",
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        padding: "12px 14px",
                        resize: "vertical",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                )}

                {/* SMS text */}
                {selected.customerPhone && (channels.sms || channels.whatsapp) && (
                  <div style={{ marginBottom: 16 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: mono,
                          fontSize: 10,
                          color: "var(--muted-foreground)",
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                        }}
                      >
                        SMS{channels.whatsapp ? " / WhatsApp" : ""}
                      </span>
                      <span style={{ fontFamily: mono, fontSize: 10, color: "var(--muted-foreground)" }}>
                        {editSms.length} chars
                        {editSms.length > 160 && (
                          <span style={{ color: accent }}> · {Math.ceil(editSms.length / 160)} segments</span>
                        )}
                      </span>
                    </div>
                    <textarea
                      value={editSms}
                      onChange={(e) => setEditSms(e.target.value)}
                      disabled={isSending}
                      rows={3}
                      style={{
                        width: "100%",
                        fontFamily: sans,
                        fontSize: 14,
                        lineHeight: 1.6,
                        color: "var(--foreground)",
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        padding: "10px 14px",
                        resize: "vertical",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                )}

                {/* Send / skip */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontFamily: mono, fontSize: 11, color: "var(--muted-foreground)" }}>
                    {[
                      channels.email && selected.customerEmail && "email",
                      channels.sms && selected.customerPhone && "SMS",
                      channels.whatsapp && selected.customerPhone && "WhatsApp",
                    ]
                      .filter(Boolean)
                      .join(" + ") || "no channel selected"}
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={handleSkip}
                      disabled={isSending}
                      style={{
                        fontFamily: mono,
                        fontSize: 12,
                        padding: "7px 14px",
                        borderRadius: 2,
                        border: "1px solid var(--border)",
                        background: "transparent",
                        color: "var(--muted-foreground)",
                        cursor: "pointer",
                        opacity: isSending ? 0.5 : 1,
                      }}
                    >
                      Skip
                    </button>
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={
                        isSending ||
                        (!channels.email && !channels.sms && !channels.whatsapp)
                      }
                      style={{
                        fontFamily: mono,
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "7px 18px",
                        borderRadius: 2,
                        border: "1px solid #c9a435",
                        background: "#f4d35e",
                        color: "var(--background)",
                        cursor: "pointer",
                        opacity: isSending ? 0.6 : 1,
                      }}
                    >
                      {isSending ? "Sending…" : "Send now →"}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Sent confirmation */}
            {draft.type === "sent" && (
              <div
                style={{
                  padding: "20px 22px",
                  background: "#13301f",
                  border: "1px solid #2a5a3a",
                  borderRadius: 6,
                }}
              >
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 11,
                    color: "#5fdd9d",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    marginBottom: 6,
                  }}
                >
                  // SENT ✓
                </div>
                <div style={{ fontSize: 14, color: "var(--foreground)" }}>
                  Reminder sent via{" "}
                  {draft.channels.length > 0 ? draft.channels.join(" + ") : "selected channels"}.
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={handleNextAfterSent}
                    style={{
                      fontFamily: mono,
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "7px 18px",
                      borderRadius: 2,
                      border: "1px solid #c9a435",
                      background: "#f4d35e",
                      color: "var(--background)",
                      cursor: "pointer",
                    }}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </section>

      {/* ── RIGHT: Customer context ── */}
      <aside
        style={{
          background: "var(--card)",
          borderLeft: "1px solid var(--border)",
          padding: "20px 18px",
          overflowY: "auto",
          maxHeight: "calc(100vh - 64px)",
        }}
      >
        {!selected ? (
          <div
            style={{
              fontFamily: mono,
              fontSize: 11,
              color: "var(--muted-foreground)",
              letterSpacing: "0.14em",
            }}
          >
            // SELECT A VEHICLE
          </div>
        ) : (
          <>
            <div
              style={{
                fontFamily: mono,
                fontSize: 10,
                color: "var(--muted-foreground)",
                letterSpacing: "0.16em",
                marginBottom: 6,
              }}
            >
              // CUSTOMER CARD
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--foreground)", marginBottom: 2 }}>
              {selected.customerName ?? "Unknown"}
            </div>
            {selected.customerPhone && (
              <div style={{ fontFamily: mono, fontSize: 12, color: "var(--muted-foreground)" }}>
                {selected.customerPhone}
              </div>
            )}
            {selected.customerEmail && (
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 11,
                  color: "var(--muted-foreground)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {selected.customerEmail}
              </div>
            )}

            <Link
              href={`/staff/customers/${selected.customerId}`}
              style={{
                display: "inline-block",
                marginTop: 10,
                fontFamily: mono,
                fontSize: 10,
                color: accent,
                textDecoration: "none",
                padding: "3px 8px",
                border: "1px solid #3a2c14",
                borderRadius: 2,
                background: accentBg,
              }}
            >
              View customer →
            </Link>

            {/* Vehicle */}
            <div
              style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop: "1px dashed var(--border)",
              }}
            >
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  color: "var(--muted-foreground)",
                  letterSpacing: "0.12em",
                  marginBottom: 8,
                }}
              >
                VEHICLE
              </div>
              <div style={{ marginBottom: 6 }}>
                <Plate reg={selected.registration} />
              </div>
              <div style={{ fontSize: 13, color: "var(--foreground)", marginTop: 6 }}>
                {[selected.year, selected.make, selected.model].filter(Boolean).join(" ") || "—"}
              </div>

              {selected.motExpiry && (
                <div style={{ marginTop: 10 }}>
                  {[
                    {
                      label: "MOT",
                      days: selected.motDays,
                      date: selected.motExpiry,
                    },
                    {
                      label: "Service",
                      days: selected.svcDays,
                      date: selected.serviceDue,
                    },
                  ]
                    .filter((r) => r.date)
                    .map((r) => (
                      <div
                        key={r.label}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "60px 1fr",
                          gap: 8,
                          padding: "8px 0",
                          borderTop: "1px dashed var(--border)",
                          alignItems: "center",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: mono,
                            fontSize: 10,
                            color: "var(--muted-foreground)",
                            letterSpacing: "0.1em",
                          }}
                        >
                          {r.label.toUpperCase()}
                        </span>
                        <div>
                          <span
                            style={{
                              fontFamily: mono,
                              fontSize: 12,
                              color: dueDaysColor(r.days, accent),
                              fontWeight: 600,
                            }}
                          >
                            {dueDaysLabel(r.days)}
                          </span>
                          <span style={{ fontFamily: mono, fontSize: 11, color: "var(--muted-foreground)", marginLeft: 6 }}>
                            {r.date
                              ? new Date(r.date).toLocaleDateString("en-GB", {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })
                              : ""}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Last contact */}
            {selected.lastReminderAt && (
              <div
                style={{
                  marginTop: 16,
                  paddingTop: 16,
                  borderTop: "1px dashed var(--border)",
                }}
              >
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 10,
                    color: "var(--muted-foreground)",
                    letterSpacing: "0.12em",
                    marginBottom: 6,
                  }}
                >
                  LAST CONTACT
                </div>
                <div style={{ fontFamily: mono, fontSize: 12, color: "var(--muted-foreground)" }}>
                  {new Date(selected.lastReminderAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </div>
                <div style={{ fontFamily: mono, fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>
                  {Math.floor(
                    (Date.now() - new Date(selected.lastReminderAt).getTime()) /
                      (1000 * 60 * 60 * 24),
                  )}
                  d ago
                </div>
              </div>
            )}

            {/* Channel availability */}
            <div
              style={{
                marginTop: 16,
                paddingTop: 16,
                borderTop: "1px dashed var(--border)",
              }}
            >
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  color: "var(--muted-foreground)",
                  letterSpacing: "0.12em",
                  marginBottom: 8,
                }}
              >
                CHANNELS AVAILABLE
              </div>
              {[
                {
                  label: "Email",
                  avail: !!selected.customerEmail,
                  value: selected.customerEmail,
                },
                {
                  label: "SMS",
                  avail: !!selected.customerPhone,
                  value: selected.customerPhone,
                },
                {
                  label: "WhatsApp",
                  avail: !!selected.customerPhone,
                  value: selected.customerPhone,
                },
              ].map((c) => (
                <div
                  key={c.label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "5px 0",
                    fontSize: 12,
                    color: c.avail ? "var(--foreground)" : "var(--muted-foreground)",
                  }}
                >
                  <span style={{ fontFamily: mono, fontSize: 11 }}>{c.label}</span>
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 9,
                      padding: "2px 6px",
                      borderRadius: 2,
                      background: c.avail ? "#13301f" : "var(--muted)",
                      color: c.avail ? "#5fdd9d" : "var(--muted-foreground)",
                      border: `1px solid ${c.avail ? "#2a5a3a" : "var(--border)"}`,
                    }}
                  >
                    {c.avail ? "AVAILABLE" : "NO DATA"}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
