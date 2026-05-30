"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

const BUSINESS_NAME = "Bay Area Plumbing & Heating";
const LEADS_STORAGE_KEY = "quotecatch-owner-leads";
const QUICK_REPLIES = [
  "Water heater leaking",
  "AC not cooling",
  "Clogged drain",
  "No heat",
];

type UploadedImage = {
  dataUrl: string;
  name: string;
};

type LeadTicket = {
  id: string;
  createdAt: string;
  name: string;
  phone: string;
  addressZip: string;
  inServiceArea: boolean;
  trade: string;
  problem: string;
  photosSummary: string;
  urgency: "routine" | "urgent" | "emergency";
  preferredTime: string;
  estimateLow: number | null;
  estimateHigh: number | null;
  estimateConfident: boolean;
  recommendedNextStep: string;
  flags: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: UploadedImage;
  ticket?: LeadTicket;
  estimate?: EstimateSummary;
  showOnSiteCard?: boolean;
};

type ViewMode = "customer" | "owner";
type StepKey = "describe" | "estimate" | "connect";
type EstimateSummary = {
  low: number | null;
  high: number | null;
  confident: boolean;
  diagnostic: boolean;
};

const starterMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content: `Hi, I’m QuoteCatch for ${BUSINESS_NAME}. What can we help with today? A photo helps me give a faster preliminary range.`,
  },
];

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatMoney(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    style: "currency",
    currency: "USD",
  }).format(value);
}

function normalizeText(value: unknown, fallback = "Missing") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseAssistantResponse(reply: string) {
  const ticketMatch = reply.match(
    /<<<LEAD_TICKET>>>\s*([\s\S]*?)\s*<<<END_TICKET>>>/,
  );
  const cleanReply = reply
    .replace(/<<<LEAD_TICKET>>>[\s\S]*?<<<END_TICKET>>>/g, "")
    .trim();

  if (!ticketMatch?.[1]) {
    return { cleanReply, ticket: undefined };
  }

  try {
    const rawTicket = JSON.parse(ticketMatch[1]) as Record<string, unknown>;
    const rawUrgency = normalizeText(rawTicket.urgency, "routine").toLowerCase();
    const urgency: LeadTicket["urgency"] =
      rawUrgency === "emergency" || rawUrgency === "urgent"
        ? rawUrgency
        : "routine";

    const ticket: LeadTicket = {
      id: makeId(),
      createdAt: new Date().toISOString(),
      name: normalizeText(rawTicket.name),
      phone: normalizeText(rawTicket.phone),
      addressZip: normalizeText(rawTicket.addressZip),
      inServiceArea: Boolean(rawTicket.inServiceArea),
      trade: normalizeText(rawTicket.trade),
      problem: normalizeText(rawTicket.problem),
      photosSummary: normalizeText(rawTicket.photosSummary, "none"),
      urgency,
      preferredTime: normalizeText(rawTicket.preferredTime),
      estimateLow: normalizeNumber(rawTicket.estimateLow),
      estimateHigh: normalizeNumber(rawTicket.estimateHigh),
      estimateConfident: Boolean(rawTicket.estimateConfident),
      recommendedNextStep: normalizeText(rawTicket.recommendedNextStep),
      flags: normalizeText(rawTicket.flags, "none"),
    };

    return { cleanReply, ticket };
  } catch {
    return { cleanReply, ticket: undefined };
  }
}

function shouldShowOnSiteCard(content: string, ticket?: LeadTicket) {
  if (ticket) {
    return !ticket.estimateConfident || ticket.estimateLow === null;
  }

  return /on-site visit needed|on-site diagnostic|onsite diagnostic|diagnostic visit (is )?needed|can't give an exact|cannot give an exact|not enough info/i.test(
    content,
  );
}

function parseEstimateSummary(content: string, ticket?: LeadTicket): EstimateSummary | undefined {
  if (ticket) {
    return {
      low: ticket.estimateLow,
      high: ticket.estimateHigh,
      confident: ticket.estimateConfident,
      diagnostic: !ticket.estimateConfident || ticket.estimateLow === null,
    };
  }

  const rangeMatch = content.match(/\$([\d,]+)\s*[–-]\s*\$([\d,]+)/);
  if (rangeMatch) {
    return {
      low: normalizeNumber(rangeMatch[1]),
      high: normalizeNumber(rangeMatch[2]),
      confident: true,
      diagnostic: false,
    };
  }

  if (shouldShowOnSiteCard(content)) {
    return {
      low: 89,
      high: 149,
      confident: false,
      diagnostic: true,
    };
  }

  return undefined;
}

function getCurrentStep(messages: ChatMessage[], emergencyActive: boolean): StepKey {
  if (emergencyActive || messages.some((message) => message.ticket)) {
    return "connect";
  }

  if (messages.some((message) => message.estimate || message.showOnSiteCard)) {
    return "estimate";
  }

  return "describe";
}

function sortLeads(leads: LeadTicket[]) {
  const urgencyRank = { emergency: 0, urgent: 1, routine: 2 };
  return [...leads].sort((a, b) => {
    const rankDiff = urgencyRank[a.urgency] - urgencyRank[b.urgency];
    if (rankDiff !== 0) {
      return rankDiff;
    }

    return (
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  });
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }

    return part;
  });
}

function MarkdownReply({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/).filter(Boolean);

  return (
    <>
      {blocks.map((block, index) => {
        const lines = block.split("\n").filter(Boolean);
        const isList = lines.every((line) => /^[-*]\s+/.test(line.trim()));

        if (isList) {
          return (
            <ul key={`${block}-${index}`}>
              {lines.map((line) => (
                <li key={line}>{renderInlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }

        return <p key={`${block}-${index}`}>{renderInlineMarkdown(block)}</p>;
      })}
    </>
  );
}

function StepIndicator({ currentStep }: { currentStep: StepKey }) {
  const steps: Array<{ key: StepKey; label: string }> = [
    { key: "describe", label: "1 Describe" },
    { key: "estimate", label: "2 Estimate" },
    { key: "connect", label: "3 Connect" },
  ];

  return (
    <div className="step-indicator" aria-label="Conversation progress">
      {steps.map((step) => (
        <span className={currentStep === step.key ? "active" : ""} key={step.key}>
          {step.label}
        </span>
      ))}
    </div>
  );
}

function EstimateCard({
  estimate,
  nextStep,
}: {
  estimate: EstimateSummary;
  nextStep?: string;
}) {
  if (estimate.diagnostic || !estimate.confident || estimate.low === null) {
    return (
      <div className="outcome-card onsite-card">
        <p className="outcome-label">On-site visit needed</p>
        <h3>Diagnostic visit recommended</h3>
        <p>
          The safest next step is a technician check before quoting. Diagnostic
          visits are typically $89-$149.
        </p>
      </div>
    );
  }

  const low = formatMoney(estimate.low);
  const high = formatMoney(estimate.high ?? estimate.low);

  return (
    <div className="outcome-card estimate-card">
      <div className="estimate-heading">
        <p className="outcome-label">Estimate</p>
        <span>PRELIMINARY - confirmed on site</span>
      </div>
      <h3>
        {low}
        {high && high !== low ? `-${high}` : ""}
      </h3>
      <p>{nextStep || "The team can confirm the exact quote and timing."}</p>
    </div>
  );
}

function OwnerInbox({
  leads,
  onAction,
}: {
  leads: LeadTicket[];
  onAction: (message: string) => void;
}) {
  const sortedLeads = sortLeads(leads);

  if (!sortedLeads.length) {
    return (
      <section className="owner-empty">
        <p className="eyebrow-dark">Owner Inbox</p>
        <h2>No captured leads yet</h2>
        <p>
          Run a customer chat with a problem, photo, and ZIP. Qualified tickets
          will appear here ready to confirm.
        </p>
      </section>
    );
  }

  return (
    <section className="owner-list" aria-label="Owner Inbox leads">
      {sortedLeads.map((lead) => (
        <article className={`owner-card ${lead.urgency}`} key={lead.id}>
          <div className="owner-card-top">
            <div>
              <p className="ticket-kicker">{lead.trade}</p>
              <h2>{lead.problem}</h2>
            </div>
            <span className={`urgency-pill ${lead.urgency}`}>
              {lead.urgency === "emergency"
                ? "Emergency"
                : lead.urgency === "urgent"
                  ? "Urgent"
                  : "Routine"}
            </span>
          </div>

          <dl className="ticket-grid">
            <div>
              <dt>Name</dt>
              <dd>{lead.name}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{lead.phone}</dd>
            </div>
            <div>
              <dt>Address/ZIP</dt>
              <dd>
                {lead.addressZip}{" "}
                <span>{lead.inServiceArea ? "in area" : "out of area"}</span>
              </dd>
            </div>
            <div>
              <dt>Preferred</dt>
              <dd>{lead.preferredTime}</dd>
            </div>
            <div>
              <dt>Photos</dt>
              <dd>{lead.photosSummary}</dd>
            </div>
            <div>
              <dt>Estimate</dt>
              <dd>
                {lead.estimateConfident && lead.estimateLow !== null
                  ? `${formatMoney(lead.estimateLow)}-${formatMoney(
                      lead.estimateHigh ?? lead.estimateLow,
                    )}`
                  : "On-site diagnostic"}
              </dd>
            </div>
          </dl>

          <p className="next-step">{lead.recommendedNextStep}</p>
          <p className="flags">Flags: {lead.flags}</p>

          <div className="owner-actions">
            <button
              type="button"
              onClick={() => onAction("Marked ready to confirm and schedule.")}
            >
              Confirm & Schedule
            </button>
            <button
              type="button"
              onClick={() => onAction("Call customer action queued for demo.")}
            >
              Call customer
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [leads, setLeads] = useState<LeadTicket[]>([]);
  const [leadsLoaded, setLeadsLoaded] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("customer");
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState<UploadedImage | undefined>();
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [emergencyActive, setEmergencyActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentStep = getCurrentStep(messages, emergencyActive);

  useEffect(() => {
    const stored = window.localStorage.getItem(LEADS_STORAGE_KEY);
    if (!stored) {
      setLeadsLoaded(true);
      return;
    }

    try {
      setLeads(JSON.parse(stored) as LeadTicket[]);
    } catch {
      window.localStorage.removeItem(LEADS_STORAGE_KEY);
    } finally {
      setLeadsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!leadsLoaded) {
      return;
    }

    window.localStorage.setItem(LEADS_STORAGE_KEY, JSON.stringify(leads));
  }, [leads, leadsLoaded]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const canSend = useMemo(
    () => (draft.trim().length > 0 || image) && !isSending,
    [draft, image, isSending],
  );

  async function handleImageSelect(file: File | undefined) {
    setError("");

    if (!file) {
      setImage(undefined);
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("Please choose an image under 10 MB.");
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Unable to read image."));
      reader.readAsDataURL(file);
    });

    setImage({ dataUrl, name: file.name });
  }

  function addLead(ticket: LeadTicket) {
    setLeads((current) => [ticket, ...current]);
    if (ticket.urgency === "emergency") {
      setEmergencyActive(true);
    }
  }

  async function submitMessage(text: string, selectedImage = image) {
    const trimmedText = text.trim();
    if ((!trimmedText && !selectedImage) || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: trimmedText,
      image: selectedImage,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setImage(undefined);
    setError("");
    setIsSending(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content, image }) => ({
            role,
            content,
            image,
          })),
        }),
      });

      const payload = (await response.json()) as {
        reply?: string;
        error?: string;
      };

      if (!response.ok || !payload.reply) {
        throw new Error(payload.error || "No reply returned.");
      }

      const { cleanReply, ticket } = parseAssistantResponse(payload.reply);
      const estimate = parseEstimateSummary(cleanReply, ticket);
      if (ticket) {
        addLead(ticket);
      }

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          content: cleanReply,
          ticket,
          estimate,
          showOnSiteCard: shouldShowOnSiteCard(cleanReply, ticket),
        },
      ]);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Something went wrong.",
      );
    } finally {
      setIsSending(false);
    }
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage(draft);
  }

  function resetConversation() {
    setMessages(starterMessages);
    setDraft("");
    setImage(undefined);
    setError("");
    setEmergencyActive(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function connectWithTeam() {
    void submitMessage(
      "Yes, connect me with the team to confirm and schedule. Preferred time: soonest available.",
      undefined,
    );
  }

  return (
    <main className="app-shell">
      {toast ? <div className="toast">{toast}</div> : null}

      <section className="app-panel" aria-label="QuoteCatch app">
        <header className="topbar">
          <div>
            <p className="eyebrow">{BUSINESS_NAME}</p>
            <h1>QuoteCatch</h1>
          </div>

          <div className="header-actions">
            <div className="mode-toggle" aria-label="View selector">
              <button
                className={viewMode === "customer" ? "active" : ""}
                type="button"
                onClick={() => setViewMode("customer")}
              >
                Customer
              </button>
              <button
                className={viewMode === "owner" ? "active" : ""}
                type="button"
                onClick={() => setViewMode("owner")}
              >
                Owner Inbox
              </button>
            </div>
            <button
              className="reset-button"
              type="button"
              onClick={resetConversation}
            >
              Reset
            </button>
          </div>
        </header>

        {emergencyActive ? (
          <div className="emergency-banner">
            Emergency - owner is being alerted now
          </div>
        ) : null}
        <StepIndicator currentStep={currentStep} />

        {viewMode === "customer" ? (
          <>
            <div className="message-list" aria-live="polite">
              {messages.map((message) => (
                <article
                  className={`message ${message.role}`}
                  key={message.id}
                  aria-label={`${message.role} message`}
                >
                  {message.image ? (
                    <img
                      alt={message.image.name}
                      className="message-image"
                      src={message.image.dataUrl}
                    />
                  ) : null}

                  {message.content ? <MarkdownReply content={message.content} /> : null}

                  {message.estimate ? (
                    <>
                      <EstimateCard
                        estimate={message.estimate}
                        nextStep={message.ticket?.recommendedNextStep}
                      />
                      {!message.ticket ? (
                        <button
                          className="connect-button"
                          disabled={isSending}
                          type="button"
                          onClick={connectWithTeam}
                        >
                          Connect me with the team
                        </button>
                      ) : null}
                    </>
                  ) : null}

                  {message.ticket ? (
                    <div className="success-state">
                      ✅ Sent to {BUSINESS_NAME} - they&apos;ll confirm your
                      exact quote and time shortly.
                    </div>
                  ) : null}
                </article>
              ))}

              {messages.length === 1 && !isSending ? (
                <div className="quick-replies" aria-label="Common problems">
                  {QUICK_REPLIES.map((reply) => (
                    <button
                      key={reply}
                      type="button"
                      onClick={() => void submitMessage(reply, undefined)}
                    >
                      {reply}
                    </button>
                  ))}
                </div>
              ) : null}

              {isSending ? (
                <article className="message assistant status">
                  Preparing intake...
                </article>
              ) : null}
            </div>

            {error ? <p className="error-banner">{error}</p> : null}

            <form className="composer" onSubmit={sendMessage}>
              {image ? (
                <div className="preview-row">
                  <img
                    alt={image.name}
                    className="preview-image"
                    src={image.dataUrl}
                  />
                  <span>{image.name}</span>
                  <button
                    aria-label="Remove image"
                    className="icon-button"
                    type="button"
                    onClick={() => {
                      setImage(undefined);
                      if (fileInputRef.current) {
                        fileInputRef.current.value = "";
                      }
                    }}
                  >
                    X
                  </button>
                </div>
              ) : null}

              <div className="input-row">
                <label className="upload-button" aria-label="Upload photo">
                  Add photo
                  <input
                    ref={fileInputRef}
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    capture="environment"
                    type="file"
                    onChange={(event) =>
                      void handleImageSelect(event.target.files?.[0])
                    }
                  />
                </label>
                <textarea
                  aria-label="Message"
                  placeholder="Tell us what is happening..."
                  rows={1}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <button className="send-button" disabled={!canSend} type="submit">
                  Send
                </button>
              </div>
            </form>
          </>
        ) : (
          <OwnerInbox leads={leads} onAction={setToast} />
        )}
      </section>
    </main>
  );
}
