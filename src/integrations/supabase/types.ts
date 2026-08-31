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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      loopline_execution_legs: {
        Row: {
          average_price: number | null
          created_at: string
          error_message: string | null
          filled_quantity: number | null
          from_coin: string
          id: string
          order_id: string | null
          requested_quantity: number | null
          run_id: string
          sequence: number
          side: string
          status: string
          symbol: string
          to_coin: string
          updated_at: string
          user_id: string
        }
        Insert: {
          average_price?: number | null
          created_at?: string
          error_message?: string | null
          filled_quantity?: number | null
          from_coin: string
          id?: string
          order_id?: string | null
          requested_quantity?: number | null
          run_id: string
          sequence: number
          side: string
          status?: string
          symbol: string
          to_coin: string
          updated_at?: string
          user_id: string
        }
        Update: {
          average_price?: number | null
          created_at?: string
          error_message?: string | null
          filled_quantity?: number | null
          from_coin?: string
          id?: string
          order_id?: string | null
          requested_quantity?: number | null
          run_id?: string
          sequence?: number
          side?: string
          status?: string
          symbol?: string
          to_coin?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loopline_execution_legs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "loopline_execution_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      loopline_execution_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          failure_reason: string | null
          id: string
          idempotency_key: string
          mode: string
          requested_amount: number
          route: Json
          start_coin: string
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          mode: string
          requested_amount: number
          route?: Json
          start_coin: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          mode?: string
          requested_amount?: number
          route?: Json
          start_coin?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      loopline_scanner_cron_secret: {
        Row: {
          created_at: string
          id: number
          token: string
        }
        Insert: {
          created_at?: string
          id?: number
          token?: string
        }
        Update: {
          created_at?: string
          id?: number
          token?: string
        }
        Relationships: []
      }
      loopline_scanner_state: {
        Row: {
          created_at: string
          error_message: string | null
          failure_count: number
          id: number
          instruments: Json
          last_completed_at: string | null
          last_started_at: string | null
          lease_id: string | null
          lease_until: string | null
          market_fetched_at: string | null
          opportunities: Json
          pause_reason: string | null
          paused: boolean
          settings: Json
          status: string
          tickers: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          failure_count?: number
          id?: number
          instruments?: Json
          last_completed_at?: string | null
          last_started_at?: string | null
          lease_id?: string | null
          lease_until?: string | null
          market_fetched_at?: string | null
          opportunities?: Json
          pause_reason?: string | null
          paused?: boolean
          settings?: Json
          status?: string
          tickers?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          failure_count?: number
          id?: number
          instruments?: Json
          last_completed_at?: string | null
          last_started_at?: string | null
          lease_id?: string | null
          lease_until?: string | null
          market_fetched_at?: string | null
          opportunities?: Json
          pause_reason?: string | null
          paused?: boolean
          settings?: Json
          status?: string
          tickers?: Json
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
