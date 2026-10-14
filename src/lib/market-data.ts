// Market-data contracts + deterministic quality gate (§9, §42).
// Pure functions here are the single definition of "live"; anything not provably fresh is not live.
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { HealthState } from "@/lib/control-plane";

export type AccountHealth = Database["public"]["Tables"]["account_health"]["Row"];
export type MarketQuote = Database["public"]["Tables"]["market_quotes"]["Row"];
export type ConnectorToken = Pick<
  Database["public"]["Tables"]["connector_tokens"]["Row"],
  "id" | "account_id" | "token_prefix" | "created_at" | "last_used_at" | "revoked_at"
>;

export const HEARTBEAT_HEALTHY_MS = 15_000;
export const HEARTBEAT_DEGRADED_MS = 60_000;
export const QUOTE_FRESH_MS = 10_000;
export const DEFAULT_MAX_SPREAD_POINTS = 80;

export function connectionState(h: Pick<AccountHealth, "last_heartbeat_at" | "terminal_connected"> | null | undefined, now = Date.now()): HealthState {
  if (!h) return "UNKNOWN";
  const age = now - new Date(h.last_heartbeat_at).getTime();
  if (!Number.isFinite(age) || age > HEARTBEAT_DEGRADED_MS) return "OFFLINE";
  if (!h.terminal_connected || age > HEARTBEAT_HEALTHY_MS) return "DEGRADED";
  return "HEALTHY";
}

export type QualityReason = "q.conn" | "q.stale" | "q.closed" | "q.invalid" | "q.spread";
export type QuoteVerdict = { ok: boolean; reasons: QualityReason[] };

/** Quality gate: a quote may feed analysis/trading only when every check passes. */
export function quoteQuality(
  q: Pick<MarketQuote, "bid" | "ask" | "spread_points" | "received_at" | "tick_time">,
  conn: HealthState,
  opts: { now?: number; maxSpreadPoints?: number } = {},
): QuoteVerdict {
  const now = opts.now ?? Date.now();
  const reasons: QualityReason[] = [];
  if (conn !== "HEALTHY") reasons.push("q.conn");
  if (now - new Date(q.received_at).getTime() > QUOTE_FRESH_MS) reasons.push("q.stale");
  if (now - new Date(q.tick_time).getTime() > 5 * 60_000) reasons.push("q.closed");
  if (!(Number(q.bid) > 0) || !(Number(q.ask) > 0) || Number(q.ask) < Number(q.bid)) reasons.push("q.invalid");
  if (q.spread_points > (opts.maxSpreadPoints ?? DEFAULT_MAX_SPREAD_POINTS)) reasons.push("q.spread");
  return { ok: reasons.length === 0, reasons };
}

const positionItem = z.object({
  ticket: z.string().regex(/^[0-9]{1,20}$/),
  symbol: z.string().regex(/^[A-Za-z0-9_.#]{1,16}$/),
  type: z.enum(["BUY", "SELL"]),
  volume: z.number().positive().max(10_000),
  open_price: z.number().positive(),
  price: z.number().nonnegative().optional(),
  sl: z.number().nonnegative(),
  tp: z.number().nonnegative(),
  swap: z.number().finite(),
  profit: z.number().finite(),
  comment: z.string().max(64).default(""),
  open_time: z.string().datetime({ offset: true }),
});

export const MAX_SNAPSHOT_POSITIONS = 150;
export const INGEST_MAX_BYTES = 65_536;
const instanceId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

/** EA >= 0.4 handshake: the server issues the session epoch (fencing token). */
export const sessionInitSchema = z.object({
  action: z.literal("session_init"),
  login: z.string().regex(/^[0-9]{3,12}$/).optional(),
  instance_id: instanceId,
  nonce: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

// Payload the EA sends. Bounded so a bad client cannot flood the database.
export const ingestSchema = z.object({
  login: z.string().regex(/^[0-9]{3,12}$/).optional(),
  ea_version: z.string().max(20).optional(),
  session_epoch: z.number().int().positive().optional(),
  instance_id: instanceId.optional(),
  terminal_connected: z.boolean(),
  trade_allowed: z.boolean(),
  balance: z.number().finite().optional(),
  equity: z.number().finite().optional(),
  margin_free: z.number().finite().optional(),
  server_time: z.string().datetime({ offset: true }).optional(),
  quotes: z
    .array(
      z.object({
        symbol: z.string().regex(/^[A-Za-z0-9_.#]{1,16}$/),
        bid: z.number().positive(),
        ask: z.number().positive(),
        spread: z.number().int().min(0).max(1_000_000),
        digits: z.number().int().min(0).max(10).optional(),
        time: z.string().datetime({ offset: true }),
      }),
    )
    .max(50)
    .default([]),
  // Legacy (EA <= 0.3) unverified list: accepted for parsing but never reconciled by the server.
  positions: z.array(positionItem).max(100).optional(),
  // EA >= 0.4 snapshot with completeness evidence; the server decides whether it is verified.
  snapshot: z
    .object({
      seq: z.number().int().positive(),
      total_start: z.number().int().min(0),
      total_end: z.number().int().min(0),
      skipped: z.number().int().min(0),
      truncated: z.boolean(),
      items: z.array(positionItem).max(MAX_SNAPSHOT_POSITIONS),
    })
    .optional(),
}).refine((b) => !b.snapshot || (b.session_epoch !== undefined && b.instance_id !== undefined), {
  message: "snapshot requires session_epoch and instance_id",
});

/** Numeric dotted-version comparison ("0.10" > "0.3"); unparseable => false (fail closed). */
export function versionAtLeast(v: string | null | undefined, min: string): boolean {
  const parse = (x: string) => (/^\d+(\.\d+)*$/.test(x) ? x.split(".").map(Number) : null);
  const a = v ? parse(v.trim()) : null;
  const b = parse(min);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

export const POSITIONS_FRESH_MS = 15_000;
export type PositionFreshness = "LIVE" | "STALE" | "UNVERIFIED" | "UNKNOWN";

/** Positions are LIVE only with a server-verified complete snapshot inside the freshness window.
 *  Heartbeat freshness alone never makes positions live. */
export function positionFreshness(
  h: Pick<AccountHealth, "last_heartbeat_at" | "terminal_connected" | "last_positions_snapshot_at" | "snapshot_status"> | null | undefined,
  now = Date.now(),
): PositionFreshness {
  if (!h) return "UNKNOWN";
  if (h.snapshot_status === "rejected") return "UNVERIFIED";
  if (!h.last_positions_snapshot_at || h.snapshot_status !== "verified") return "UNKNOWN";
  const age = now - new Date(h.last_positions_snapshot_at).getTime();
  if (!Number.isFinite(age) || age < -5_000 || age > POSITIONS_FRESH_MS) return "STALE";
  if (connectionState(h, now) !== "HEALTHY") return "STALE";
  return "LIVE";
}

export const healthQuery = (userId: string) =>
  queryOptions({
    queryKey: ["account_health", userId],
    refetchInterval: 5_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("account_health").select("*").eq("user_id", userId);
      if (error) throw error;
      return data ?? [];
    },
  });

export const quotesQuery = (userId: string) =>
  queryOptions({
    queryKey: ["market_quotes", userId],
    refetchInterval: 3_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("market_quotes")
        .select("*")
        .eq("user_id", userId)
        .order("canonical_symbol");
      if (error) throw error;
      return data ?? [];
    },
  });

export const tokenQuery = (userId: string, accountId: string) =>
  queryOptions({
    queryKey: ["connector_token", userId, accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("connector_tokens")
        .select("id, account_id, token_prefix, created_at, last_used_at, revoked_at")
        .eq("user_id", userId)
        .eq("account_id", accountId)
        .is("revoked_at", null)
        .maybeSingle();
      if (error) throw error;
      return data as ConnectorToken | null;
    },
  });
