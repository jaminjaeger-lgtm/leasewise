import { useState, useRef, useCallback, useEffect } from "react";

const STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
  "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
  "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
  "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire",
  "New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio",
  "Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota",
  "Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia",
  "Wisconsin","Wyoming","Outside the US"
];

const buildSystemPrompt = (state, docType) => `You are LeaseWise, an expert assistant that helps small landlords understand rental documents.
Your job is to read a lease, addendum, or landlord-tenant document and return a structured JSON analysis.

IMPORTANT CONTEXT:
- The landlord is located in: ${state}
- Document type: ${docType === "template" ? "A blank template being evaluated before use" : "A completed, filled-out agreement ready for or already signed"}

${docType === "template"
  ? "Since this is a blank template, focus on: clause quality, missing landlord protections, legally questionable language, and what should be added or changed. Do NOT flag blank fields as issues — that is expected."
  : "Since this is a completed agreement, check both the clause quality AND the filled-in details — rent amounts, dates, deposit amounts, party names, etc."}

${state !== "Outside the US"
  ? `Apply ${state}-specific landlord-tenant law where relevant. Flag anything that may violate or conflict with ${state} state law, and confirm when key clauses correctly follow ${state} requirements.`
  : "Apply general US landlord-tenant best practices since jurisdiction is outside the US."}

You must respond with ONLY valid JSON — no markdown, no preamble, no explanation outside the JSON object.

Return this exact structure:
{
  "verdict": "green" | "amber" | "red",
  "verdictTitle": "short punchy verdict title",
  "verdictSummary": "2-3 sentence plain English overall take on this document",
  "summary": "3-5 sentence plain English summary of what this document actually says",
  "flags": [
    {
      "type": "ok" | "warn" | "danger",
      "title": "short flag title",
      "detail": "plain English explanation from the landlord's perspective"
    }
  ]
}

Rules:
- verdict: green = looks standard and solid, amber = items need attention, red = serious issues
- Include 5-6 flags mixing ok/warn/danger as appropriate — we need enough to make the paywall compelling
- Write at 8th grade reading level, no legal jargon
- Always write from the landlord's perspective
- ONLY return the JSON object, nothing else`;

const COLORS = {
  cream: "#F7F4EF", ink: "#1A1A18", inkMuted: "#6B6B65",
  gold: "#C4921A", goldLight: "#F5E8C8",
  red: "#C0392B", redLight: "#FDECEA",
  amber: "#D4700A", amberLight: "#FEF3E2",
  green: "#2E7D4F", greenLight: "#EAF5EE",
  border: "rgba(26,26,24,0.12)", white: "#FFFFFF",
};

const verdictConfig = {
  green: { label: "Looking Good", bg: COLORS.greenLight, border: "rgba(46,125,79,0.2)", dot: COLORS.green, text: COLORS.green },
  amber: { label: "Needs Attention", bg: COLORS.amberLight, border: "rgba(212,112,10,0.2)", dot: COLORS.amber, text: COLORS.amber },
  red:   { label: "Serious Issues Found", bg: COLORS.redLight, border: "rgba(192,57,43,0.2)", dot: COLORS.red, text: COLORS.red },
};

const flagConfig = {
  ok:     { bg: COLORS.greenLight, dot: COLORS.green },
  warn:   { bg: COLORS.amberLight, dot: COLORS.amber },
  danger: { bg: COLORS.redLight,   dot: COLORS.red   },
};

const FREE_FLAGS = 2;

export default function LeaseWise() {
  const [screen, setScreen]         = useState("intake");
  const [state, setState]           = useState("");
  const [docType, setDocType]       = useState("");
  const [docText, setDocText]       = useState("");
  const [pdfBase64, setPdfBase64]   = useState(null);
  const [pdfName, setPdfName]       = useState("");
  const [dragOver, setDragOver]     = useState(false);
  const [error, setError]           = useState("");
  const [loadingMsg, setLoadingMsg] = useState("");
  const [results, setResults]       = useState(null);
  const [unlocked, setUnlocked]     = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const fileInputRef                = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("unlocked") === "true") {
      const saved = sessionStorage.getItem("lw_results");
      const savedState = sessionStorage.getItem("lw_state");
      const savedDocType = sessionStorage.getItem("lw_doctype");
      if (saved) {
        try {
          setResults(JSON.parse(saved));
          if (savedState) setState(savedState);
          if (savedDocType) setDocType(savedDocType);
          setUnlocked(true);
          setScreen("results");
          window.history.replaceState({}, "", "/");
        } catch(e) {}
      }
    }
  }, []);

  const loadFile = useCallback((file) => {
    if (!file) return;
    setError("");
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPdfBase64(e.target.result.split(",")[1]);
        setPdfName(file.name);
        setDocText("");
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => { setPdfBase64(null); setPdfName(""); setDocText(e.target.result); };
      reader.readAsText(file);
    }
  }, []);

  const proceedToUpload = () => {
    if (!state) { setError("Please select your state."); return; }
    if (!docType) { setError("Please select a document type."); return; }
    setError("");
    setScreen("upload");
  };

  const analyze = async () => {
    const hasText = docText.trim() && !docText.trim().startsWith("%PDF");
    if (!pdfBase64 && !hasText) { setError("Please paste document text or upload a file first."); return; }
    setError("");
    setUnlocked(false);
    setScreen("loading");

    const msgs = ["Reading your document…", "Identifying key clauses…", `Checking ${state} landlord-tenant law…`, "Writing your plain English summary…"];
    let i = 0;
    setLoadingMsg(msgs[0]);
    const interval = setInterval(() => { i = (i + 1) % msgs.length; setLoadingMsg(msgs[i]); }, 2200);

    try {
      const userContent = pdfBase64
        ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } }, { type: "text", text: "Please analyze this rental document." }]
        : `Please analyze this document:\n\n${docText.slice(0, 8000)}`;

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1000,
          system: buildSystemPrompt(state, docType),
          messages: [{ role: "user", content: userContent }],
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `API error ${response.status}`);
      }

      const data = await response.json();
      const raw = data.content.map((b) => b.text || "").join("").trim();
      const result = JSON.parse(raw.replace(/```json|```/g, "").trim());
      setResults(result);
      setScreen("results");
    } catch (err) {
      setScreen("upload");
      setError("Analysis failed: " + (err.message || "Unknown error."));
    } finally {
      clearInterval(interval);
    }
  };

  const handleCheckout = async () => {
    setCheckoutLoading(true);
    try {
      sessionStorage.setItem("lw_results", JSON.stringify(results));
      sessionStorage.setItem("lw_state", state);
      sessionStorage.setItem("lw_doctype", docType);
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceType: "single" }),
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err) {
      alert("Checkout failed: " + err.message);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const restart = () => {
    setScreen("intake"); setResults(null); setDocText("");
    setPdfBase64(null); setPdfName(""); setState(""); setDocType("");
    setError(""); setUnlocked(false);
  };

  const s = {
    root:   { fontFamily: "'DM Sans','Helvetica Neue',sans-serif", background: COLORS.cream, minHeight: "100vh", color: COLORS.ink },
    header: { borderBottom: `1px solid ${COLORS.border}`, padding: "1.1rem 1.75rem", display: "flex", alignItems: "center", justifyContent: "space-between", background: COLORS.cream, position: "sticky", top: 0, zIndex: 10 },
    logo:   { fontSize: "1.35rem", fontWeight: 600, display: "flex", alignItems: "center", gap: 8, letterSpacing: "-0.01em" },
    logoDot:{ width: 8, height: 8, background: COLORS.gold, borderRadius: "50%" },
    badge:  { fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", background: COLORS.goldLight, color: COLORS.gold, padding: "4px 10px", borderRadius: 20 },
    main:   { maxWidth: 720, margin: "0 auto", padding: "2.5rem 1.25rem 4rem" },
    hero:   { textAlign: "center", marginBottom: "2.25rem" },
    h1:     { fontSize: "clamp(1.75rem,5vw,2.5rem)", fontWeight: 600, lineHeight: 1.2, marginBottom: "0.75rem", letterSpacing: "-0.02em" },
    heroP:  { fontSize: "1rem", color: COLORS.inkMuted, maxWidth: 460, margin: "0 auto", fontWeight: 300, lineHeight: 1.65 },
    card:   { background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "1.75rem", marginBottom: "1rem" },
    label:  { fontSize: "0.75rem", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: COLORS.inkMuted, marginBottom: 10, display: "block" },
    select: { width: "100%", padding: "0.75rem 1rem", border: `1px solid ${COLORS.border}`, borderRadius: 8, fontFamily: "inherit", fontSize: "0.9rem", color: COLORS.ink, background: COLORS.white, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236B6B65' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", cursor: "pointer" },
    docTypeGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
    nextBtn: { width: "100%", padding: "0.9rem", background: COLORS.ink, color: COLORS.cream, border: "none", borderRadius: 10, fontFamily: "inherit", fontSize: "0.975rem", fontWeight: 500, cursor: "pointer", marginTop: "0.5rem", letterSpacing: "0.01em" },
    backBtn: { background: "none", border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "0.5rem 1rem", fontFamily: "inherit", fontSize: "0.8rem", color: COLORS.inkMuted, cursor: "pointer", marginBottom: "1.25rem" },
    divider: { display: "flex", alignItems: "center", gap: 10, margin: "1.1rem 0", color: COLORS.inkMuted, fontSize: "0.75rem", letterSpacing: "0.08em", textTransform: "uppercase" },
    divLine: { flex: 1, height: 1, background: COLORS.border },
    textarea:{ width: "100%", minHeight: 155, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "0.875rem 1rem", fontFamily: "inherit", fontSize: "0.875rem", color: COLORS.ink, background: COLORS.white, resize: "vertical", lineHeight: 1.65, outline: "none" },
    error:  { background: COLORS.redLight, border: `1px solid rgba(192,57,43,0.2)`, borderRadius: 10, padding: "0.875rem 1.1rem", fontSize: "0.875rem", color: COLORS.red, marginTop: "0.875rem" },
    contextPill: { display: "inline-flex", alignItems: "center", gap: 6, background: COLORS.goldLight, color: COLORS.gold, fontSize: "0.75rem", fontWeight: 500, padding: "4px 10px", borderRadius: 20, marginBottom: "1.25rem" },
    section: { background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, marginBottom: "0.875rem", overflow: "hidden" },
    sectionHeader: { padding: "0.875rem 1.25rem", borderBottom: `1px solid ${COLORS.border}` },
    sectionTitle:  { fontSize: "0.75rem", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: COLORS.inkMuted },
    sectionBody:   { padding: "1.1rem 1.25rem" },
    restartBtn: { background: "none", border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "0.5rem 1rem", fontFamily: "inherit", fontSize: "0.8rem", color: COLORS.inkMuted, cursor: "pointer", marginTop: "0.875rem" },
  };

  const DocTypeBtn = ({ value, title, desc }) => (
    <button
      style={{ padding: "1rem", border: `1.5px solid ${docType === value ? COLORS.gold : COLORS.border}`, borderRadius: 8, background: docType === value ? COLORS.goldLight : COLORS.white, cursor: "pointer", textAlign: "left", transition: "all 0.15s", fontFamily: "inherit" }}
      onClick={() => { setDocType(value); setError(""); }}
    >
      <span style={{ fontSize: "0.9rem", fontWeight: 500, color: docType === value ? COLORS.gold : COLORS.ink, display: "block", marginBottom: 3 }}>{title}</span>
      <span style={{ fontSize: "0.78rem", color: COLORS.inkMuted, lineHeight: 1.45, display: "block" }}>{desc}</span>
    </button>
  );

  const lockedCount = results ? Math.max(0, results.flags.length - FREE_FLAGS) : 0;

  return (
    <div style={s.root}>
      <header style={s.header}>
        <div style={s.logo}><span style={s.logoDot}></span>LeaseWise</div>
        <div style={s.badge}>Beta</div>
      </header>

      <main style={s.main}>

        {screen === "intake" && (
          <>
            <div style={s.hero}>
              <h1 style={s.h1}>Plain English for<br />your rental documents</h1>
              <p style={s.heroP}>Two quick questions so we can give you the most accurate analysis possible.</p>
            </div>

            <div style={s.card}>
              <label style={s.label}>Your state</label>
              <select style={s.select} value={state} onChange={(e) => { setState(e.target.value); setError(""); }}>
                <option value="">Select a state…</option>
                {STATES.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>

            <div style={s.card}>
              <label style={s.label}>What kind of document is this?</label>
              <div style={s.docTypeGrid}>
                <DocTypeBtn value="template" title="Blank template" desc="A form I'm evaluating before filling out or using" />
                <DocTypeBtn value="completed" title="Completed agreement" desc="Already filled out, ready to sign or already signed" />
              </div>
            </div>

            {error && <div style={s.error}>{error}</div>}
            <button style={s.nextBtn} onClick={proceedToUpload}>Continue →</button>
          </>
        )}

        {screen === "upload" && (
          <>
            <button style={s.backBtn} onClick={() => { setScreen("intake"); setError(""); }}>← Back</button>
            <div style={s.hero}>
              <h1 style={s.h1}>Upload your document</h1>
              <p style={s.heroP}>Drop a PDF, paste text, or upload a Word or text file.</p>
            </div>

            <div
              style={{ background: pdfBase64 ? COLORS.greenLight : dragOver ? COLORS.goldLight : COLORS.white, border: `1.5px dashed ${pdfBase64 ? COLORS.green : dragOver ? COLORS.gold : COLORS.border}`, borderRadius: 10, padding: "2.25rem", textAlign: "center", cursor: "pointer", marginBottom: "1.25rem", transition: "all 0.2s" }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files[0]); }}
            >
              <input ref={fileInputRef} type="file" accept=".txt,.pdf,.doc,.docx" style={{ display: "none" }} onChange={(e) => loadFile(e.target.files[0])} />
              <div style={{ fontSize: "2rem", marginBottom: "0.6rem", opacity: 0.55 }}>📄</div>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 500, marginBottom: 4, color: pdfBase64 ? COLORS.green : COLORS.ink }}>
                {pdfBase64 ? `✓ ${pdfName}` : "Drop your document here"}
              </h3>
              <p style={{ fontSize: "0.85rem", color: COLORS.inkMuted }}>
                {pdfBase64 ? "PDF ready — click Analyze Document below" : "PDF, Word, or text file — or paste text below"}
              </p>
            </div>

            {pdfBase64 && (
              <button
                style={{ background: "none", border: "none", color: COLORS.inkMuted, fontSize: "0.8rem", cursor: "pointer", marginBottom: "0.75rem", padding: 0, textDecoration: "underline" }}
                onClick={() => { setPdfBase64(null); setPdfName(""); if (fileInputRef.current) fileInputRef.current.value = ""; }}
              >
                Clear and use a different document
              </button>
            )}

            {!pdfBase64 && (
              <>
                <div style={s.divider}>
                  <span style={s.divLine}></span><span>or paste text</span><span style={s.divLine}></span>
                </div>
                <textarea style={s.textarea} value={docText} onChange={(e) => setDocText(e.target.value)}
                  placeholder={"Paste your lease or document text here…\n\nExample: This lease agreement is entered into between Landlord and Tenant for the property located at 123 Main St…"} />
              </>
            )}

            {error && <div style={s.error}>{error}</div>}
            <button style={{ ...s.nextBtn, marginTop: "0.875rem" }} onClick={analyze}>Analyze Document →</button>
          </>
        )}

        {screen === "loading" && (
          <div style={{ textAlign: "center", padding: "4rem 0" }}>
            <svg style={{ width: 36, height: 36, display: "block", margin: "0 auto 1rem" }} viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15" fill="none" stroke={COLORS.border} strokeWidth="2.5" />
              <circle cx="18" cy="18" r="15" fill="none" stroke={COLORS.gold} strokeWidth="2.5" strokeDasharray="30 70" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" from="0 18 18" to="360 18 18" dur="0.8s" repeatCount="indefinite" />
              </circle>
            </svg>
            <p style={{ color: COLORS.inkMuted, fontSize: "0.9rem", fontStyle: "italic" }}>{loadingMsg}</p>
          </div>
        )}

        {screen === "results" && results && (
          <>
            <div style={{ marginBottom: "1.25rem" }}>
              <span style={s.contextPill}>
                {state} · {docType === "template" ? "Blank template" : "Completed agreement"}
              </span>
            </div>

            {/* Verdict */}
            <div style={{ background: verdictConfig[results.verdict].bg, border: `1px solid ${verdictConfig[results.verdict].border}`, borderRadius: 10, padding: "1.375rem", marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{ width: 11, height: 11, borderRadius: "50%", background: verdictConfig[results.verdict].dot, flexShrink: 0 }}></div>
                <span style={{ fontSize: "0.72rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: verdictConfig[results.verdict].text }}>{verdictConfig[results.verdict].label}</span>
              </div>
              <div style={{ fontSize: "1.25rem", fontWeight: 600, color: COLORS.ink, marginBottom: 6, letterSpacing: "-0.01em" }}>{results.verdictTitle}</div>
              <div style={{ fontSize: "0.875rem", color: COLORS.inkMuted, lineHeight: 1.7 }}>{results.verdictSummary}</div>
            </div>

            {/* Summary */}
            <div style={s.section}>
              <div style={s.sectionHeader}><span style={s.sectionTitle}>Plain English Summary</span></div>
              <div style={s.sectionBody}><p style={{ fontSize: "0.9rem", lineHeight: 1.75, color: COLORS.ink }}>{results.summary}</p></div>
            </div>

            {/* Flags */}
            <div style={s.section}>
              <div style={s.sectionHeader}>
                <span style={s.sectionTitle}>Flags &amp; Findings</span>
              </div>
              <div style={s.sectionBody}>
                {/* Free flags — always visible */}
                {results.flags.slice(0, FREE_FLAGS).map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "0.7rem", borderRadius: 6, background: flagConfig[f.type].bg, marginBottom: 8 }}>
                    <div style={{ width: 14, height: 14, borderRadius: "50%", background: flagConfig[f.type].dot, flexShrink: 0, marginTop: 3 }}></div>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: "0.875rem", marginBottom: 2, color: COLORS.ink }}>{f.title}</div>
                      <div style={{ fontSize: "0.825rem", color: COLORS.inkMuted, lineHeight: 1.6 }}>{f.detail}</div>
                    </div>
                  </div>
                ))}

                {/* Locked flags */}
                {!unlocked && lockedCount > 0 && (
                  <div style={{ position: "relative", marginTop: 4 }}>
                    {/* Blurred preview of next flag */}
                    <div style={{ filter: "blur(4px)", userSelect: "none", pointerEvents: "none", marginBottom: 8 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "0.7rem", borderRadius: 6, background: flagConfig[results.flags[FREE_FLAGS]?.type || "warn"].bg }}>
                        <div style={{ width: 14, height: 14, borderRadius: "50%", background: flagConfig[results.flags[FREE_FLAGS]?.type || "warn"].dot, flexShrink: 0, marginTop: 3 }}></div>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: "0.875rem", marginBottom: 2, color: COLORS.ink }}>{results.flags[FREE_FLAGS]?.title}</div>
                          <div style={{ fontSize: "0.825rem", color: COLORS.inkMuted, lineHeight: 1.6 }}>{results.flags[FREE_FLAGS]?.detail}</div>
                        </div>
                      </div>
                    </div>

                    {/* Unlock card */}
                    <div style={{ background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "1.25rem", textAlign: "center", marginTop: "0.5rem" }}>
                      <div style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>🔒</div>
                      <div style={{ fontWeight: 600, fontSize: "1rem", color: COLORS.ink, marginBottom: 4 }}>
                        {lockedCount} more {lockedCount === 1 ? "finding" : "findings"} hidden
                      </div>
                      <div style={{ fontSize: "0.85rem", color: COLORS.inkMuted, marginBottom: "1.1rem", lineHeight: 1.5 }}>
                        Unlock the full report to see all flags, findings, and recommendations for this document.
                      </div>
                      <button
                        onClick={handleCheckout}
                        disabled={checkoutLoading}
                        style={{ background: COLORS.ink, color: COLORS.cream, border: "none", borderRadius: 8, padding: "0.75rem 2rem", fontFamily: "inherit", fontSize: "0.95rem", fontWeight: 500, cursor: checkoutLoading ? "not-allowed" : "pointer", opacity: checkoutLoading ? 0.6 : 1, marginBottom: "0.6rem", width: "100%" }}
                      >
                        {checkoutLoading ? "Loading…" : "Unlock Full Report — $4"}
                      </button>
                      <div style={{ fontSize: "0.75rem", color: COLORS.inkMuted }}>
                        One-time payment · Secure checkout via Stripe
                      </div>
                    </div>
                  </div>
                )}

                {/* Unlocked flags */}
                {unlocked && results.flags.slice(FREE_FLAGS).map((f, i) => (
                  <div key={i + FREE_FLAGS} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "0.7rem", borderRadius: 6, background: flagConfig[f.type].bg, marginBottom: i < results.flags.length - FREE_FLAGS - 1 ? 8 : 0 }}>
                    <div style={{ width: 14, height: 14, borderRadius: "50%", background: flagConfig[f.type].dot, flexShrink: 0, marginTop: 3 }}></div>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: "0.875rem", marginBottom: 2, color: COLORS.ink }}>{f.title}</div>
                      <div style={{ fontSize: "0.825rem", color: COLORS.inkMuted, lineHeight: 1.6 }}>{f.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button style={s.restartBtn} onClick={restart}>← Analyze another document</button>
          </>
        )}

      </main>
    </div>
  );
}
