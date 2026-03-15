# browserclaw.org

<p align="center">
  <a href="https://browserclaw.org"><img src="https://img.shields.io/badge/Live-browserclaw.org-orange" alt="Live" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
</p>

AI browser automation playground. Type a prompt, watch AI do it in a real browser live, and get a reusable skill.

Unlike search APIs and scraping tools, browserclaw.org drives a real browser — clicking buttons, filling forms, navigating across pages — just like you would. It uses [browserclaw](https://github.com/idan-rubin/browserclaw)'s snapshot + ref engine instead of vision models, using 4x fewer tokens per workflow.

## Run locally

Requires: Node.js 22+, Chrome installed

```bash
git clone https://github.com/idan-rubin/browserclaw.org.git
cd browserclaw.org
```

### 1. Browser service

```bash
cd src/Services/Browser
cp .env.example .env.local
```

Edit `.env.local` — add at least one API key:

| Provider | Env var | Free tier |
|----------|---------|-----------|
| Groq | `GROQ_API_KEY` | Yes |
| Google Gemini | `GEMINI_API_KEY` | Yes |
| OpenAI | `OPENAI_API_KEY` | No |

Set `MODEL` to match your key (e.g. `groq-llama-3.3-70b`, `gemini-2.5-flash`, `gpt-5.4`).

```bash
npm install
npm run dev
```

### 2. Frontend

In a new terminal:

```bash
cd src/Frontend
npm install
NEXT_PUBLIC_LOCAL_MODE=true npm run dev
```

### 3. Use it

Open [http://localhost:3000](http://localhost:3000), type a prompt, and watch Chrome open on your desktop.

## Run with Docker

For the full production setup with VNC streaming:

```bash
docker compose up
```

Open [http://localhost](http://localhost).

## Architecture

```
User → Traefik (port 80) → Frontend (Next.js)
                          → Browser service (Node.js + Chrome + VNC)
```

- **Frontend** serves the UI and proxies API calls to the browser service
- **Browser service** runs the AI agent loop: snapshot → LLM → action → repeat
- **VNC** streams the live browser via Xvfb + x11vnc + websockify (Docker only)
- **browserclaw** ([npm](https://www.npmjs.com/package/browserclaw)) powers the browser automation

## Built with

- [BrowserClaw](https://github.com/idan-rubin/browserclaw) — snapshot + ref browser automation engine
- [OpenClaw](https://github.com/openclaw/openclaw) — the project that inspired it
