// Deterministic indicators (pure, no I/O). Input must already be valid and strictly
// chronological; invalid input is rejected, never dropped, patched or re-ordered, so
// output[i] always corresponds to input[i]. Full float precision; round only for display.

export type Candle = { t: string | number; o: number; h: number; l: number; c: number };

export type IndicatorError =
  | "INVALID_PERIOD"
  | "INVALID_TIMESTAMP"
  | "MALFORMED_OHLC"
  | "DUPLICATE_TIMESTAMP"
  | "UNSORTED_TIMESTAMPS";

export type IndicatorResult =
  | { ok: true; values: (number | null)[] }
  | { ok: false; error: IndicatorError; index?: number };

/** Timestamp: finite epoch-ms number, or ISO 8601 string WITH explicit timezone (Z or ±hh:mm). */
export function parseTimestamp(t: unknown): number | null {
  if (typeof t === "number") return Number.isFinite(t) && t > 0 ? t : null;
  if (typeof t !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(t)) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

const pos = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0;

export function validateCandles(candles: readonly Candle[]): { ok: true } | { ok: false; error: IndicatorError; index: number } {
  let prev = -Infinity;
  for (let i = 0; i < candles.length; i++) {
    const k = candles[i]!;
    const ts = parseTimestamp(k?.t);
    if (!k) return { ok: false, error: "MALFORMED_OHLC", index: i };
    if (ts === null) return { ok: false, error: "INVALID_TIMESTAMP", index: i };
    if (!pos(k.o) || !pos(k.h) || !pos(k.l) || !pos(k.c)
      || k.h < k.l || k.h < k.o || k.h < k.c || k.l > k.o || k.l > k.c) {
      return { ok: false, error: "MALFORMED_OHLC", index: i };
    }
    if (ts === prev) return { ok: false, error: "DUPLICATE_TIMESTAMP", index: i };
    if (ts < prev) return { ok: false, error: "UNSORTED_TIMESTAMPS", index: i };
    prev = ts;
  }
  return { ok: true };
}

const validPeriod = (p: number) => Number.isInteger(p) && p >= 1;

/** EMA seeded with SMA of the first `period` closes at index period-1; α = 2/(period+1). */
export function calculateEMA(candles: readonly Candle[], period: number): IndicatorResult {
  if (!validPeriod(period)) return { ok: false, error: "INVALID_PERIOD" };
  const v = validateCandles(candles);
  if (!v.ok) return v;
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period) return { ok: true, values: out };
  const a = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += candles[i]!.c;
  let ema = sum / period;
  out[period - 1] = ema;
  for (let i = period; i < candles.length; i++) {
    ema = candles[i]!.c * a + ema * (1 - a);
    out[i] = ema;
  }
  return { ok: true, values: out };
}

/** True range; TR[0] = high - low (no previous close). */
export function trueRanges(candles: readonly Candle[]): number[] {
  return candles.map((k, i) => {
    if (i === 0) return k.h - k.l;
    const pc = candles[i - 1]!.c;
    return Math.max(k.h - k.l, Math.abs(k.h - pc), Math.abs(k.l - pc));
  });
}

/** Wilder ATR seeded with SMA of TR[0..period-1] at index period-1. */
export function calculateATR(candles: readonly Candle[], period: number): IndicatorResult {
  if (!validPeriod(period)) return { ok: false, error: "INVALID_PERIOD" };
  const v = validateCandles(candles);
  if (!v.ok) return v;
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period) return { ok: true, values: out };
  const tr = trueRanges(candles);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  let atr = sum / period;
  out[period - 1] = atr;
  for (let i = period; i < candles.length; i++) {
    atr = (atr * (period - 1) + tr[i]!) / period;
    out[i] = atr;
  }
  return { ok: true, values: out };
}
