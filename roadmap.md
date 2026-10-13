# NEXORA MT5 — Project State (single source of truth)

Master Command: LOCKED (received 2026-10-06). Architecture changes require human approval.

## Architecture lock (summary)
- NEXORA AI = brain, never sends broker orders. NEXORA MT5 = control/risk/execution. MT5 EA = thin bridge. Broker = execution.
- Deterministic Risk Engine is final authority; AI cannot bypass.
- Cloud control plane and local execution plane are separate; cloud down ≠ positions unprotected.
- Execution state machine, idempotency, no blind resend on UNKNOWN, reconciliation = core.
- Multi-user / multi-broker / multi-account from foundation. Credentials never reach AI, logs or client.
- Default trading mode DATA ONLY; AUTO TRADE needs explicit activation.

## Workstreams (dependency order)
1. [DONE] PROJECT FOUNDATION — enable Lovable Cloud, design system, app shell (HOME/MARKETS/ACCOUNTS/TRADING/AI/JOURNAL/MORE)
2. [DONE] AUTH & MULTI-USER (Phase 1; team sharing → later) — roles OWNER/ADMIN/TRADER/VIEWER, tenant isolation
3. [DONE] BROKER & ACCOUNT MANAGER — broker capability profiles, canonical symbols, per-account risk profiles
4. [DONE] MT5 CONNECTOR & MARKET DATA + quality gate (report-only bridge)
5. [PARTIAL: M1 candles + chart done] MARKET ANALYSIS & CHART SNAPSHOT
6. [READY: approved — built-in AI behind abstraction] NEXORA AI INTEGRATION
7. [QUEUED] SIGNAL & VERSIONED TRADE PLAN ENGINE
8. [QUEUED] RISK, EXPOSURE, NEWS/SESSION, CIRCUIT BREAKER
9. [DONE: manual approval path] EXECUTION ENGINE — DB safety gate (request_execution), state machine trigger, idempotency key + one live order per plan, UNKNOWN after 30s never resent (reconcile-only), slippage/latency capture, EA v0.2 pull/report (InpExecute off by default). OPEN: verify on a real demo account; AUTO modes stay locked.
10. [QUEUED] POSITIONS / JOURNAL / RECONCILIATION
11. [QUEUED] NOTIFICATIONS (LINE/Telegram/Push/In-App) & HEALTH MONITOR
12. [QUEUED] TESTING / SIMULATION / RELEASE (test matrix §72)

## Requested tasks
- [PARTIAL] i18n TH/EN: switcher in header, saved per user (profiles.language) + device; translated menu, Home, Markets, MT5 bridge panel. OPEN: Accounts risk/symbol forms, More, sign-in page, placeholder pages.

## Open decisions (human)
- D1–D3 APPROVED 2026-10-06: Cloud on; we provide MQL5 EA; built-in AI via abstraction.
- D4 APPROVED 2026-10-06: identifiers are UUID-only (DB-generated). No short codes, no sequences. Broker-side ids (MT5 login, broker ticket, broker symbol) live in scoped-unique text columns, never as keys.
- D5 APPROVED 2026-10-06: platform Super-Admin = read-only across all users (account Bestrt67ss@gmail.com). No cross-user edits.
- Pending: real broker/account to test against (needed in Phase 3).

## Backlog (deferred §73)
AI Marketplace, AI Tournament, Strategy Evolution, Autonomous Strategy Creation, Advanced Backtesting, Copy/Social Trading, Subscription/Strategy Marketplaces, Advanced Portfolio Optimization, Complex Quant Models.

## Checkpoint
- CP0: State + architecture lock recorded.
- CP1 (Phase 1 DONE): email+Google sign-in; profiles, user_roles (OWNER default), control_state (DATA_ONLY default), audit_log; DB trigger locks AUTO/ULTIMATE modes, STOP AI TRADING never closes positions and is audited; shell nav HOME/MARKETS/ACCOUNTS/TRADING/AI/JOURNAL/MORE (desktop sidebar, mobile bottom bar).
- CP2 (Phase 2 DONE): brokers catalog (9 entries incl. Custom MT5), broker_accounts (login/server/currency/demo/status, no credential columns), symbol_aliases per user+broker, risk_profiles per account with DB CHECK bounds + one-active index; ownership-immutable and owner-match triggers; default limits auto-created with each account; every change audited. Verified signed-in as qa.nexora@example.com: link → limits saved → GOLD.a→XAUUSD mapped → reload persists → pause archived → audit rows present.
- QA sign-in created for testing: qa.nexora@example.com (confirmed). Delete via backend auth users when no longer needed.
- CP3 (Phase 3 DONE): per-account connector tokens (sha256-hashed, one active, issue/revoke RPC, audited); POST /api/public/mt5/ingest (zod-bounded, token verified in SECURITY DEFINER connector_ingest, login must match account, older ticks never overwrite newer); account_health + market_quotes (latest only); quality gate (heartbeat 15s/60s, quote 10s, spread cap 80 pts, bid/ask sanity) with unit tests; Markets page LIVE/NOT LIVE; bridge panel + public/ea/NexoraBridge.mq5 (report-only, never trades). Verified with simulated EA posts: valid/invalid token/login mismatch; GOLD.a→XAUUSD shown LIVE, wide spread NOT LIVE.
- Known: bridge not yet tested in a real MT5 terminal (needs user's broker). Charts/candles + chart snapshots move to Phase 5.
- NEXT: finish i18n on remaining pages, then Phase 6 NEXORA AI integration / Phase 5 analysis.

- [x] Phase 10-B: ATR/EMA pure functions + tests, shared sign-out (desktop + mobile More), Home open positions/floating P/L (gated by fresh heartbeat + EA>=0.3). Daily P/L & used margin excluded (no deal history / margin field).
