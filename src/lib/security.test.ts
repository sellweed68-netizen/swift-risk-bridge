import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { checkPassword } from "./security";

describe("password policy", () => {
  it("accepts a strong password", () => expect(checkPassword("Strong#Pass12", "a@b.com")).toEqual([]));
  it("rejects under 10 chars", () => expect(checkPassword("Ab#1abcd")).toContain("TOO_SHORT"));
  it("requires uppercase", () => expect(checkPassword("lower#case12")).toContain("NO_UPPER"));
  it("requires a digit", () => expect(checkPassword("NoDigits#here")).toContain("NO_DIGIT"));
  it("requires a symbol", () => expect(checkPassword("NoSymbol1234A")).toContain("NO_SYMBOL"));
  it("rejects passwords containing the email name", () =>
    expect(checkPassword("Theeruth#2026", "theeruth@x.com")).toContain("CONTAINS_EMAIL"));
});

import { runSignOut } from "./security";
describe("runSignOut", () => {
  const base = () => {
    const calls: string[] = [];
    return { calls, d: {
      log: async () => { calls.push("log"); },
      authSignOut: async () => { calls.push("auth"); return { error: null }; },
      clearCache: () => { calls.push("clear"); },
      invalidate: async () => { calls.push("inv"); },
      navigate: () => { calls.push("nav"); },
    } };
  };
  it("succeeds and runs all steps", async () => {
    const { calls, d } = base();
    expect(await runSignOut(d)).toEqual({ ok: true });
    expect(calls).toEqual(["log", "auth", "clear", "inv", "nav"]);
  });
  it("reports auth failure but still navigates", async () => {
    const { calls, d } = base();
    const r = await runSignOut({ ...d, authSignOut: async () => ({ error: { message: "net" } }) });
    expect(r).toEqual({ ok: false, error: "net" });
    expect(calls).toContain("nav");
  });
  it("audit failure or hang does not block", async () => {
    const { calls, d } = base();
    const r = await runSignOut({ ...d, log: () => new Promise(() => {}), logTimeoutMs: 10 });
    expect(r.ok).toBe(true);
    expect(calls).toContain("nav");
  });
  it("router invalidate failure does not skip navigation", async () => {
    const { calls, d } = base();
    const r = await runSignOut({ ...d, invalidate: async () => { throw new Error("x"); } });
    expect(r.ok).toBe(true);
    expect(calls).toContain("nav");
  });
});
