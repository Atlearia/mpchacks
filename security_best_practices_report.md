# Security Review — Crest Expense Intelligence API

**Date:** 2026-05-30
**Scope:** FastAPI backend (`app/`), seed script (`scripts/`), React/Vite frontend (`frontend/src/`), Docker, repo hygiene.
**Focus areas (as requested):** API keys / secrets, rate limiting, general exposure.

> No secret values are reproduced in this report. `.env` was intentionally **not** opened. All findings below are derived from source and configuration only.

---

## Executive Summary

Secret handling is fundamentally sound: the AI API key and the MongoDB URI live only in `.env` (gitignored, and **never present in git history**), are loaded server-side via `pydantic-settings`, and are **never sent to the browser** — the frontend only calls `/api/dataset` through a Vite proxy. Good defenses already exist: opaque 500 handler, streaming upload size cap, TLS to Mongo, input validation, rate limiting, and a non-root Docker user.

The most material gaps are **(1) the complete absence of authentication on all endpoints** — including the one that spends money on the AI API and the one that returns employee PII — and **(2) IP-only rate limiting that is easy to bypass and misbehaves behind a proxy**. Separately, the entire `frontend/node_modules/` tree (9,495 files) is committed to git.

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| H-1 | High | No authentication on any endpoint (PII exposure + paid-API cost abuse) | **Fixed** for `/ingest` + `/query` (API key + budget cap); `/api/dataset` left open by design — see note |
| H-2 | High | `node_modules/` committed to the repository | **Fixed** (untracked) |
| M-1 | Medium | Rate limiting keyed only on socket IP; bypassable / proxy-unsafe | **Fixed** (per-key/IP, opt-in proxy trust) |
| M-2 | Medium | CORS `allow_credentials=True` without any credentialed auth | **Fixed** |
| M-3 | Medium | Parsing untrusted 50 MB uploads (CPU/memory DoS surface) | Mitigated (now auth-gated) |
| L-1 | Low | Prompt injection via `question` / uploaded data | Accepted (length-bounded, no tools/secrets) |
| L-2 | Low | Raw model output echoed to client on parse failure | **Fixed** |
| L-3 | Low | Global in-memory job store, no per-client isolation | **Fixed** (jobs scoped to caller) |
| L-4 | Low | No `TrustedHostMiddleware` (Host header) | **Fixed** (configurable) |
| I-1 | Info | Things done well (keep these) | — |

> **`/api/dataset` note:** intentionally left reachable by the browser dashboard,
> which serves **synthetic seed data**. Protecting a browser-facing endpoint with
> a static key just moves the secret into the JS bundle (no real gain). For real
> PII this needs a user login/session or a network restriction — a larger change
> left out to avoid breaking the dashboard. Say the word and I'll add it.

---

## High

### H-1 — No authentication / authorization on any endpoint
**Impact:** Anyone who can reach the service can dump all employee PII and run up unbounded AI API charges.

- `GET /api/dataset` returns every employee record — names, emails, `cardLast4`, `monthlyLimit` — and all transactions, with no auth.
  - `app/routers/dashboard.py:21-43`
- `POST /query` invokes the **paid** AI API on attacker-supplied input with no auth.
  - `app/routers/query.py:13-28`
- `POST /ingest` accepts arbitrary uploads from anyone.
  - `app/routers/ingest.py:35-64`

The only control is per-IP rate limiting (see M-1), which does not stop a distributed or IP-rotating caller from draining your AI API quota/budget or scraping the dataset.

**Recommendation:** Put every data/AI endpoint behind an auth check. For a service-to-service or single-tenant setup, a static API key in an `Authorization`/`X-API-Key` header compared with `secrets.compare_digest` is the minimum. For multi-user, use real sessions/JWT. Keep `/health` public. Consider a hard global daily cap on AI API calls as a budget backstop.

### H-2 — `node_modules/` is committed to git
**Impact:** Repo bloat, slow clones, and a large unaudited supply-chain surface baked into history; raises the chance of accidentally shipping/committing local artifacts.

- 9,495 of 9,531 tracked files are under `frontend/node_modules/`. `.gitignore:18` already lists `frontend/node_modules/`, so it is ignored *going forward* but was committed before the ignore rule.

**Recommendation:** `git rm -r --cached frontend/node_modules` and commit. Dependencies are reproducible from `package-lock.json`.

---

## Medium

### M-1 — Rate limiting keyed solely on socket IP
- `limiter = Limiter(key_func=get_remote_address, ...)` in `app/main.py:36`.

`get_remote_address` uses the direct socket peer. Two failure modes:
1. **Behind a reverse proxy / load balancer** (typical prod), every request appears to come from the proxy IP, so all users share one bucket → accidental DoS, or limits effectively disabled.
2. **Without a proxy**, an attacker with many source IPs (cloud, IPv6 ranges) trivially bypasses the per-IP budget — directly enabling the H-1 cost-abuse scenario.

**Recommendation:** Decide on the deployment topology. If behind a trusted proxy, configure the limiter to read a validated `X-Forwarded-For` only from known proxy IPs (never trust the header blindly). Pair rate limits with the auth key from H-1 (rate-limit per key, not per IP) and add a global ceiling.

### M-2 — CORS `allow_credentials=True` with no credentialed auth
- `app/main.py:47-54` sets `allow_credentials=True` and `allow_headers=["*"]`.

There are currently no cookies/credentials in use, so `allow_credentials=True` grants nothing useful and increases blast radius if `ALLOWED_ORIGINS` is ever misconfigured. (Note: the explicit-origins list is correct — wildcard origins + credentials would be rejected by browsers anyway.)

**Recommendation:** Set `allow_credentials=False` unless/until cookie-based auth is added, and narrow `allow_methods`/`allow_headers` to what the app actually uses.

### M-3 — Parsing untrusted uploads up to 50 MB
- `app/routers/ingest.py:35-64` → `app/services/parser.py` parse CSV (pandas), JSON, and PDF (`pdfminer`) from anonymous uploads.

The streaming size cap (`_read_limited`, `ingest.py:19-32`) is good and prevents raw-bytes blowup, but a 50 MB CSV/PDF can still be expensive to parse (CPU, memory amplification), and combined with H-1 this is a cheap way to exhaust a worker.

**Recommendation:** Lower the default `MAX_FILE_SIZE_MB` if 50 MB isn't required, run ingestion behind auth (H-1), and consider row/column caps and a parse timeout. Keep workers bounded.

---

## Low

### L-1 — Prompt injection via `question` and uploaded data
- `app/services/gemini.py:35-36` concatenates user `question` and uploaded `chunk` straight into the prompt.

Length is bounded (`MAX_QUESTION_LENGTH`, `schemas.py:31-40`) and the model has no tools/secrets, so impact is limited to manipulating the model's own JSON answer. Worth noting because the returned content is shown to users.

**Recommendation:** Keep the length cap; treat all model output as untrusted in the UI (no HTML injection). Acceptable as-is for the current design.

### L-2 — Raw model output echoed on parse failure
- `app/services/gemini.py:74` returns `{"error": "parse_failed", "raw": raw}`.

Leaks raw model output (not a secret, but internal behavior) to the client.

**Recommendation:** Log `raw` server-side; return a generic message to the client.

### L-3 — Global in-memory job store, no per-client isolation
- `app/main.py:25-33`. Any caller holding a `job_id` can query that job via `/query`.

`job_id` is a UUID4 (`ingest.py:45`), so guessing is impractical, and the TODO already flags replacing it. Data is also lost on restart and unencrypted in process memory.

**Recommendation:** When auth lands (H-1), scope jobs to the authenticated principal. Fine for now given UUID4 ids.

### L-4 — No `TrustedHostMiddleware`
The app does not validate the `Host` header. Low risk for an API, but cheap to add in production to prevent Host-header abuse.

---

## I-1 — Done well (keep these)

- **Secrets never committed:** `.env` is gitignored (`.gitignore:1-5`) and absent from all git history; only `.env.example` (placeholders) is tracked.
- **Secrets stay server-side:** AI API key and Mongo URI loaded via `pydantic-settings` (`app/config.py`); the browser only ever calls `/api/dataset` (`frontend/src/data/dataset.ts:35`). No `VITE_`-exposed secrets, no client-side keys.
- **No stack-trace leakage:** opaque 500 handler (`app/main.py:57-64`).
- **TLS to MongoDB** with `certifi` CA bundle (`app/db.py:24-29`, `scripts/seed_mongo.py:320`).
- **Upload size cap** via incremental read (`app/routers/ingest.py:19-32`).
- **Input validation:** Pydantic models, UUID validation, question length cap (`app/models/schemas.py`).
- **Least privilege container:** non-root `appuser` in the Dockerfile (`Dockerfile:14-15`).
- **Rate limiting present** (needs hardening per M-1, but the foundation is there).
- **Retries scoped to transient errors only** (429/503) in `app/services/gemini.py:24-28`.

---

## Suggested remediation order
1. **H-1** — add auth to `/ingest`, `/query`, `/api/dataset` + a global AI API budget cap.
2. **M-1** — rate-limit per auth key and fix proxy/IP handling.
3. **H-2** — untrack `node_modules`.
4. **M-2 / M-3 / L-2** — quick hardening (CORS flag, upload limits, hide raw output).
5. **L-1 / L-3 / L-4** — defense-in-depth as the app grows.
