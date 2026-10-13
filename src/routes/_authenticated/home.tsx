import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { OctagonX, Play, ScanSearch } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  auditQuery, controlStateQuery, friendlyDbError, rolesQuery, TRADING_MODES, type HealthState, type TradingMode,
} from "@/lib/control-plane";
import { PageHeader } from "@/components/workstream-placeholder";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useI18n, type TKey } from "@/lib/i18n";
import { accountsQuery, formatMoney } from "@/lib/accounts";
import { connectionState, healthQuery, quoteQuality, quotesQuery } from "@/lib/market-data";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({ meta: [{ title: "Home — NEXORA MT5" }, { name: "description", content: "Connection, account, and AI trading status." }] }),
  component: HomePage,
});

// Semantic compare of dotted numeric versions ("0.10" > "0.3"); unparseable → false.
function versionAtLeast(v: string | null | undefined, min: string) {
  if (!v || !/^\d+(\.\d+)*$/.test(v)) return false;
  const a = v.split(".").map(Number), b = min.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

const RANK: Record<HealthState, number> = { HEALTHY: 3, DEGRADED: 2, OFFLINE: 1, UNKNOWN: 0 };

function Dot({ s }: { s: HealthState }) {
  return <span className={cn("inline-block h-2 w-2 rounded-full",
    s === "HEALTHY" && "bg-success", s === "DEGRADED" && "bg-warning",
    s === "OFFLINE" && "bg-destructive", s === "UNKNOWN" && "bg-muted-foreground")} />;
}

function HomePage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data: cs } = useQuery(controlStateQuery(user.id));
  const { data: roles = [] } = useQuery(rolesQuery(user.id));
  const { data: audit = [] } = useQuery(auditQuery(user.id, 8));
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();
  const { data: accounts = [] } = useQuery(accountsQuery(user.id));
  const { data: health = [] } = useQuery(healthQuery(user.id));
  const { data: quotes = [] } = useQuery(quotesQuery(user.id));
  const liveAccounts = accounts.filter((a) => a.status === "active");
  const primary = liveAccounts[0];
  const primaryHealth = primary ? health.find((h) => h.account_id === primary.id) : undefined;
  // Best connection across active accounts; UNKNOWN until a real heartbeat exists.
  const mt5State = liveAccounts.reduce<HealthState>((best, a) => {
    const s = connectionState(health.find((h) => h.account_id === a.id));
    return RANK[s] > RANK[best] ? s : best;
  }, "UNKNOWN");
  const marketState: HealthState = quotes.length === 0 ? "UNKNOWN"
    : quotes.some((q) => quoteQuality(q, connectionState(health.find((h) => h.account_id === q.account_id))).ok) ? "HEALTHY"
    : "DEGRADED";
  const HEALTH: { name: TKey; state: HealthState }[] = [
    { name: "health.cloud", state: "HEALTHY" },
    { name: "health.mt5", state: mt5State },
    { name: "health.broker", state: primaryHealth && mt5State === "HEALTHY" ? (primaryHealth.terminal_connected ? "HEALTHY" : "OFFLINE") : "UNKNOWN" },
    { name: "health.market", state: marketState },
    { name: "health.ai", state: "UNKNOWN" },
  ];
  const fresh = primaryHealth && connectionState(primaryHealth) === "HEALTHY";
  // Positions are trusted only when the account heartbeat is fresh AND the EA (>= 0.3) sends a
  // full position snapshot with every heartbeat, so a fresh heartbeat is account-level snapshot evidence.
  const eaReportsPositions = versionAtLeast(primaryHealth?.ea_version, "0.3");
  const { data: positions, isError: posError } = useQuery({
    queryKey: ["broker_positions", "home", user.id, primary?.id],
    enabled: Boolean(primary),
    refetchInterval: 5_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("broker_positions").select("account_id,profit,swap")
        .eq("user_id", user.id).eq("account_id", primary!.id).eq("status", "open");
      if (error) throw error;
      return data ?? [];
    },
  });
  const posLive = Boolean(fresh && eaReportsPositions && positions && !posError
    && positions.every((p) => p.account_id === primary?.id));
  const floating = posLive ? positions!.reduce((s, p) => s + Number(p.profit ?? 0) + Number(p.swap ?? 0), 0) : null;
  const posNote = !primary ? null : !fresh ? t("pos.stale") : !eaReportsPositions ? t("pos.oldEa") : posError ? t("pos.stale") : null;
  const readOnly = roles.includes("viewer") && !roles.some((r) => r !== "viewer");

  async function update(patch: { trading_mode?: TradingMode; ai_trading_halted?: boolean }, ok: string) {
    setBusy(true);
    const { error } = await supabase.from("control_state").update(patch).eq("user_id", user.id);
    setBusy(false);
    if (error) {
      toast.error(friendlyDbError(error.message));
      return;
    }
    toast.success(ok);
    qc.invalidateQueries({ queryKey: ["control_state", user.id] });
    qc.invalidateQueries({ queryKey: ["audit", user.id] });
  }

  const halted = cs?.ai_trading_halted ?? false;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("home.title")} subtitle={t("home.subtitle")}>
        <div className="flex gap-2">
          <Button variant="outline" disabled title={t("home.analyzeLater")}>
            <ScanSearch className="mr-2 h-4 w-4" />{t("home.analyze")}
          </Button>
          {halted ? (
            <Button disabled={busy || readOnly} onClick={() => update({ ai_trading_halted: false }, t("home.resumed"))}>
              <Play className="mr-2 h-4 w-4" />{t("home.resume")}
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={busy || readOnly}><OctagonX className="mr-2 h-4 w-4" />{t("home.stop")}</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("home.stopQ")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("home.stopBody")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("home.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => update({ ai_trading_halted: true }, t("home.stopped"))}>{t("home.stop")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </PageHeader>

      <section className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t("home.account"), primary ? primary.label : t("home.noAccount")],
          [t("home.equity"), fresh ? formatMoney(primaryHealth.equity, primary?.currency) : "—"],
          [t("pos.floating"), posLive ? formatMoney(floating, primary?.currency) : "—"],
          [t("home.positions"), posLive ? String(positions!.length) : "—"],
        ].map(([k, v]) => (
          <div key={k} className="bg-card p-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{k}</p>
            <p className="mt-2 font-mono text-xl">{v}</p>
          </div>
        ))}
      </section>
      {posNote && <p className="mt-2 text-xs text-muted-foreground">{posNote}</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="rounded-lg border bg-card p-5 lg:col-span-2">
          <h2 className="font-medium">{t("home.mode")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("home.modeHint")}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {TRADING_MODES.map((m) => {
              const active = cs?.trading_mode === m.value;
              return (
                <button key={m.value}
                  disabled={busy || readOnly || m.locked || active}
                  onClick={() => update({ trading_mode: m.value }, `${t("home.modeSet")} ${m.label}`)}
                  className={cn("rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed",
                    active ? "border-primary bg-primary/10" : "hover:bg-accent",
                    m.locked && "opacity-50")}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{m.label}</span>
                    {active && <span className="font-mono text-[10px] text-primary">{t("home.active")}</span>}
                    {m.locked && <span className="font-mono text-[10px] text-muted-foreground">{t("home.locked")}</span>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{t(m.locked ? "mode.locked" : (`mode.${m.value}` as TKey))}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <h2 className="font-medium">{t("home.health")}</h2>
          <ul className="mt-4 space-y-3">
            {HEALTH.map((h) => (
              <li key={h.name} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2"><Dot s={h.state} />{t(h.name)}</span>
                <span className="font-mono text-xs text-muted-foreground">{h.state}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">{t("home.signalNone")}</p>
        </section>
      </div>

      <section className="mt-6 rounded-lg border bg-card p-5">
        <h2 className="font-medium">{t("home.activity")}</h2>
        <ul className="mt-3 divide-y text-sm">
          {audit.length === 0 && <li className="py-2 text-muted-foreground">{t("home.noActivity")}</li>}
          {audit.map((a) => (
            <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="font-mono text-xs">{a.action}</span>
              <span className="font-mono text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
