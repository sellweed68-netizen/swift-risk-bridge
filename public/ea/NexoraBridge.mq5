//+------------------------------------------------------------------+
//| NexoraBridge.mq5 — NEXORA MT5 execution bridge (v0.3)          |
//| Sends heartbeat, account snapshot and quotes to NEXORA MT5.       |
//| Execution is OFF unless InpExecute=true. Orders come only from    |
//| NEXORA approvals; the EA never resends an unclear order.          |
//| Your MT5 password is never read or sent.                          |
//+------------------------------------------------------------------+
#property copyright "NEXORA MT5"
#property version   "0.30"
#include <Trade/Trade.mqh>
#property strict

input string InpEndpoint = "https://YOUR-APP/api/public/mt5/ingest"; // Ingest address (from Accounts page)
input string InpToken    = "";                                        // Connector token (nxr_...)
input string InpSymbols  = "XAUUSD";                                  // Broker symbols, comma separated (max 50)
input int    InpSeconds  = 5;                                         // Report interval (seconds, 2-60)
input bool   InpExecute  = false;                                     // Execute NEXORA-approved orders (off = report-only)

#define EA_VERSION "0.3.0"
string g_symbols[];
int    g_fail = 0;

int OnInit()
{
   if(StringLen(InpToken) != 68 || StringFind(InpToken, "nxr_") != 0)
   { Print("NEXORA: token missing or malformed"); return INIT_PARAMETERS_INCORRECT; }
   int n = StringSplit(InpSymbols, ',', g_symbols);
   if(n <= 0 || n > 50) { Print("NEXORA: 1-50 symbols required"); return INIT_PARAMETERS_INCORRECT; }
   for(int i = 0; i < n; i++)
   {
      StringTrimLeft(g_symbols[i]); StringTrimRight(g_symbols[i]);
      SymbolSelect(g_symbols[i], true);
   }
   EventSetTimer(MathMax(2, MathMin(60, InpSeconds)));
   Send();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }
void OnTimer() { Send(); if(InpExecute) PullOrders(); }

string Iso(datetime t)
{
   // MT5 times are broker server time; convert to UTC using the terminal's offset.
   datetime utc = t - (TimeTradeServer() - TimeGMT());
   MqlDateTime d; TimeToStruct(utc, d);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ", d.year, d.mon, d.day, d.hour, d.min, d.sec);
}

string Num(double v, int digits) { return DoubleToString(v, digits); }
string Bool(bool b) { return b ? "true" : "false"; }

// Open positions snapshot (read-only; the EA never modifies or closes them here).
string Positions()
{
   string out = "";
   int n = MathMin(PositionsTotal(), 100);
   for(int i = 0; i < n; i++)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0 || !PositionSelectByTicket(tk)) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      string cm = PositionGetString(POSITION_COMMENT);
      StringReplace(cm, "\\", ""); StringReplace(cm, "\"", "");
      if(out != "") out += ",";
      out += StringFormat("{\"ticket\":\"%I64u\",\"symbol\":\"%s\",\"type\":\"%s\",\"volume\":%s,\"open_price\":%s,\"price\":%s,"
                          "\"sl\":%s,\"tp\":%s,\"swap\":%s,\"profit\":%s,\"comment\":\"%s\",\"open_time\":\"%s\"}",
         tk, sym, PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "BUY" : "SELL",
         Num(PositionGetDouble(POSITION_VOLUME), 2), Num(PositionGetDouble(POSITION_PRICE_OPEN), digits),
         Num(PositionGetDouble(POSITION_PRICE_CURRENT), digits), Num(PositionGetDouble(POSITION_SL), digits),
         Num(PositionGetDouble(POSITION_TP), digits), Num(PositionGetDouble(POSITION_SWAP), 2),
         Num(PositionGetDouble(POSITION_PROFIT), 2), StringSubstr(cm, 0, 60), Iso((datetime)PositionGetInteger(POSITION_TIME)));
   }
   return out;
}

void Send()
{
   string q = "";
   for(int i = 0; i < ArraySize(g_symbols); i++)
   {
      MqlTick t;
      if(!SymbolInfoTick(g_symbols[i], t) || t.bid <= 0 || t.ask <= 0) continue;
      int digits = (int)SymbolInfoInteger(g_symbols[i], SYMBOL_DIGITS);
      int spread = (int)SymbolInfoInteger(g_symbols[i], SYMBOL_SPREAD);
      if(q != "") q += ",";
      q += StringFormat("{\"symbol\":\"%s\",\"bid\":%s,\"ask\":%s,\"spread\":%d,\"digits\":%d,\"time\":\"%s\"}",
                        g_symbols[i], Num(t.bid, digits), Num(t.ask, digits), spread, digits, Iso(t.time));
   }

   string pos = Positions();
   string body = StringFormat(
      "{\"login\":\"%I64d\",\"ea_version\":\"%s\",\"terminal_connected\":%s,\"trade_allowed\":%s,"
      "\"balance\":%s,\"equity\":%s,\"margin_free\":%s,\"server_time\":\"%s\",\"quotes\":[%s],\"positions\":[%s]}",
      AccountInfoInteger(ACCOUNT_LOGIN), EA_VERSION,
      Bool(TerminalInfoInteger(TERMINAL_CONNECTED) != 0),
      Bool(TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) != 0 && AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) != 0),
      Num(AccountInfoDouble(ACCOUNT_BALANCE), 2), Num(AccountInfoDouble(ACCOUNT_EQUITY), 2),
      Num(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2), Iso(TimeTradeServer()), q, pos);

   char data[], result[];
   string headers = "Content-Type: application/json\r\nX-Nexora-Token: " + InpToken + "\r\n", resHeaders;
   StringToCharArray(body, data, 0, StringLen(body), CP_UTF8);
   ResetLastError();
   int code = WebRequest("POST", InpEndpoint, headers, 5000, data, result, resHeaders);
   if(code == 200) { if(g_fail > 0) Print("NEXORA: reconnected"); g_fail = 0; return; }
   g_fail++;
   if(code == -1) Print("NEXORA: WebRequest failed (", GetLastError(), "). Allow the URL in Tools > Options > Expert Advisors.");
   else Print("NEXORA: server replied ", code, " ", CharArrayToString(result));
   // Report-only bridge: failures never touch positions, SL or TP.
}

//+------------------------------------------------------------------+
//| Execution bridge                                                  |
//+------------------------------------------------------------------+
CTrade g_trade;

string Url(string path) { string u = InpEndpoint; StringReplace(u, "/ingest", path); return u; }
string Tag(string id) { return "NXR:" + StringSubstr(id, 0, 27); }   // broker comment = idempotency marker

string Post(string url, string body, int &code)
{
   char data[], result[]; string resHeaders;
   string headers = "Content-Type: application/json\r\nX-Nexora-Token: " + InpToken + "\r\n";
   StringToCharArray(body, data, 0, StringLen(body), CP_UTF8);
   code = WebRequest("POST", url, headers, 5000, data, result, resHeaders);
   return CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
}

void Report(string id, string state, ulong ticket, double price, double vol, int retcode, string msg)
{
   StringReplace(msg, "\"", "'");
   string body = StringFormat("{\"order_id\":\"%s\",\"state\":\"%s\",\"retcode\":%d,\"message\":\"%s\"", id, state, retcode, StringSubstr(msg, 0, 190));
   if(ticket > 0) body += StringFormat(",\"ticket\":\"%I64u\"", ticket);
   if(price > 0)  body += ",\"price\":" + DoubleToString(price, 8);
   if(vol > 0)    body += ",\"volume\":" + DoubleToString(vol, 4);
   body += "}";
   int code; Post(Url("/report"), body, code);
   if(code != 200) Print("NEXORA: report failed ", code, " for ", id);   // server will mark UNKNOWN; never resend
}

// Broker-side lookup by comment: a deal for this order already exists?
bool FindDeal(string id, ulong &ticket, double &price, double &vol)
{
   if(!HistorySelect(TimeCurrent() - 7 * 86400, TimeCurrent() + 86400)) return false;
   string tag = Tag(id);
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
   {
      ulong d = HistoryDealGetTicket(i);
      if(HistoryDealGetString(d, DEAL_COMMENT) == tag && HistoryDealGetInteger(d, DEAL_ENTRY) == DEAL_ENTRY_IN)
      { ticket = d; price = HistoryDealGetDouble(d, DEAL_PRICE); vol = HistoryDealGetDouble(d, DEAL_VOLUME); return true; }
   }
   return false;
}

bool DefiniteReject(uint rc)
{
   return rc == TRADE_RETCODE_REQUOTE || rc == TRADE_RETCODE_REJECT || rc == TRADE_RETCODE_PRICE_CHANGED ||
          rc == TRADE_RETCODE_INVALID || rc == TRADE_RETCODE_INVALID_VOLUME || rc == TRADE_RETCODE_INVALID_PRICE ||
          rc == TRADE_RETCODE_INVALID_STOPS || rc == TRADE_RETCODE_TRADE_DISABLED || rc == TRADE_RETCODE_MARKET_CLOSED ||
          rc == TRADE_RETCODE_NO_MONEY || rc == TRADE_RETCODE_PRICE_OFF || rc == TRADE_RETCODE_LIMIT_VOLUME;
}

void PullOrders()
{
   int code; string res = Post(Url("/orders"), "{}", code);
   if(code != 200 || StringFind(res, "OK") != 0) return;
   string lines[]; int n = StringSplit(res, '\n', lines);
   for(int i = 1; i < n; i++)
   {
      string f[]; if(StringSplit(lines[i], '|', f) < 8) continue;
      string mode = f[0], id = f[1], sym = f[2], dir = f[3];
      double vol = StringToDouble(f[4]), sl = StringToDouble(f[5]), tp = StringToDouble(f[6]);
      ulong tk; double px, vv;
      if(FindDeal(id, tk, px, vv)) { Report(id, "FILLED", tk, px, vv, 0, "reconciled from broker history"); continue; }
      if(mode == "R") { Report(id, "REJECTED", 0, 0, 0, 0, "RECONCILED_NOT_FOUND_AT_BROKER"); continue; }
      g_trade.SetDeviationInPoints((ulong)StringToInteger(f[7]));
      bool sent = dir == "BUY" ? g_trade.Buy(vol, sym, 0, sl, tp, Tag(id)) : g_trade.Sell(vol, sym, 0, sl, tp, Tag(id));
      uint rc = g_trade.ResultRetcode();
      if(rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_DONE_PARTIAL)
         Report(id, "FILLED", g_trade.ResultDeal(), g_trade.ResultPrice(), g_trade.ResultVolume(), (int)rc, g_trade.ResultComment());
      else if(rc == TRADE_RETCODE_PLACED)
         Report(id, "ACKNOWLEDGED", g_trade.ResultOrder(), 0, 0, (int)rc, g_trade.ResultComment());
      else if(DefiniteReject(rc))
         Report(id, "REJECTED", 0, 0, 0, (int)rc, g_trade.ResultComment());
      else
         Print("NEXORA: unclear result ", rc, " for ", id, " — left for reconciliation, NOT resent");
   }
}
