export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      account_health: {
        Row: {
          account_id: string
          active_instance_id: string | null
          balance: number | null
          broker_server_time: string | null
          ea_version: string | null
          equity: number | null
          id: string
          last_heartbeat_at: string
          last_init_nonce: string | null
          last_positions_seq: number
          last_positions_snapshot_at: string | null
          margin_free: number | null
          positions_count: number | null
          positions_reported_total: number | null
          reported_login: string | null
          session_epoch: number
          snapshot_checked_at: string | null
          snapshot_reject_reason: string | null
          snapshot_status: string
          terminal_connected: boolean
          trade_allowed: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          active_instance_id?: string | null
          balance?: number | null
          broker_server_time?: string | null
          ea_version?: string | null
          equity?: number | null
          id?: string
          last_heartbeat_at: string
          last_init_nonce?: string | null
          last_positions_seq?: number
          last_positions_snapshot_at?: string | null
          margin_free?: number | null
          positions_count?: number | null
          positions_reported_total?: number | null
          reported_login?: string | null
          session_epoch?: number
          snapshot_checked_at?: string | null
          snapshot_reject_reason?: string | null
          snapshot_status?: string
          terminal_connected?: boolean
          trade_allowed?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          active_instance_id?: string | null
          balance?: number | null
          broker_server_time?: string | null
          ea_version?: string | null
          equity?: number | null
          id?: string
          last_heartbeat_at?: string
          last_init_nonce?: string | null
          last_positions_seq?: number
          last_positions_snapshot_at?: string | null
          margin_free?: number | null
          positions_count?: number | null
          positions_reported_total?: number | null
          reported_login?: string | null
          session_epoch?: number
          snapshot_checked_at?: string | null
          snapshot_reject_reason?: string | null
          snapshot_status?: string
          terminal_connected?: boolean
          trade_allowed?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_health_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "broker_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_analyses: {
        Row: {
          account_id: string
          broker_symbol: string
          canonical_symbol: string
          created_at: string
          decision: string
          gate: Json
          id: string
          model: string | null
          plan: Json
          snapshot: Json
          status: string
          user_id: string
          version: number
        }
        Insert: {
          account_id: string
          broker_symbol: string
          canonical_symbol: string
          created_at?: string
          decision: string
          gate?: Json
          id?: string
          model?: string | null
          plan?: Json
          snapshot?: Json
          status: string
          user_id?: string
          version?: number
        }
        Update: {
          account_id?: string
          broker_symbol?: string
          canonical_symbol?: string
          created_at?: string
          decision?: string
          gate?: Json
          id?: string
          model?: string | null
          plan?: Json
          snapshot?: Json
          status?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_analyses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "broker_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          entity: string
          id: string
          user_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity: string
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      broker_accounts: {
        Row: {
          broker_id: string
          created_at: string
          currency: string
          id: string
          is_demo: boolean
          label: string
          leverage: number | null
          mt5_login: string
          mt5_server: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          broker_id: string
          created_at?: string
          currency?: string
          id?: string
          is_demo?: boolean
          label: string
          leverage?: number | null
          mt5_login: string
          mt5_server?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          broker_id?: string
          created_at?: string
          currency?: string
          id?: string
          is_demo?: boolean
          label?: string
          leverage?: number | null
          mt5_login?: string
          mt5_server?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_accounts_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      broker_positions: {
        Row: {
          account_id: string
          broker_symbol: string
          broker_ticket: string
          canonical_symbol: string
          closed_at: string | null
          comment: string | null
          created_at: string
          current_price: number | null
          direction: string
          id: string
          last_seen_at: string
          open_price: number
          opened_at: string | null
          order_id: string | null
          origin: string
          profit: number | null
          status: string
          stop_loss: number | null
          swap: number | null
          take_profit: number | null
          user_id: string
          volume: number
        }
        Insert: {
          account_id: string
          broker_symbol: string
          broker_ticket: string
          canonical_symbol: string
          closed_at?: string | null
          comment?: string | null
          created_at?: string
          current_price?: number | null
          direction: string
          id?: string
          last_seen_at?: string
          open_price: number
          opened_at?: string | null
          order_id?: string | null
          origin?: string
          profit?: number | null
          status?: string
          stop_loss?: number | null
          swap?: number | null
          take_profit?: number | null
          user_id: string
          volume: number
        }
        Update: {
          account_id?: string
          broker_symbol?: string
          broker_ticket?: string
          canonical_symbol?: string
          closed_at?: string | null
          comment?: string | null
          created_at?: string
          current_price?: number | null
          direction?: string
          id?: string
          last_seen_at?: string
          open_price?: number
          opened_at?: string | null
          order_id?: string | null
          origin?: string
          profit?: number | null
          status?: string
          stop_loss?: number | null
          swap?: number | null
          take_profit?: number | null
          user_id?: string
          volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "broker_positions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "broker_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_positions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "execution_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      brokers: {
        Row: {
          code: string
          created_at: string
          default_currency: string
          id: string
          is_active: boolean
          lot_step: number
          max_lot: number
          min_lot: number
          name: string
          notes: string | null
          platform: string
          requires_ea_bridge: boolean
          supports_hedging: boolean
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          default_currency?: string
          id?: string
          is_active?: boolean
          lot_step?: number
          max_lot?: number
          min_lot?: number
          name: string
          notes?: string | null
          platform?: string
          requires_ea_bridge?: boolean
          supports_hedging?: boolean
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          default_currency?: string
          id?: string
          is_active?: boolean
          lot_step?: number
          max_lot?: number
          min_lot?: number
          name?: string
          notes?: string | null
          platform?: string
          requires_ea_bridge?: boolean
          supports_hedging?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      connector_tokens: {
        Row: {
          account_id: string
          created_at: string
          id: string
          last_used_at: string | null
          revoked_at: string | null
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash?: string
          token_prefix?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_tokens_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "broker_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      control_state: {
        Row: {
          ai_trading_halted: boolean
          halted_at: string | null
          trading_mode: Database["public"]["Enums"]["trading_mode"]
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_trading_halted?: boolean
          halted_at?: string | null
          trading_mode?: Database["public"]["Enums"]["trading_mode"]
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_trading_halted?: boolean
          halted_at?: string | null
          trading_mode?: Database["public"]["Enums"]["trading_mode"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      execution_events: {
        Row: {
          created_at: string
          details: Json
          from_state: string | null
          id: string
          order_id: string
          to_state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          details?: Json
          from_state?: string | null
          id?: string
          order_id: string
          to_state: string
          user_id: string
        }
        Update: {
          created_at?: string
          details?: Json
          from_state?: string | null
          id?: string
          order_id?: string
          to_state?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "execution_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_orders: {
        Row: {
          account_id: string
          acked_at: string | null
          analysis_id: string
          approved_at: string | null
          broker_symbol: string
          broker_ticket: string | null
          canonical_symbol: string
          created_at: string
          digits: number | null
          direction: string
          fill_price: number | null
          fill_volume: number | null
          filled_at: string | null
          gate: Json
          id: string
          idempotency_key: string
          latency_ms: number | null
          max_slippage_points: number
          reason: string | null
          requested_price: number | null
          retcode: number | null
          sent_at: string | null
          slippage_points: number | null
          state: string
          stop_loss: number | null
          take_profit: number | null
          updated_at: string
          user_id: string
          volume: number
        }
        Insert: {
          account_id: string
          acked_at?: string | null
          analysis_id: string
          approved_at?: string | null
          broker_symbol: string
          broker_ticket?: string | null
          canonical_symbol: string
          created_at?: string
          digits?: number | null
          direction: string
          fill_price?: number | null
          fill_volume?: number | null
          filled_at?: string | null
          gate?: Json
          id?: string
          idempotency_key: string
          latency_ms?: number | null
          max_slippage_points?: number
          reason?: string | null
          requested_price?: number | null
          retcode?: number | null
          sent_at?: string | null
          slippage_points?: number | null
          state?: string
          stop_loss?: number | null
          take_profit?: number | null
          updated_at?: string
          user_id: string
          volume: number
        }
        Update: {
          account_id?: string
          acked_at?: string | null
          analysis_id?: string
          approved_at?: string | null
          broker_symbol?: string
          broker_ticket?: string | null
          canonical_symbol?: string
          created_at?: string
          digits?: number | null
          direction?: string
          fill_price?: number | null
          fill_volume?: number | null
          filled_at?: string | null
          gate?: Json
          id?: string
          idempotency_key?: string
          latency_ms?: number | null
          max_slippage_points?: number
          reason?: string | null
          requested_price?: number | null
          retcode?: number | null
          sent_at?: string | null
          slippage_points?: number | null
          state?: string
          stop_loss?: number | null
          take_profit?: number | null
          updated_at?: string
          user_id?: string
          volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "execution_orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "broker_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_orders_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "ai_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      market_candles: {
        Row: {
          account_id: string
          broker_symbol: string
          bucket: string
          canonical_symbol: string
          close: number
          high: number
          id: string
          low: number
          open: number
          ticks: number
          user_id: string
        }
        Insert: {
          account_id: string
          broker_symbol: string
          bucket: string
          canonical_symbol: string
          close: number
          high: number
          id?: string
          low: number
          open: number
          ticks?: number
          user_id: string
        }
        Update: {
          account_id?: string
          broker_symbol?: string
          bucket?: string
          canonical_symbol?: string
          close?: number
          high?: number
          id?: string
          low?: number
          open?: number
          ticks?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_candles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "broker_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      market_quotes: {
        Row: {
          account_id: string
          ask: number
          bid: number
          broker_symbol: string
          canonical_symbol: string
          digits: number | null
          id: string
          received_at: string
          spread_points: number
          tick_time: string
          user_id: string
        }
        Insert: {
          account_id: string
          ask: number
          bid: number
          broker_symbol: string
          canonical_symbol: string
          digits?: number | null
          id?: string
          received_at?: string
          spread_points: number
          tick_time: string
          user_id: string
        }
        Update: {
          account_id?: string
          ask?: number
          bid?: number
          broker_symbol?: string
          canonical_symbol?: string
          digits?: number | null
          id?: string
          received_at?: string
          spread_points?: number
          tick_time?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_quotes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "broker_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          language: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          language?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          language?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      risk_profiles: {
        Row: {
          account_id: string
          allow_auto_trade: boolean
          created_at: string
          id: string
          is_active: boolean
          max_daily_loss: number
          max_drawdown_pct: number
          max_exposure_pct: number
          max_lot: number
          max_open_positions: number
          min_stop_distance_points: number
          name: string
          news_lock_minutes: number
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          allow_auto_trade?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          max_daily_loss?: number
          max_drawdown_pct?: number
          max_exposure_pct?: number
          max_lot?: number
          max_open_positions?: number
          min_stop_distance_points?: number
          name?: string
          news_lock_minutes?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          allow_auto_trade?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          max_daily_loss?: number
          max_drawdown_pct?: number
          max_exposure_pct?: number
          max_lot?: number
          max_open_positions?: number
          min_stop_distance_points?: number
          name?: string
          news_lock_minutes?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_profiles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "broker_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      symbol_aliases: {
        Row: {
          broker_id: string
          broker_symbol: string
          canonical_symbol: string
          created_at: string
          id: string
          note: string | null
          user_id: string
        }
        Insert: {
          broker_id: string
          broker_symbol: string
          canonical_symbol: string
          created_at?: string
          id?: string
          note?: string | null
          user_id: string
        }
        Update: {
          broker_id?: string
          broker_symbol?: string
          canonical_symbol?: string
          created_at?: string
          id?: string
          note?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "symbol_aliases_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cancel_execution: { Args: { p_order_id: string }; Returns: Json }
      connector_ingest: {
        Args: { p_payload: Json; p_token: string }
        Returns: Json
      }
      connector_pull_orders: { Args: { p_token: string }; Returns: Json }
      connector_report_order: {
        Args: { p_payload: Json; p_token: string }
        Returns: Json
      }
      execution_sweep: { Args: { p_account_id: string }; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      issue_connector_token: { Args: { p_account_id: string }; Returns: string }
      log_security_event: {
        Args: { p_action: string; p_details?: Json }
        Returns: undefined
      }
      request_execution: {
        Args: {
          p_analysis_id: string
          p_idempotency_key: string
          p_volume: number
        }
        Returns: Json
      }
      revoke_connector_token: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      simulate_demo_feed: { Args: { p_account_id: string }; Returns: Json }
    }
    Enums: {
      app_role: "owner" | "admin" | "trader" | "viewer"
      trading_mode:
        | "data_only"
        | "analysis"
        | "signal"
        | "auto_trade"
        | "ultimate_auto"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "trader", "viewer"],
      trading_mode: [
        "data_only",
        "analysis",
        "signal",
        "auto_trade",
        "ultimate_auto",
      ],
    },
  },
} as const
