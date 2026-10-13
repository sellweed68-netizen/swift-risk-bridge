import { describe, expect, it } from "vitest";
import { calculateATR, calculateEMA, parseTimestamp, trueRanges, type Candle } from "./indicators";

const T = (m: number) => `2026-01-01T00:0${m}:00Z`;
const BARS: Candle[] = [
  { t: T(0), o: 100, h: 110, l: 95, c: 105 },
  { t: T(1), o: 105, h: 115, l: 102, c: 112 },
  { t: T(2), o: 112, h: 114, l: 100, c: 102 },
  { t: T(3), o: 102, h: 108, l: 98, c: 106 },
];

describe("indicators — hand-calculated fixtures", () => {
  it("true range", () => expect(trueRanges(BARS)).toEqual([15, 13, 14, 10]));

  it("ATR(3) Wilder", () => {
    const r = calculateATR(BARS, 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.slice(0, 2)).toEqual([null, null]);
    expect(r.values[2]).toBe(14);
    expect(r.values[3]).toBeCloseTo(38 / 3, 12);
  });

  it("EMA(3) seeded by SMA", () => {
    const r = calculateEMA(BARS, 3);
    if (!r.ok) throw new Error(r.error);
    expect(r.values.slice(0, 2)).toEqual([null, null]);
    expect(r.values[2]).toBeCloseTo(319 / 3, 12);
    expect(r.values[3]).toBeCloseTo(106 * 0.5 + (319 / 3) * 0.5, 12);
  });

  it("output length matches input and is deterministic", () => {
    const a = calculateEMA(BARS, 2), b = calculateEMA(BARS, 2);
    expect(a).toEqual(b);
    if (a.ok) expect(a.values).toHaveLength(BARS.length);
  });

  it("period 1 EMA equals closes; ATR equals TR", () => {
    const e = calculateEMA(BARS, 1), a = calculateATR(BARS, 1);
    expect(e.ok && e.values).toEqual([105, 112, 102, 106]);
    expect(a.ok && a.values).toEqual([15, 13, 14, 10]);
  });
});

describe("indicators — boundaries and rejection", () => {
  it("insufficient history returns all null", () => {
    expect(calculateEMA(BARS.slice(0, 2), 3)).toEqual({ ok: true, values: [null, null] });
    expect(calculateATR([], 3)).toEqual({ ok: true, values: [] });
  });
  it.each([0, -1, 2.5, NaN])("rejects period %s", (p) => {
    expect(calculateEMA(BARS, p)).toEqual({ ok: false, error: "INVALID_PERIOD" });
    expect(calculateATR(BARS, p)).toEqual({ ok: false, error: "INVALID_PERIOD" });
  });
  it("rejects duplicate timestamps", () => {
    const bad = [BARS[0]!, { ...BARS[1]!, t: T(0) }];
    expect(calculateEMA(bad, 1)).toEqual({ ok: false, error: "DUPLICATE_TIMESTAMP", index: 1 });
  });
  it("rejects out-of-order timestamps (no silent re-sort)", () => {
    expect(calculateATR([BARS[1]!, BARS[0]], 1)).toEqual({ ok: false, error: "UNSORTED_TIMESTAMPS", index: 1 });
  });
  it("rejects malformed OHLC", () => {
    expect(calculateEMA([{ ...BARS[0]!, h: 90 }], 1)).toMatchObject({ ok: false, error: "MALFORMED_OHLC" });
    expect(calculateEMA([{ ...BARS[0]!, c: NaN }], 1)).toMatchObject({ ok: false, error: "MALFORMED_OHLC" });
    expect(calculateEMA([{ ...BARS[0]!, l: 0 }], 1)).toMatchObject({ ok: false, error: "MALFORMED_OHLC" });
  });
  it("rejects ambiguous timestamps", () => {
    expect(parseTimestamp("2026-01-01T00:00:00")).toBeNull(); // no timezone
    expect(parseTimestamp("garbage")).toBeNull();
    expect(parseTimestamp(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(calculateEMA([{ ...BARS[0]!, t: "2026-01-01" }], 1)).toMatchObject({ error: "INVALID_TIMESTAMP" });
  });
});
