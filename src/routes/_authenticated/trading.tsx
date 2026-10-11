import { PositionsPanel } from "@/components/positions-panel";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/workstream-placeholder";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import { canCancel, IN_QUEUE, type ExecState } from "@/lib/execution";
import { useI18n } from "@/lib/i18n";
import type { Database } from "@/integrations/supabase/types";

type Order = Database["public"]["Tables"]["execution_orders"]["Row"];
type Analysis = Database["public"]["Tables"]["ai_analyses"]["Row"];
type Plan = { entry?: number | null; stop_loss?: number | null; take_profit?: number | null; rr?: number | null; confidence?: number };

export const Route = createFileRoute("/_authenticated/trading")({
  head: () => ({
    meta: [
      { title: "Trading — NEXORA MT5" },
      { name: "description", content: "Approve trade plans, track execution state and the MT5 bridge queue." },
      { property: "og:title", content: "Trading — NEXORA MT5" },
      { property: "og:description", content: "Execution safety gate, state machine and real-time order tracking." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TradingPage,
});

const PLAN_TTL_MS = 15 * 60_000;

function stateVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "FILLED") return "default";
  if (s === "REJECTED" || s === "UNKNOWN") return "destructive";
  if (s === "CANCELLED") return "outline";
  return "secondary";
}

const fmt = (v: number | string | null | undefined, d = 5) => (v === null || v === undefined || v === "" ? "—" : Number(v).toFixed(d));

function TradingPage() {
  const { t } = useI18n();
  const { user } = useSession();
  const qc = useQueryClient();
  const uid = user?.id;

  const { data: mode } = useQuery({
    queryKey: ["control_state", uid], enabled: !!uid,
    queryFn: async () => (await supabase.from("control_state").select("trading_mode, ai_trading_halted").eq("user_id", uid!).maybeSingle()).data,
  });
  const { data: orders = [] } = useQuery({
    queryKey: ["execution_orders", uid], enabled: !!uid, refetchInterval: 2_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("execution_orders").select("*").eq("user_id", uid!).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data as Order[];
    },
  });
  const { data: plans = [] } = useQuery({
    queryKey: ["pending_plans", uid], enabled: !!uid, refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("ai_analyses").select("*").eq("user_id", uid!).eq("status", "completed")
        .in("decision", ["BUY", "SELL"]).gte("created_at", new Date(Date.now() - PLAN_TTL_MS).toISOString())
        .order("created_at", { ascending: false }).limit(10);
      if (error) throw error;
      return data as Analysis[];
    },
  });

  const blocked = new Set(orders.filter((o) => o.state !== "REJECTED" && o.state !== "CANCELLED").map((o) => o.analysis_id));
  const pending = plans.filter((p) => !blocked.has(p.id));
  const queue = orders.filter((o) => IN_QUEUE.includes(o.state as ExecState));
  const hasUnknown = orders.some((o) => o.state === "UNKNOWN");
  const refresh = () => qc.invalidateQueries({ queryKey: ["execution_orders", uid] });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={t("nav.trading")} subtitle={t("tr.subtitle")} />

      <div className="space-y-2">
        {mode?.trading_mode !== "signal" && <Notice tone="warn">{t("tr.modeNote")}</Notice>}
        {hasUnknown && <Notice tone="danger">{t("tr.unknownNote")}</Notice>}
        <Notice>{t("tr.eaNote")}</Notice>
      </div>

      {uid && <PositionsPanel userId={uid} />}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("tr.pending")}</h2>
        {pending.length === 0 ? <p className="text-sm text-muted-foreground">{t("tr.noPending")}</p> : (
          <div className="grid gap-3 md:grid-cols-2">
            {pending.map((p) => <PlanCard key={p.id} a={p} onDone={refresh} />)}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("tr.queue")}</h2>
        {queue.length === 0 ? <p className="text-sm text-muted-foreground">{t("tr.queueEmpty")}</p> : (
          <div className="flex flex-wrap gap-2">
            {queue.map((o) => (
              <div key={o.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                <Badge variant={stateVariant(o.state)}>{o.state}</Badge>
                <span className="font-medium">{o.direction} {o.volume} {o.broker_symbol}</span>
                {canCancel(o.state as ExecState) && <CancelButton id={o.id} onDone={refresh} />}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("tr.orders")}</h2>
        {orders.length === 0 ? <p className="text-sm text-muted-foreground">{t("tr.noOrders")}</p> : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">Time</th><th className="p-2">State</th><th className="p-2">Order</th>
                  <th className="p-2">{t("tr.pre")}</th><th className="p-2">{t("tr.post")}</th>
                  <th className="p-2">{t("tr.slippage")}</th><th className="p-2">{t("tr.latency")}</th><th className="p-2">{t("tr.gate")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const d = o.digits ?? 5;
                  const fails = ((o.gate as { fails?: string[] })?.fails ?? []);
                  return (
                    <tr key={o.id} className="border-t border-border align-top">
                      <td className="p-2 whitespace-nowrap text-muted-foreground">{new Date(o.created_at).toLocaleTimeString()}</td>
                      <td className="p-2"><Badge variant={stateVariant(o.state)}>{o.state}</Badge></td>
                      <td className="p-2 whitespace-nowrap">{o.direction} {o.broker_symbol}{o.broker_ticket && <div className="text-xs text-muted-foreground">#{o.broker_ticket}</div>}</td>
                      <td className="p-2 whitespace-nowrap font-mono text-xs">Lot {o.volume} @ {fmt(o.requested_price, d)}<br />SL {fmt(o.stop_loss, d)} · TP {fmt(o.take_profit, d)}</td>
                      <td className="p-2 whitespace-nowrap font-mono text-xs">{o.fill_price ? <>Lot {o.fill_volume ?? "—"} @ {fmt(o.fill_price, d)}</> : "—"}</td>
                      <td className="p-2 font-mono text-xs">{o.slippage_points ?? "—"}</td>
                      <td className="p-2 font-mono text-xs">{o.latency_ms != null ? `${o.latency_ms} ms` : "—"}</td>
                      <td className="p-2 text-xs">
                        {fails.length ? <span className="text-destructive">{fails.join(", ")}</span>
                          : o.state === "REJECTED" || o.state === "UNKNOWN" || o.state === "CANCELLED" ? <span className="text-muted-foreground">{o.reason}</span>
                          : <span className="text-muted-foreground">{t("tr.passed")}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "warn" | "danger" }) {
  const cls = tone === "danger" ? "border-destructive/50 text-destructive" : tone === "warn" ? "border-primary/40" : "border-border text-muted-foreground";
  return <div className={`rounded-md border bg-card px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

function PlanCard({ a, onDone }: { a: Analysis; onDone: () => void }) {
  const { t } = useI18n();
  const plan = (a.plan ?? {}) as Plan;
  const [lot, setLot] = useState("0.01");
  const [busy, setBusy] = useState(false);
  // One key per approval intent: double clicks and retries map to the same order.
  const key = useMemo(() => crypto.randomUUID(), [a.id]);
  const left = Math.max(0, Math.round((new Date(a.created_at).getTime() + PLAN_TTL_MS - Date.now()) / 60_000));

  async function approve() {
    setBusy(true);
    const { data, error } = await supabase.rpc("request_execution", { p_analysis_id: a.id, p_volume: Number(lot), p_idempotency_key: key });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const r = data as { ok: boolean; fails?: string[] };
    if (r.ok) toast.success(t("tr.queued"));
    else toast.error(`${t("tr.rejected")}: ${(r.fails ?? []).join(", ")}`);
    onDone();
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={a.decision === "BUY" ? "default" : "destructive"}>{a.decision}</Badge>
          <span className="font-semibold">{a.canonical_symbol}</span>
          <span className="text-xs text-muted-foreground">v{a.version}</span>
        </div>
        <span className="text-xs text-muted-foreground">{t("tr.expires")} {left} {t("tr.min")}</span>
      </div>
      <div className="grid grid-cols-4 gap-2 font-mono text-xs">
        <div>Entry<br />{plan.entry ?? "—"}</div><div>SL<br />{plan.stop_loss ?? "—"}</div>
        <div>TP<br />{plan.take_profit ?? "—"}</div><div>R:R<br />{plan.rr ?? "—"}</div>
      </div>
      <div className="flex items-end gap-2">
        <label className="text-xs text-muted-foreground">{t("tr.volume")}
          <Input className="mt-1 h-9 w-24" type="number" step="0.01" min="0.01" value={lot} onChange={(e) => setLot(e.target.value)} />
        </label>
        <AlertDialog>
          <AlertDialogTrigger asChild><Button disabled={busy || !(Number(lot) > 0)}>{t("tr.approve")}</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("tr.approveQ")}</AlertDialogTitle>
              <AlertDialogDescription>{a.decision} {lot} {a.broker_symbol} · SL {plan.stop_loss} · TP {plan.take_profit}. {t("tr.approveBody")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("home.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={approve}>{t("tr.confirm")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function CancelButton({ id, onDone }: { id: string; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <Button size="sm" variant="ghost" onClick={async () => {
      const { data, error } = await supabase.rpc("cancel_execution", { p_order_id: id });
      if (error) { toast.error(error.message); return; }
      if ((data as { ok: boolean }).ok) toast.success(t("tr.cancelled"));
      onDone();
    }}>{t("tr.cancel")}</Button>
  );
}
