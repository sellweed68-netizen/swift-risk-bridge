import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { healthQuery, positionFreshness, versionAtLeast } from "@/lib/market-data";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const num = (v: number | string | null | undefined, d = 2) => (v === null || v === undefined ? "—" : Number(v).toFixed(d));

export function PositionsPanel({ userId }: { userId: string }) {
  const { t } = useI18n();
  const { data: health = [] } = useQuery(healthQuery(userId));
  const { data: rows = [] } = useQuery({
    queryKey: ["broker_positions", userId], refetchInterval: 3_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data, error } = await supabase.from("broker_positions").select("*").eq("user_id", userId)
        .or(`status.eq.open,closed_at.gte.${since}`).order("opened_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  const open = rows.filter((r) => r.status === "open");
  const closed = rows.filter((r) => r.status === "closed").slice(0, 10);
  const floating = open.reduce((s, r) => s + Number(r.profit ?? 0) + Number(r.swap ?? 0), 0);
  // Per-account freshness from server-verified snapshots only (never from heartbeat alone).
  const fresh = (accountId: string) => positionFreshness(health.find((h) => h.account_id === accountId));
  const anyNotLive = open.some((r) => fresh(r.account_id) !== "LIVE");
  const anyUnverified = health.some((h) => positionFreshness(h) === "UNVERIFIED");
  const oldEa = health.length > 0 && health.every((h) => !versionAtLeast(h.ea_version, "0.4"));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("pos.title")} ({open.length})</h2>
        {open.length > 0 && (
          <span className="font-mono text-sm">
            {t("pos.floating")}: <span className={cn(floating >= 0 ? "text-primary" : "text-destructive")}>{num(floating)}</span>
          </span>
        )}
      </div>
      {oldEa && <p className="text-xs text-muted-foreground">{t("pos.oldEa")}</p>}
      {anyUnverified && <p className="text-xs text-destructive">{t("pos.unverified")}</p>}
      {anyNotLive && <p className="text-xs text-destructive">{t("pos.stale")}</p>}
      {open.length === 0 ? <p className="text-sm text-muted-foreground">{t("pos.none")}</p> : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="p-2">Ticket</th><th className="p-2">Symbol</th><th className="p-2">Lot</th>
                <th className="p-2">Open → Now</th><th className="p-2">SL / TP</th><th className="p-2">P/L</th><th className="p-2"></th></tr>
            </thead>
            <tbody>
              {open.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-2 font-mono text-xs">#{r.broker_ticket}</td>
                  <td className="p-2 whitespace-nowrap">{r.direction} {r.broker_symbol}</td>
                  <td className="p-2 font-mono text-xs">{num(r.volume)}</td>
                  <td className="p-2 whitespace-nowrap font-mono text-xs">{r.open_price} → {r.current_price ?? "—"}</td>
                  <td className="p-2 whitespace-nowrap font-mono text-xs">{r.stop_loss ?? "—"} / {r.take_profit ?? "—"}</td>
                  <td className={cn("p-2 font-mono text-xs", Number(r.profit) >= 0 ? "text-primary" : "text-destructive")}>{num(r.profit)}</td>
                  <td className="p-2"><Badge variant="outline">{r.origin === "nexora" ? t("pos.nexora") : t("pos.manual")}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {closed.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t("pos.closed")}</p>
          <ul className="mt-1 space-y-1 text-xs font-mono text-muted-foreground">
            {closed.map((r) => (
              <li key={r.id}>#{r.broker_ticket} {r.direction} {num(r.volume)} {r.broker_symbol} · P/L {num(r.profit)} · {r.closed_at ? new Date(r.closed_at).toLocaleTimeString() : ""}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
