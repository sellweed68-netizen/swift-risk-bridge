// TH/EN UI language. Trading terms (Bid, Ask, Spread, Lot, SL/TP, Drawdown, Equity, P/L,
// HEALTHY/OFFLINE states, mode names) stay in English in both languages so meaning is never lost.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Lang = "en" | "th";
const KEY = "nexora.lang";

const en = {
  "nav.home": "Home", "nav.markets": "Markets", "nav.accounts": "Accounts", "nav.trading": "Trading",
  "nav.ai": "AI", "nav.journal": "Journal", "nav.more": "More", "nav.signOut": "Sign out",
  "shell.mode": "MODE", "shell.aiStopped": "AI STOPPED",
  "home.title": "Home", "home.subtitle": "Live status of your trading system",
  "home.analyze": "Analyze", "home.analyzeLater": "Available after AI integration",
  "home.resume": "Resume AI trading", "home.stop": "Stop AI trading", "home.stopQ": "Stop AI trading?",
  "home.stopBody": "Blocks all new AI-driven entries. Open positions stay open and their Stop Loss and Take Profit are kept. This does not close anything.",
  "home.cancel": "Cancel", "home.resumed": "AI trading resumed", "home.stopped": "AI trading stopped",
  "home.account": "Account", "home.noAccount": "No account linked", "home.equity": "Equity",
  "home.dailyPl": "Daily P/L", "home.positions": "Open positions",
  "home.mode": "Trading mode", "home.modeHint": "Starts in Data only. Auto modes unlock only after MT5 and safety checks pass.",
  "home.modeSet": "Mode set to", "home.active": "ACTIVE", "home.locked": "LOCKED",
  "home.health": "System health", "home.signalNone": "Signal: none · AI: not connected",
  "home.activity": "Recent activity", "home.noActivity": "No activity yet.",
  "health.cloud": "Cloud", "health.mt5": "MT5 / EA", "health.broker": "Broker", "health.market": "Market data", "health.ai": "NEXORA AI",
  "mode.data_only": "Receive market data. No analysis, no orders.",
  "mode.analysis": "AI may analyze. No signals, no orders.",
  "mode.signal": "AI may propose trade plans. You approve every order.",
  "mode.locked": "Locked until the execution plane is verified.",
  "markets.subtitle": "Prices reported by the bridge on your MT5 terminals. Anything not fresh is marked not live.",
  "markets.none": "No accounts yet.", "markets.link": "Link an MT5 account", "markets.install": "and install the bridge.",
  "markets.lastHb": "last heartbeat", "markets.ago": "s ago", "markets.never": "never connected",
  "markets.noPrices": "No prices received yet. Install the bridge from the Accounts page and attach it to a chart.",
  "markets.live": "LIVE", "markets.notLive": "NOT LIVE",
  "q.conn": "Connection not healthy", "q.stale": "Price stale", "q.closed": "No ticks for 5 min (market may be closed)",
  "q.invalid": "Invalid Bid/Ask", "q.spread": "Spread too wide",
  "bridge.title": "MT5 bridge", "bridge.never": "The bridge has never reported for this account.",
  "bridge.last": "Last report", "bridge.terminal": "terminal", "bridge.connected": "connected", "bridge.disconnected": "disconnected",
  "bridge.trading": "trading", "bridge.allowed": "allowed", "bridge.notAllowed": "not allowed",
  "bridge.token": "Token", "bridge.none": "none", "bridge.create": "Create token", "bridge.replace": "Replace token", "bridge.revoke": "Revoke",
  "bridge.replaceQ": "Issuing a new token disconnects the bridge using the old one. Continue?",
  "bridge.revokeQ": "Revoke the token? The bridge stops reporting until a new token is set.",
  "bridge.revoked": "Token revoked", "bridge.copyNow": "Copy this token now — it will not be shown again.", "bridge.copied": "Token copied",
  "bridge.step1": "Download the bridge file and put it in MT5 → File → Open Data Folder → MQL5/Experts, then compile it.",
  "bridge.step2": "In MT5 → Tools → Options → Expert Advisors, allow WebRequest for",
  "bridge.step3": "Attach the bridge to any chart and paste the token and this address into its inputs:",
  "bridge.download": "Download bridge (MQL5)",
  "bridge.safety": "The bridge only reports account status and prices. It never sends orders in this version, and your MT5 password never leaves your computer.",
  "ai.subtitle": "NEXORA AI proposes a structured Trade Plan. It never places orders.",
  "ai.symbol": "Symbol", "ai.analyze": "Analyze", "ai.running": "Analyzing…", "ai.noQuotes": "No prices yet — connect the MT5 bridge first.", "ai.sim": "Simulate demo feed (XAUUSD)", "ai.simDone": "Simulated prices loaded — demo account only", "ai.simNoDemo": "Add a demo account first (Accounts page)",
  "ai.history": "Analysis history", "ai.none": "No analyses yet.", "ai.blocked": "Blocked by data quality gate",
  "ai.confidence": "AI confidence (not win probability)", "ai.reasons": "Reasons", "ai.evidence": "Evidence", "ai.warnings": "Warnings", "ai.facts": "Facts", "ai.observations": "Observations", "ai.inferences": "Inferences", "ai.assumptions": "Assumptions",
  "ai.scenario": "Scenario", "ai.invalidation": "Invalidation", "ai.expiry": "Expiry (min)", "ai.chart": "Chart (M1)", "ai.done": "Analysis saved",
  "ai.err.MODE_DATA_ONLY": "Mode is Data only. Switch to Analysis or Signal on Home.", "ai.err.NO_QUOTE": "No price for this symbol.",
  "tr.subtitle": "Approve AI Trade Plans. Every order passes the Execution Safety Gate before it reaches MT5.",
  "tr.pending": "Trade Plans awaiting approval", "tr.noPending": "No tradeable plans in the last 15 minutes. Run Analyze on the AI page.",
  "tr.volume": "Lot", "tr.approve": "Approve & queue", "tr.approveQ": "Send this order to the MT5 bridge?", "tr.approveBody": "The safety gate re-checks permission, risk, exposure and live prices. AI never sends orders by itself.",
  "tr.confirm": "Confirm", "tr.cancel": "Cancel order", "tr.queue": "Bridge queue", "tr.queueEmpty": "Queue is empty.",
  "tr.orders": "Order status", "tr.noOrders": "No orders yet.", "tr.pre": "Pre-trade", "tr.post": "Post-trade", "tr.slippage": "Slippage (pts)", "tr.latency": "Latency",
  "pos.title": "Open positions", "pos.none": "No open positions reported by MT5.", "pos.oldEa": "Download EA v0.4 so MT5 reports verified open positions.", "pos.unverified": "Last MT5 position snapshot could not be verified (incomplete or out of order) — showing last verified state.", "pos.floating": "Floating P/L", "pos.manual": "Manual", "pos.nexora": "NEXORA", "pos.closed": "Recently closed", "pos.stale": "Not live — no recent verified MT5 position snapshot; figures may be out of date.",
  "tr.gate": "Safety gate", "tr.passed": "All checks passed", "tr.queued": "Order approved and queued for MT5", "tr.rejected": "Rejected by safety gate", "tr.cancelled": "Order cancelled",
  "tr.modeNote": "Orders need Signal mode (set on Home). Data only and Analysis never execute.", "tr.unknownNote": "An order has UNKNOWN status. It will not be resent; new orders are blocked until the bridge reconciles it with the broker.",
  "tr.eaNote": "To execute, set InpExecute = true in NexoraBridge v0.2 (download again from Accounts). Use a demo account first.",
  "tr.expires": "expires in", "tr.min": "min",
  "lang.label": "Language",
};
export type TKey = keyof typeof en;

const th: Record<TKey, string> = {
  "nav.home": "หน้าหลัก", "nav.markets": "ตลาด", "nav.accounts": "บัญชี", "nav.trading": "เทรด",
  "nav.ai": "AI", "nav.journal": "บันทึก", "nav.more": "เพิ่มเติม", "nav.signOut": "ออกจากระบบ",
  "shell.mode": "MODE", "shell.aiStopped": "AI STOPPED",
  "home.title": "หน้าหลัก", "home.subtitle": "สถานะระบบเทรดแบบเรียลไทม์",
  "home.analyze": "วิเคราะห์", "home.analyzeLater": "ใช้ได้หลังเชื่อมต่อ AI",
  "home.resume": "เปิด AI trading อีกครั้ง", "home.stop": "หยุด AI trading", "home.stopQ": "หยุด AI trading ใช่ไหม?",
  "home.stopBody": "บล็อกการเข้าออเดอร์ใหม่ทั้งหมดที่มาจาก AI โพซิชันที่เปิดอยู่ยังคงเปิดอยู่ และ Stop Loss / Take Profit ยังคงอยู่ครบ ไม่มีการปิดโพซิชันใดๆ",
  "home.cancel": "ยกเลิก", "home.resumed": "เปิด AI trading แล้ว", "home.stopped": "หยุด AI trading แล้ว",
  "home.account": "บัญชี", "home.noAccount": "ยังไม่ได้เชื่อมบัญชี", "home.equity": "Equity",
  "home.dailyPl": "P/L วันนี้", "home.positions": "โพซิชันที่เปิดอยู่",
  "home.mode": "โหมดการเทรด", "home.modeHint": "เริ่มต้นที่ Data only โหมดอัตโนมัติจะปลดล็อกเมื่อ MT5 และการตรวจความปลอดภัยผ่านแล้วเท่านั้น",
  "home.modeSet": "ตั้งโหมดเป็น", "home.active": "ACTIVE", "home.locked": "LOCKED",
  "home.health": "สุขภาพระบบ", "home.signalNone": "Signal: ไม่มี · AI: ยังไม่เชื่อมต่อ",
  "home.activity": "กิจกรรมล่าสุด", "home.noActivity": "ยังไม่มีกิจกรรม",
  "health.cloud": "Cloud", "health.mt5": "MT5 / EA", "health.broker": "โบรกเกอร์", "health.market": "ข้อมูลตลาด", "health.ai": "NEXORA AI",
  "mode.data_only": "รับข้อมูลตลาดอย่างเดียว ไม่วิเคราะห์ ไม่ส่งออเดอร์",
  "mode.analysis": "AI วิเคราะห์ได้ ไม่สร้าง Signal ไม่ส่งออเดอร์",
  "mode.signal": "AI เสนอ Trade Plan ได้ คุณต้องอนุมัติทุกออเดอร์เอง",
  "mode.locked": "ล็อกไว้จนกว่าระบบส่งคำสั่ง (execution plane) จะผ่านการตรวจสอบ",
  "markets.subtitle": "ราคาที่ส่งมาจากตัวเชื่อม (bridge) บน MT5 ของคุณ ข้อมูลที่ไม่สดจะถูกแจ้งว่าไม่ใช่ราคาสด",
  "markets.none": "ยังไม่มีบัญชี", "markets.link": "เชื่อมบัญชี MT5", "markets.install": "แล้วติดตั้งตัวเชื่อม",
  "markets.lastHb": "heartbeat ล่าสุด", "markets.ago": " วินาทีที่แล้ว", "markets.never": "ยังไม่เคยเชื่อมต่อ",
  "markets.noPrices": "ยังไม่ได้รับราคา ติดตั้งตัวเชื่อมจากหน้าบัญชีแล้ววางบนกราฟใดก็ได้",
  "markets.live": "LIVE", "markets.notLive": "NOT LIVE",
  "q.conn": "การเชื่อมต่อไม่ปกติ", "q.stale": "ราคาไม่สด (stale)", "q.closed": "ไม่มี tick 5 นาที (ตลาดอาจปิด)",
  "q.invalid": "Bid/Ask ผิดปกติ", "q.spread": "Spread กว้างเกินกำหนด",
  "bridge.title": "ตัวเชื่อม MT5", "bridge.never": "ตัวเชื่อมยังไม่เคยส่งข้อมูลสำหรับบัญชีนี้",
  "bridge.last": "รายงานล่าสุด", "bridge.terminal": "เทอร์มินัล", "bridge.connected": "เชื่อมต่อแล้ว", "bridge.disconnected": "ไม่ได้เชื่อมต่อ",
  "bridge.trading": "การเทรด", "bridge.allowed": "อนุญาต", "bridge.notAllowed": "ไม่อนุญาต",
  "bridge.token": "โทเคน", "bridge.none": "ไม่มี", "bridge.create": "สร้างโทเคน", "bridge.replace": "เปลี่ยนโทเคน", "bridge.revoke": "ยกเลิกโทเคน",
  "bridge.replaceQ": "การออกโทเคนใหม่จะตัดการเชื่อมต่อของตัวเชื่อมที่ใช้โทเคนเดิม ดำเนินการต่อไหม?",
  "bridge.revokeQ": "ยกเลิกโทเคนใช่ไหม? ตัวเชื่อมจะหยุดส่งข้อมูลจนกว่าจะใส่โทเคนใหม่",
  "bridge.revoked": "ยกเลิกโทเคนแล้ว", "bridge.copyNow": "คัดลอกโทเคนนี้ตอนนี้ — จะไม่แสดงอีก", "bridge.copied": "คัดลอกโทเคนแล้ว",
  "bridge.step1": "ดาวน์โหลดไฟล์ตัวเชื่อม วางไว้ใน MT5 → File → Open Data Folder → MQL5/Experts แล้วกด Compile",
  "bridge.step2": "ใน MT5 → Tools → Options → Expert Advisors ให้อนุญาต WebRequest สำหรับ",
  "bridge.step3": "ลากตัวเชื่อมไปวางบนกราฟใดก็ได้ แล้ววางโทเคนและที่อยู่นี้ในช่อง Inputs:",
  "bridge.download": "ดาวน์โหลดตัวเชื่อม (MQL5)",
  "bridge.safety": "ตัวเชื่อมเวอร์ชันนี้ส่งแค่สถานะบัญชีและราคา ไม่ส่งออเดอร์ใดๆ และรหัสผ่าน MT5 ไม่ออกจากเครื่องของคุณ",
  "ai.subtitle": "NEXORA AI เสนอ Trade Plan แบบมีโครงสร้าง และไม่ส่งออเดอร์เอง",
  "ai.symbol": "สัญลักษณ์", "ai.analyze": "วิเคราะห์", "ai.running": "กำลังวิเคราะห์…", "ai.noQuotes": "ยังไม่มีราคา — เชื่อมต่อ MT5 bridge ก่อน", "ai.sim": "จำลองราคาทดสอบ (XAUUSD)", "ai.simDone": "โหลดราคาจำลองแล้ว — ใช้กับบัญชี demo เท่านั้น", "ai.simNoDemo": "เพิ่มบัญชี demo ก่อน (หน้า Accounts)",
  "ai.history": "ประวัติการวิเคราะห์", "ai.none": "ยังไม่มีการวิเคราะห์", "ai.blocked": "ถูกบล็อกโดยด่านตรวจคุณภาพข้อมูล",
  "ai.confidence": "ความมั่นใจของ AI (ไม่ใช่โอกาสชนะ)", "ai.reasons": "เหตุผล", "ai.evidence": "หลักฐาน", "ai.warnings": "คำเตือน", "ai.facts": "ข้อเท็จจริง (Fact)", "ai.observations": "สิ่งที่สังเกตได้ (Observation)", "ai.inferences": "การอนุมาน (Inference)", "ai.assumptions": "สมมติฐาน (Assumption)",
  "ai.scenario": "สถานการณ์", "ai.invalidation": "เงื่อนไขที่แผนใช้ไม่ได้", "ai.expiry": "หมดอายุ (นาที)", "ai.chart": "กราฟ (M1)", "ai.done": "บันทึกผลวิเคราะห์แล้ว",
  "ai.err.MODE_DATA_ONLY": "โหมดเป็น Data only ให้เปลี่ยนเป็น Analysis หรือ Signal ที่หน้าหลัก", "ai.err.NO_QUOTE": "ไม่มีราคาของสัญลักษณ์นี้",
  "tr.subtitle": "อนุมัติ Trade Plan จาก AI ทุกคำสั่งต้องผ่าน Execution Safety Gate ก่อนถึง MT5",
  "tr.pending": "Trade Plan ที่รออนุมัติ", "tr.noPending": "ไม่มีแผนที่เทรดได้ใน 15 นาทีล่าสุด ให้กด Analyze ที่หน้า AI",
  "tr.volume": "Lot", "tr.approve": "อนุมัติและส่งเข้าคิว", "tr.approveQ": "ส่งคำสั่งนี้ไปยัง MT5 bridge ใช่ไหม?", "tr.approveBody": "ระบบจะตรวจสิทธิ์ ความเสี่ยง Exposure และราคาสดอีกครั้ง AI ไม่ส่งคำสั่งเอง",
  "tr.confirm": "ยืนยัน", "tr.cancel": "ยกเลิกคำสั่ง", "tr.queue": "คิวส่งไป Bridge", "tr.queueEmpty": "คิวว่าง",
  "tr.orders": "สถานะคำสั่ง", "tr.noOrders": "ยังไม่มีคำสั่ง", "tr.pre": "ก่อนเทรด (Pre-trade)", "tr.post": "หลังเทรด (Post-trade)", "tr.slippage": "Slippage (จุด)", "tr.latency": "เวลาตอบสนอง",
  "pos.title": "ไม้ที่เปิดอยู่", "pos.none": "MT5 ยังไม่มีไม้ที่เปิดอยู่", "pos.oldEa": "ดาวน์โหลด EA v0.4 เพื่อให้ MT5 ส่งรายการไม้ที่ตรวจสอบได้", "pos.unverified": "รายการไม้ล่าสุดจาก MT5 ตรวจสอบไม่ผ่าน (ไม่ครบหรือมาผิดลำดับ) — แสดงสถานะล่าสุดที่ตรวจสอบแล้ว", "pos.floating": "กำไร/ขาดทุนลอยตัว", "pos.manual": "เปิดเอง", "pos.nexora": "NEXORA", "pos.closed": "ปิดล่าสุด", "pos.stale": "ไม่สด — ตัวเชื่อม MT5 ออฟไลน์ ตัวเลขอาจไม่เป็นปัจจุบัน",
  "tr.gate": "ด่านความปลอดภัย", "tr.passed": "ผ่านทุกการตรวจ", "tr.queued": "อนุมัติแล้ว รอส่งไป MT5", "tr.rejected": "ถูกปฏิเสธโดยด่านความปลอดภัย", "tr.cancelled": "ยกเลิกคำสั่งแล้ว",
  "tr.modeNote": "การส่งคำสั่งต้องใช้โหมด Signal (ตั้งที่หน้าหลัก) โหมด Data only และ Analysis จะไม่ส่งคำสั่ง", "tr.unknownNote": "มีคำสั่งสถานะ UNKNOWN ระบบจะไม่ส่งซ้ำ และบล็อกคำสั่งใหม่จนกว่า Bridge จะตรวจสอบกับโบรกเกอร์",
  "tr.eaNote": "หากต้องการให้ส่งคำสั่งจริง ให้ตั้ง InpExecute = true ใน NexoraBridge v0.2 (ดาวน์โหลดใหม่ที่หน้า Accounts) ควรทดสอบกับบัญชี demo ก่อน",
  "tr.expires": "หมดอายุใน", "tr.min": "นาที",
  "lang.label": "ภาษา",
};

const DICTS: Record<Lang, Record<TKey, string>> = { en, th };

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: TKey) => string };
const I18nContext = createContext<Ctx>({ lang: "en", setLang: () => {}, t: (k) => en[k] });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    if (stored === "en" || stored === "th") setLangState(stored);
    // Signed-in users: the saved profile preference wins over this device's value.
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: p } = await supabase.from("profiles").select("language").eq("id", data.user.id).maybeSingle();
      if (p?.language === "en" || p?.language === "th") {
        setLangState(p.language);
        localStorage.setItem(KEY, p.language);
      }
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem(KEY, l);
    // The query builder is lazy: it must be awaited or the request is never sent.
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) await supabase.from("profiles").update({ language: l }).eq("id", data.user.id);
    })();
  }, []);

  const t = useCallback((k: TKey) => DICTS[lang][k], [lang]);
  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div role="group" aria-label={t("lang.label")} className={className}>
      {(["th", "en"] as const).map((l) => (
        <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
          className={`rounded px-2 py-1 font-mono text-xs ${lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
