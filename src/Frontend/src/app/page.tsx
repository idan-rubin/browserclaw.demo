"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

const EXAMPLES = [
  "Search Google Flights for the cheapest round trip from NYC to Tokyo next month",
  "Find wine stores in Chelsea NYC, browse their sites for Italian Nebbiolo, and recommend the best deal",
  "Find Lonely Planet's top things to do in Tel Aviv",
  "Find a nice and popular bar in Murray Hill for a first date today at 7pm",
];

type ModalStep = "checking" | "launching" | null;
type ModalState =
  | { type: "processing"; step: ModalStep }
  | { type: "blocked"; reason: string }
  | null;

export default function HomePage() {
  const [prompt, setPrompt] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [modalElapsed, setModalElapsed] = useState(0);
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (modal?.type !== "processing") {
      setModalElapsed(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      setModalElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [modal?.type]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Use rAF so React's value update is flushed first
    requestAnimationFrame(() => {
      const style = getComputedStyle(el);
      const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const lineHeight = parseFloat(style.lineHeight) || 24;
      const oneRow = lineHeight + paddingY;
      const threeRows = lineHeight * 3 + paddingY;

      // Measure content height by temporarily collapsing
      el.style.transition = "none";
      el.style.height = "0";
      const contentHeight = el.scrollHeight; // includes padding

      // Determine target: 1 row if empty, at least 3 rows if has text, or content height if more
      const hasText = el.value.length > 0;
      const target = hasText
        ? Math.min(Math.max(contentHeight, threeRows), 200)
        : oneRow;

      // Restore previous height, force reflow, then animate to target
      el.style.height = el.dataset.prevHeight || oneRow + "px";
      void el.offsetHeight; // force reflow before re-enabling transition
      el.style.transition = "";
      el.style.height = target + "px";
      el.dataset.prevHeight = target + "px";
    });
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("prompt");
    if (q) {
      setPrompt(q);
      requestAnimationFrame(autoResize);
    }
  }, [autoResize]);

  async function handleRun(skipModeration = false) {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    setModal({ type: "processing", step: "checking" });

    try {
      const res = await fetch("/api/v1/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          skip_moderation: skipModeration,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const msg = data.message ?? data.error ?? "Something went wrong";
        if (msg.toLowerCase().includes("blocked") || msg.toLowerCase().includes("policy")) {
          setModal({ type: "blocked", reason: msg });
        } else {
          setModal(null);
          alert(msg);
        }
        return;
      }

      setModal({ type: "processing", step: "launching" });
      await new Promise((r) => setTimeout(r, 600));
      router.push(`/run/${data.session_id}`);
    } catch {
      setModal(null);
      alert("Failed to connect. Try again.");
    }
  }

  return (
    <div className="relative min-h-screen flex flex-col">
      <div className="pointer-events-none fixed inset-0 z-0 dot-grid" />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-10 sm:py-5">
        <a href="/" className="font-[family-name:var(--font-heading)] text-lg sm:text-xl tracking-tight">
          browserclaw
        </a>
        <div className="flex items-center gap-2 sm:gap-8">
          <div className="hidden sm:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="https://github.com/idan-rubin/browserclaw.org" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">GitHub</a>
            <a href="/docs" className="transition-colors hover:text-foreground">Docs</a>
            <a href="https://mrrubin.substack.com" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">Blog</a>
          </div>
          <ThemeToggle />
        </div>
      </nav>

      {/* Hero */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 sm:px-6">
        <div className="w-full max-w-3xl animate-page-in">
          <h1 className="text-center text-[2.5rem] font-bold leading-[1.1] tracking-tight sm:text-7xl lg:text-8xl">
            AI that{" "}
            <span className="italic text-primary">browses</span>
            <br />
            for you.
          </h1>

          <p className="mx-auto mt-4 max-w-xl text-center text-base text-muted-foreground sm:mt-6 sm:text-xl">
            Type what you want done. Watch it happen live.
            <br className="hidden sm:block" />
            Get a reusable skill.
          </p>

          <div className="mt-8 space-y-3 sm:mt-12">
            {/* Mobile: stacked layout. Desktop: side by side */}
            <div className="group flex items-end gap-2 rounded-2xl border border-border bg-card/60 p-2 backdrop-blur-sm transition-colors focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20">
              <textarea
                ref={textareaRef}
                rows={1}
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  autoResize();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleRun();
                  }
                }}
                placeholder="What do you want the browser to do?"
                className="flex-1 resize-none overflow-hidden bg-transparent px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground/60 transition-[height] duration-200 ease-out focus:outline-none sm:px-4 sm:py-3 sm:text-lg"
                style={{ maxHeight: "200px" }}
                disabled={!!modal}
              />
              <div className="flex shrink-0 items-center gap-3">
                {prompt && (
                  <span className="hidden text-sm text-muted-foreground/50 sm:inline">
                    Shift+Enter for new line
                  </span>
                )}
                <button
                  onClick={() => handleRun()}
                  disabled={!!modal || !prompt.trim()}
                  className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none sm:px-6 sm:py-3 sm:text-base"
                >
                  Run
                </button>
              </div>
            </div>
          </div>

          {/* Example chips */}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                onClick={() => {
                  setPrompt(example);
                  requestAnimationFrame(autoResize);
                  textareaRef.current?.focus();
                }}
                className="rounded-full border border-border/60 px-3 py-1.5 text-xs text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground sm:text-sm"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </main>

      {/* Built With / Inspired By */}
      <section className="relative z-10 py-10 sm:py-16">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs sm:text-sm text-muted-foreground/50 sm:gap-x-8">
          <span>Built with</span>
          <a href="https://github.com/idan-rubin/browserclaw" target="_blank" rel="noopener noreferrer" className="font-[family-name:var(--font-heading)] text-muted-foreground/70 transition-colors hover:text-foreground">BrowserClaw</a>
          <span className="text-muted-foreground/30">&middot;</span>
          <span>Inspired by</span>
          <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer" className="font-[family-name:var(--font-heading)] text-muted-foreground/70 transition-colors hover:text-foreground">OpenClaw</a>
        </div>
      </section>

      {/* Product Cards */}
      <section className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-6 sm:px-10 sm:pb-10">
        <div className="grid gap-4 sm:gap-6 sm:grid-cols-3">
          <Card
            title="Live Browser Stream"
            description="Watch AI navigate in real-time. Every click, every scroll, every form fill — streamed to your screen."
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            }
          />
          <Card
            title="Reusable Skills"
            description="Every run exports a skill file. Run it again tomorrow, share it with your team, schedule it."
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            }
          />
          <Card
            title="Open Source Engine"
            description="Built on browserclaw — snapshot + ref browser automation. MIT licensed. 150K tokens per workflow vs 600K+ with vision."
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
                <line x1="14" y1="4" x2="10" y2="20" />
              </svg>
            }
          />
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="relative z-10 flex flex-col items-center gap-6 pb-20 pt-4 sm:gap-8 sm:pb-32 sm:pt-8">
        <h2 className="text-center text-3xl font-bold tracking-tight sm:text-5xl">
          Start automating.
        </h2>
        <button
          onClick={() => {
            window.scrollTo({ top: 0, behavior: "smooth" });
            setTimeout(() => textareaRef.current?.focus(), 400);
          }}
          className="rounded-xl bg-primary px-8 py-4 text-base font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97]"
        >
          Try it free
        </button>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/50 px-4 py-10 sm:px-10 sm:py-16">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 sm:grid-cols-4 sm:gap-10">
          <FooterColumn title="Product" links={[
            { label: "Skills Library", href: "/skills" },
            { label: "API Docs", href: "/docs#api-reference" },
          ]} />
          <FooterColumn title="Resources" links={[
            { label: "Documentation", href: "/docs" },
            { label: "Blog", href: "https://mrrubin.substack.com" },
            { label: "Changelog", href: "/changelog" },
          ]} />
          <FooterColumn title="Open Source" links={[
            { label: "BrowserClaw", href: "https://github.com/idan-rubin/browserclaw" },
            { label: "OpenClaw", href: "https://openclaw.ai" },
            { label: "npm", href: "https://www.npmjs.com/package/browserclaw" },
          ]} />
          <FooterColumn title="Connect" links={[
            { label: "GitHub", href: "https://github.com/idan-rubin/browserclaw.org" },
          ]} />
        </div>
        <div className="mx-auto mt-12 max-w-6xl text-sm text-muted-foreground/40">
          &copy; {new Date().getFullYear()} browserclaw.org
        </div>
      </footer>

      {/* Processing Modal */}
      {modal?.type === "processing" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Starting run</h3>
            <div className="mt-5 space-y-4">
              <ModalStepRow
                label="Checking prompt..."
                state={modal.step === "checking" ? "active" : "done"}
                elapsedSeconds={modal.step === "checking" ? modalElapsed : undefined}
              />
              <ModalStepRow
                label="Launching browser..."
                state={launchStepState(modal.step)}
                elapsedSeconds={modal.step === "launching" ? modalElapsed : undefined}
              />
            </div>
            <button
              onClick={() => setModal(null)}
              className="mt-5 w-full rounded-xl border-2 border-red-600 bg-red-600/10 py-2 text-sm font-semibold text-red-500 transition-all hover:bg-red-600/20"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Blocked Modal */}
      {modal?.type === "blocked" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0 rounded-full bg-amber-500/10 p-2 text-amber-500">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold">Prompt flagged</h3>
                <p className="mt-1 text-sm text-muted-foreground">{modal.reason}</p>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              If you believe this is a false positive, you can proceed anyway.
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => setModal(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRun(true)}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
              >
                Proceed anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function launchStepState(currentStep: ModalStep): "pending" | "active" | "done" {
  if (currentStep === "launching") return "active";
  if (currentStep === "checking") return "pending";
  return "done";
}

function stepTextColor(state: "pending" | "active" | "done"): string {
  switch (state) {
    case "pending": return "text-muted-foreground/50";
    case "active":  return "text-foreground";
    case "done":    return "text-muted-foreground";
  }
}

function ModalStepRow({ label, state, elapsedSeconds }: { label: string; state: "pending" | "active" | "done"; elapsedSeconds?: number }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      {state === "pending" && (
        <div className="h-5 w-5 rounded-full border-2 border-border" />
      )}
      {state === "active" && (
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      )}
      {state === "done" && (
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/20 text-green-500">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )}
      <span className={`text-sm ${stepTextColor(state)}`}>
        {label}
      </span>
      {state === "active" && elapsedSeconds != null && elapsedSeconds > 0 && (
        <span className="ms-auto font-[family-name:var(--font-jetbrains-mono)] text-xs tabular-nums text-muted-foreground">
          {elapsedSeconds}s
        </span>
      )}
    </div>
  );
}

function Card({ title, description, icon }: { title: string; description: string; icon: React.ReactNode }) {
  return (
    <div className="group rounded-2xl border border-border/50 bg-card/40 p-5 sm:p-8 backdrop-blur-sm transition-colors hover:border-primary/20 hover:bg-card/60">
      <div className="mb-5 inline-flex rounded-xl bg-primary/10 p-3 text-primary transition-colors group-hover:bg-primary/15">
        {icon}
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h4 className="mb-4 text-sm font-semibold tracking-wide text-foreground/80">{title}</h4>
      <ul className="space-y-2.5">
        {links.map((link) => (
          <li key={link.label}>
            <a
              href={link.href}
              target={link.href.startsWith("http") ? "_blank" : undefined}
              rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
