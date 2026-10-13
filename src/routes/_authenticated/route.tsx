import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { Home, LineChart, Wallet, ArrowLeftRight, Cpu, BookOpen, MoreHorizontal, LogOut } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { controlStateQuery, TRADING_MODES } from "@/lib/control-plane";
import { cn } from "@/lib/utils";
import { LanguageSwitch, useI18n, type TKey } from "@/lib/i18n";
import { useSignOut } from "@/lib/security";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: Shell,
});

const NAV = [
  { to: "/home", label: "nav.home", icon: Home },
  { to: "/markets", label: "nav.markets", icon: LineChart },
  { to: "/accounts", label: "nav.accounts", icon: Wallet },
  { to: "/trading", label: "nav.trading", icon: ArrowLeftRight },
  { to: "/ai", label: "nav.ai", icon: Cpu },
  { to: "/journal", label: "nav.journal", icon: BookOpen },
  { to: "/more", label: "nav.more", icon: MoreHorizontal },
] as const satisfies readonly { to: string; label: TKey; icon: unknown }[];

function Shell() {
  const { user } = Route.useRouteContext();
  const signOut = useSignOut();
  const { data: cs } = useQuery(controlStateQuery(user.id));
  const { t } = useI18n();
  const mode = TRADING_MODES.find((m) => m.value === cs?.trading_mode);

  return (
    <div className="min-h-screen bg-background text-foreground md:flex">
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="px-5 py-5 font-mono text-sm font-semibold tracking-[0.2em] text-primary">NEXORA·MT5</div>
        <nav className="flex-1 space-y-0.5 px-2">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              activeProps={{ className: "bg-sidebar-accent text-foreground" }}>
              <n.icon className="h-4 w-4" />{t(n.label)}
            </Link>
          ))}
        </nav>
        <div className="border-t p-3 text-xs">
          <p className="truncate text-muted-foreground">{user.email}</p>
          <button onClick={() => void signOut()} className="mt-2 flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <LogOut className="h-3.5 w-3.5" />{t("nav.signOut")}
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/90 px-4 py-3 backdrop-blur md:px-8">
          <span className="font-mono text-xs font-semibold tracking-[0.2em] text-primary md:hidden">NEXORA·MT5</span>
          <div className="ml-auto flex items-center gap-2 font-mono text-xs">
            {cs?.ai_trading_halted && (
              <span className="rounded border border-destructive/50 px-2 py-1 text-destructive">{t("shell.aiStopped")}</span>
            )}
            <LanguageSwitch className="flex rounded border p-0.5" />
            <span className="rounded border px-2 py-1 text-muted-foreground">{t("shell.mode")}: {mode?.label.toUpperCase() ?? "…"}</span>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8"><Outlet /></main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-7 border-t bg-sidebar md:hidden">
        {NAV.map((n) => (
          <Link key={n.to} to={n.to}
            className={cn("flex flex-col items-center gap-1 py-2.5 text-[10px] text-muted-foreground")}
            activeProps={{ className: "text-primary" }}>
            <n.icon className="h-5 w-5" />{t(n.label)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
