//+------------------------------------------------------------------+
//|                             TraderOS_HistoryImport_v4.mq5        |
//|                    Trader OS - Importador v4 (completo)          |
//+------------------------------------------------------------------+
#property copyright "Trader OS"
#property version   "4.00"
#property strict

input group "=== TRADER OS - SEUS DADOS ==="
input string   InpSupabaseURL   = "https://slffnyslgmdateaaxceo.supabase.co";
input string   InpSupabaseKey   = "sb_publishable_eVZoHCaQE3KO_90UbafL-Q_EIprJt1M";
input string   InpUserId        = "493d6123-08dd-494d-b44d-f1b3df899e0e";
input string   InpAccountId     = "mn9oxslhx3k";

input group "=== PERÍODO ==="
input datetime InpDateFrom      = D'2024.01.01 00:00';
input datetime InpDateTo        = D'2026.12.31 23:59';

input group "=== CONFIGURAÇÕES ==="
input string   InpDefaultSetup  = "MT5";
input int      InpMagicNumber   = 0;
input int      InpDelayMs       = 200;
input bool     InpDebugMode     = true;

int totalSent=0, totalFailed=0;

// Arquivo para persistir ultimo ticket processado
string LAST_TICKET_FILE = "TraderOS_lastTicket.txt";
ulong  gLastTicket = 0;

ulong LoadLastTicket()
  {
   int f = FileOpen(LAST_TICKET_FILE, FILE_READ|FILE_TXT|FILE_ANSI);
   if(f == INVALID_HANDLE) return 0;
   string s = FileReadString(f);
   FileClose(f);
   return (ulong)StringToInteger(s);
  }

void SaveLastTicket(ulong ticket)
  {
   int f = FileOpen(LAST_TICKET_FILE, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(f == INVALID_HANDLE) return;
   FileWriteString(f, IntegerToString((long)ticket));
   FileClose(f);
  }

int OnInit()
  {
   Print("=== TRADER OS IMPORTADOR v4 ===");
   gLastTicket = LoadLastTicket();
   Print("Ultimo ticket salvo: ", gLastTicket);
   EventSetTimer(3);
   return INIT_SUCCEEDED;
  }
void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer()
  {
   EventKillTimer();

   string payload = FetchPayload();
   if(payload == "") { Print("ERRO: Nao foi possivel buscar o payload."); return; }
   Print("Payload carregado. Iniciando importacao...");

   if(!HistorySelect(InpDateFrom, InpDateTo))
     { Print("ERRO ao selecionar historico."); return; }

   int total = HistoryDealsTotal();
   Print("Deals no periodo: ", total);

   int count = 0;
   for(int i = 0; i < total; i++)
     {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;

      ENUM_DEAL_ENTRY entryType = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(ticket, DEAL_ENTRY);
      if(entryType != DEAL_ENTRY_OUT && entryType != DEAL_ENTRY_INOUT) continue;

      if(InpMagicNumber != 0 && HistoryDealGetInteger(ticket, DEAL_MAGIC) != InpMagicNumber) continue;

      // Pular tickets já processados anteriormente
      if(ticket <= gLastTicket)
        { if(InpDebugMode) Print("[SKIP] ticket ", ticket, " <= lastTicket ", gLastTicket); continue; }

      string tradeId = "mt5_" + IntegerToString((int)ticket);
      if(StringFind(payload, tradeId) >= 0)
        { if(InpDebugMode) Print("[SKIP] ", ticket, " ja existe no payload."); continue; }

      // — P&L total —
      double profit     = HistoryDealGetDouble(ticket, DEAL_PROFIT);
      double swap       = HistoryDealGetDouble(ticket, DEAL_SWAP);
      double commission = HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      double pnl        = profit + swap + commission;

      // — Dados do deal —
      string rawSymbol   = HistoryDealGetString(ticket, DEAL_SYMBOL);
      datetime closeTime = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      double exitPrice   = HistoryDealGetDouble(ticket, DEAL_PRICE);
      long   positionId  = HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
      ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(ticket, DEAL_TYPE);
      string comment     = HistoryDealGetString(ticket, DEAL_COMMENT);

      // — Buscar entrada, direção, SL e TP completos —
      double entryPrice = 0;
      double sl         = 0;
      double tp         = 0;
      string direction  = "";

      // PASSO 1: Buscar deal de entrada pelo positionId
      if(HistorySelectByPosition(positionId))
        {
         int pTotal = HistoryDealsTotal();
         for(int j = 0; j < pTotal; j++)
           {
            ulong pTicket = HistoryDealGetTicket(j);
            ENUM_DEAL_ENTRY pEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(pTicket, DEAL_ENTRY);
            if(pEntry == DEAL_ENTRY_IN || pEntry == DEAL_ENTRY_INOUT)
              {
               entryPrice = HistoryDealGetDouble(pTicket, DEAL_PRICE);
               ENUM_DEAL_TYPE pType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(pTicket, DEAL_TYPE);
               direction  = (pType == DEAL_TYPE_BUY) ? "buy" : "sell";
               break;
              }
           }
         HistorySelect(InpDateFrom, InpDateTo);
        }

      // Fallback direção
      if(direction == "")
         direction = (dealType == DEAL_TYPE_SELL) ? "buy" : "sell";

      // PASSO 2: Buscar SL e TP nas ordens do histórico pelo positionId
      // A ordem de abertura contém o SL e TP originais definidos pelo trader
      if(HistorySelectByPosition(positionId))
        {
         int oTotal = HistoryOrdersTotal();
         for(int k = 0; k < oTotal; k++)
           {
            ulong oTicket = HistoryOrderGetTicket(k);
            long  oPosId  = HistoryOrderGetInteger(oTicket, ORDER_POSITION_ID);
            if(oPosId != positionId) continue;

            double oSL = HistoryOrderGetDouble(oTicket, ORDER_SL);
            double oTP = HistoryOrderGetDouble(oTicket, ORDER_TP);

            // Pegar o maior SL/TP encontrado (ordem de abertura costuma ter os maiores)
            if(oSL > 0) sl = oSL;
            if(oTP > 0) tp = oTP;
           }
         HistorySelect(InpDateFrom, InpDateTo);
        }

      // PASSO 3: Complementar com o comentário do deal de fechamento
      // MT5 escreve [sl 4250.049] ou [tp 4348.350] no comentário ao fechar
      {
       string cmt = comment;
       StringToLower(cmt);
       // Extrair SL do comentário se ainda não temos
       if(sl == 0)
         {
          int slPos = StringFind(cmt, "[sl ");
          if(slPos >= 0) { string p = StringSubstr(cmt, slPos+4); int e = StringFind(p,"]"); if(e>0) sl = StringToDouble(StringSubstr(p,0,e)); }
         }
       // Extrair TP do comentário se ainda não temos
       if(tp == 0)
         {
          int tpPos = StringFind(cmt, "[tp ");
          if(tpPos >= 0) { string p = StringSubstr(cmt, tpPos+4); int e = StringFind(p,"]"); if(e>0) tp = StringToDouble(StringSubstr(p,0,e)); }
         }
      }

      // PASSO 4: Se ainda falta SL ou TP, inferir pelo lado oposto usando RR=1
      // Lógica: se temos entry + SL mas não TP → TP = entry + (entry - sl)
      //         se temos entry + TP mas não SL → SL = entry - (tp - entry)
      if(entryPrice > 0)
        {
         if(sl > 0 && tp == 0)
           {
            double risk = MathAbs(entryPrice - sl);
            tp = (direction == "buy") ? entryPrice + risk : entryPrice - risk;
           }
         if(tp > 0 && sl == 0)
           {
            double reward = MathAbs(tp - entryPrice);
            sl = (direction == "buy") ? entryPrice - reward : entryPrice + reward;
           }
        }

      // — Calcular R Múltiplo com SL e TP —
      double rr = 0;
      if(sl > 0 && entryPrice > 0)
        {
         double risk   = MathAbs(entryPrice - sl);
         double reward = MathAbs(exitPrice - entryPrice);
         if(risk > 0)
           {
            // R negativo se perdeu, positivo se ganhou
            if(pnl >= 0)
               rr = NormalizeDouble(reward / risk, 1);
            else
               rr = NormalizeDouble(-reward / risk, 1);
           }
        }

      // — Par formatado —
      string pair = FormatSymbol(rawSymbol);

      // — Categoria: XAU é FX (forex de metais), não Futuros —
      string category = DetectCategory(rawSymbol);

      // — Sessão —
      string session = DetectSession(closeTime);

      // — Notas limpas —
      string notes = (comment != "") ? comment : "";
      StringReplace(notes, "\"", "'");
      StringReplace(notes, "\\", "");

      // — Montar JSON completo —
      string dateStr  = FormatDate(closeTime);
      string rrStr    = (rr != 0) ? DoubleToString(MathAbs(rr), 1) : "null";
      string entryStr = (entryPrice > 0) ? DoubleToString(entryPrice, 3) : "null";
      string exitStr  = (exitPrice  > 0) ? DoubleToString(exitPrice,  3) : "null";
      string slStr    = (sl > 0) ? DoubleToString(sl, 3) : "null";
      string tpStr    = (tp > 0) ? DoubleToString(tp, 3) : "null";

      string tradeJson = "{"
        + "\"id\":\""        + tradeId   + "\","
        + "\"date\":\""      + dateStr   + "\","
        + "\"pnl\":"         + DoubleToString(pnl, 2) + ","
        + "\"trades\":1,"
        + "\"pair\":\""      + pair      + "\","
        + "\"session\":\""   + session   + "\","
        + "\"setup\":\""     + InpDefaultSetup + "\","
        + "\"direction\":\""  + direction + "\","
        + "\"category\":\""  + category  + "\","
        + "\"notes\":\""     + notes     + "\","
        + "\"entry\":"       + entryStr  + ","
        + "\"exit\":"        + exitStr   + ","
        + "\"sl\":"          + slStr     + ","
        + "\"tp\":"          + tpStr     + ","
        + "\"rr\":"          + rrStr     + ","
        + "\"emotion\":\"\",\"screenshot\":null"
        + "}";

      if(InpDebugMode)
         Print("[", count+1, "] ", pair, " | ", direction,
               " | Entry:", entryStr, " Exit:", exitStr,
               " SL:", slStr, " TP:", tpStr,
               " RR:", rrStr, " | R$", DoubleToString(pnl,2));

      bool ok = SendViaRPC(tradeJson);
      if(ok)
        {
         totalSent++;
         if(ticket > gLastTicket) { gLastTicket = ticket; SaveLastTicket(gLastTicket); }
         if(InpDebugMode) Print("  OK");
        }
      else { totalFailed++; Print("  FALHA ticket:", ticket); }

      count++;
      Sleep(InpDelayMs);
     }

   Print("==============================");
   Print("CONCLUIDO! Enviados:", totalSent, " | Falhas:", totalFailed);
   if(totalSent > 0)
      Print("Va em: Trader OS -> Configuracoes -> Baixar da Nuvem");
   Print("==============================");
  }

//+------------------------------------------------------------------+
string FormatSymbol(string sym)
  {
   string s = sym;
   StringToUpper(s);
   // Remover sufixos de broker
   string sufixes[] = {"MICRO","MINI",".PRO",".ECN",".R",".STP","_SB"};
   for(int i=0; i<ArraySize(sufixes); i++)
      StringReplace(s, sufixes[i], "");
   // Remover 'm' final (XAUUSDm)
   if(StringLen(s) > 6 && StringGetCharacter(s, StringLen(s)-1) == 'M')
      s = StringSubstr(s, 0, StringLen(s)-1);
   // Metais
   if(StringFind(s,"XAUUSD") >= 0) return "XAU/USD";
   if(StringFind(s,"XAGUSD") >= 0) return "XAG/USD";
   // Pares de 6 letras
   if(StringLen(s) == 6)
      return StringSubstr(s,0,3) + "/" + StringSubstr(s,3,3);
   return s;
  }

//+------------------------------------------------------------------+
string DetectCategory(string sym)
  {
   string s = sym;
   StringToUpper(s);
   // Cripto
   if(StringFind(s,"BTC")>=0 || StringFind(s,"ETH")>=0 ||
      StringFind(s,"LTC")>=0 || StringFind(s,"XRP")>=0)
      return "Cripto";
   // Índices
   if(StringFind(s,"NAS")>=0  || StringFind(s,"US500")>=0 ||
      StringFind(s,"SPX")>=0  || StringFind(s,"DOW")>=0   ||
      StringFind(s,"DAX")>=0  || StringFind(s,"IBOV")>=0  ||
      StringFind(s,"US30")>=0 || StringFind(s,"US100")>=0)
      return "Índices";
   // Tudo mais (XAU, XAG, pares de moeda) = FX
   return "FX";
  }

//+------------------------------------------------------------------+
string DetectSession(datetime t)
  {
   MqlDateTime dt; TimeToStruct(t, dt);
   if(dt.hour < 8)  return "Tokyo";
   if(dt.hour < 13) return "London";
   return "New York";
  }

//+------------------------------------------------------------------+
string FormatDate(datetime t)
  {
   MqlDateTime dt; TimeToStruct(t, dt);
   return StringFormat("%04d-%02d-%02d", dt.year, dt.mon, dt.day);
  }

//+------------------------------------------------------------------+
bool SendViaRPC(string tradeJson)
  {
   string url  = InpSupabaseURL + "/rest/v1/rpc/append_mt5_trade";
   string body = "{\"p_user_id\":\"" + InpUserId + "\","
               + "\"p_account_id\":\"" + InpAccountId + "\","
               + "\"p_trade\":" + tradeJson + "}";

   string headers = "apikey: " + InpSupabaseKey + "\r\n"
                  + "Authorization: Bearer " + InpSupabaseKey + "\r\n"
                  + "Content-Type: application/json\r\n"
                  + "Prefer: return=minimal\r\n";

   char post[], result[];
   string resHeaders;
   StringToCharArray(body, post, 0, StringLen(body));
   int res = WebRequest("POST", url, headers, 8000, post, result, resHeaders);

   if(res != 200 && res != 204)
     { if(InpDebugMode) Print("HTTP ", res, ": ", CharArrayToString(result)); return false; }
   return true;
  }

//+------------------------------------------------------------------+
string FetchPayload()
  {
   string url = InpSupabaseURL + "/rest/v1/trader_os_data?user_id=eq." + InpUserId + "&select=payload";
   string headers = "apikey: " + InpSupabaseKey + "\r\n"
                  + "Authorization: Bearer " + InpSupabaseKey + "\r\n";
   char post[], result[];
   string resHeaders;
   int res = WebRequest("GET", url, headers, 8000, post, result, resHeaders);
   if(res == 200) return CharArrayToString(result);
   Print("Erro payload HTTP:", res);
   return "";
  }
