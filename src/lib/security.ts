import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

export type PasswordIssue = "TOO_SHORT" | "NO_LOWER" | "NO_UPPER" | "NO_DIGIT" | "NO_SYMBOL" | "CONTAINS_EMAIL";

/** Password policy: ≥10 chars, lower, upper, digit, symbol, must not contain the email name. */
export function checkPassword(pw: string, email = ""): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (pw.length < 10) issues.push("TOO_SHORT");
  if (!/[a-z]/.test(pw)) issues.push("NO_LOWER");
  if (!/[A-Z]/.test(pw)) issues.push("NO_UPPER");
  if (!/\d/.test(pw)) issues.push("NO_DIGIT");
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push("NO_SYMBOL");
  const name = email.split("@")[0]?.toLowerCase() ?? "";
  if (name.length >= 3 && pw.toLowerCase().includes(name)) issues.push("CONTAINS_EMAIL");
  return issues;
}

/** Generic message for sign-in failures — never reveal whether an account exists. */
export const GENERIC_AUTH_ERROR = "Invalid email or password";

export type SecurityEvent =
  | "AUTH_LOGIN" | "AUTH_LOGOUT" | "AUTH_LOGOUT_ALL" | "AUTH_PASSWORD_CHANGED" | "AUTH_PASSWORD_RESET_COMPLETED";

/** Best-effort audit write; must never block the auth flow. */
export async function logSecurityEvent(action: SecurityEvent, method?: string) {
  try {
    await supabase.rpc("log_security_event", { p_action: action, p_details: method ? { method } : {} });
  } catch {
    /* ignore */
  }
}

export type SignOutDeps = {
  log: () => Promise<unknown>;
  clearCache: () => Promise<void> | void;
  authSignOut: () => Promise<{ error: { message: string } | null }>;
  invalidate: () => Promise<unknown>;
  navigate: () => unknown;
  logTimeoutMs?: number;
};
export type SignOutResult = { ok: true } | { ok: false; error: string };

/**
 * Single logout pipeline for every entry point. Audit logging is time-boxed and can never block;
 * cache cleanup, router invalidation and navigation always run; ok=true only if auth sign-out succeeded.
 */
export async function runSignOut(d: SignOutDeps): Promise<SignOutResult> {
  await Promise.race([
    d.log().catch(() => undefined),
    new Promise((r) => setTimeout(r, d.logTimeoutMs ?? 2_000)),
  ]);
  let error: string | undefined;
  try {
    const res = await d.authSignOut();
    if (res?.error) error = res.error.message;
  } catch (e) {
    error = e instanceof Error ? e.message : "SIGN_OUT_FAILED";
  }
  try { await d.clearCache(); } catch { /* local cleanup is best-effort */ }
  try { await d.invalidate(); } catch { /* never skip navigation */ }
  try { d.navigate(); } catch (e) {
    if (typeof window !== "undefined") window.location.assign("/auth");
    error ??= e instanceof Error ? e.message : "NAVIGATION_FAILED";
  }
  return error ? { ok: false, error } : { ok: true };
}

/** React hook binding runSignOut to the app's query cache, router and Supabase session. */
export function useSignOut() {
  const qc = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  return async (): Promise<SignOutResult> => {
    const r = await runSignOut({
      log: () => logSecurityEvent("AUTH_LOGOUT"),
      authSignOut: () => supabase.auth.signOut(),
      clearCache: async () => { await qc.cancelQueries(); qc.clear(); },
      invalidate: () => router.invalidate(),
      navigate: () => navigate({ to: "/auth", replace: true }),
    });
    if (!r.ok) toast.error(`Sign-out incomplete: ${r.error}`);
    return r;
  };
}
