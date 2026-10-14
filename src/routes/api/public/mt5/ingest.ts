// EA → NEXORA MT5 ingest. Public path (the EA has no browser session); the caller is
// authenticated by its per-account connector token, verified inside the database function.
import { createFileRoute } from "@tanstack/react-router";
import { INGEST_MAX_BYTES, ingestSchema, sessionInitSchema } from "@/lib/market-data";

const json = (body: unknown, status = 200) => Response.json(body, { status });

export const Route = createFileRoute("/api/public/mt5/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-nexora-token") ?? "";
        if (!/^nxr_[0-9a-f]{64}$/.test(token)) return json({ ok: false, error: "INVALID_TOKEN" }, 401);

        const raw = await request.text();
        if (new TextEncoder().encode(raw).length > INGEST_MAX_BYTES) return json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return json({ ok: false, error: "BAD_JSON" }, 400);
        }
        const isInit = typeof body === "object" && body !== null && (body as { action?: unknown }).action === "session_init";
        const parsed = isInit ? sessionInitSchema.safeParse(body) : ingestSchema.safeParse(body);
        if (!parsed.success) return json({ ok: false, error: "BAD_PAYLOAD", issues: parsed.error.issues.slice(0, 5) }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("connector_ingest", { p_token: token, p_payload: parsed.data });
        if (error) return json({ ok: false, error: "INGEST_FAILED" }, 500);
        const result = data as { ok: boolean; error?: string };
        if (!result.ok) {
          const status = result.error === "INVALID_TOKEN" ? 401
            : result.error === "ACTIVE_SESSION_EXISTS" || result.error === "STALE_SESSION" || result.error === "SESSION_REQUIRED" ? 409
            : 403;
          return json(result, status);
        }
        return json(result);
      },
    },
  },
});
