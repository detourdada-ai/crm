/**
 * Hand-authored mirror of supabase/schema.sql, in the shape @supabase/supabase-js
 * expects for its generic `Database` type. If you later run
 * `supabase gen types typescript`, you can drop this in its place.
 */

import type { CustomerStatus, OrderSource, DeliveryStatus, DriverStatus, SettlementStatus } from "./domain";

export interface Database {
  public: {
    Views: {
      customer_order_stats: {
        Row: {
          customer_id: string;
          owner_username: string;
          total_orders: number;
          total_amount: number;
          first_order_at: string | null;
          last_order_at: string | null;
        };
        Relationships: [];
      };
      customer_order_gaps: {
        Row: {
          customer_id: string;
          owner_username: string;
          order_date: string;
          prev_order_date: string | null;
          gap_days: number | null;
        };
        Relationships: [];
      };
      customer_reorder_cycle: {
        Row: {
          customer_id: string;
          owner_username: string;
          avg_interval_days: number;
          gap_count: number;
          last_order_at: string;
        };
        Relationships: [];
      };
      customer_list_view: {
        Row: {
          id: string;
          customer_code: string;
          name: string;
          phone: string | null;
          address: string | null;
          address_normalized: string | null;
          memo: string | null;
          tags: string[];
          owner_username: string;
          is_favorite: boolean;
          status: CustomerStatus;
          merged_into_id: string | null;
          bag_no: string | null;
          created_by_import_id: string | null;
          created_at: string;
          updated_at: string;
          total_orders: number;
          total_amount: number;
          last_order_at: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      monthly_revenue: {
        Args: { p_owner_username: string | null; p_months: number };
        Returns: { month: string; revenue: number }[];
      };
      orders_by_weekday: {
        Args: { p_owner_username: string | null };
        Returns: { weekday: number; order_count: number }[];
      };
      top_products: {
        Args: { p_owner_username: string | null; p_limit: number };
        Returns: { product_name: string; total_quantity: number; total_amount: number }[];
      };
      order_amount_summary: {
        Args: { p_owner_username: string | null; p_since: string | null };
        Returns: { total_amount: number; order_count: number }[];
      };
    };
    Enums: Record<string, never>;
    Tables: {
      customers: {
        Row: {
          id: string;
          customer_code: string;
          name: string;
          phone: string | null;
          address: string | null;
          address_normalized: string | null;
          memo: string | null;
          tags: string[];
          owner_username: string;
          is_favorite: boolean;
          status: CustomerStatus;
          merged_into_id: string | null;
          bag_no: string | null;
          created_by_import_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          customer_code?: string;
          name: string;
          phone?: string | null;
          address?: string | null;
          address_normalized?: string | null;
          memo?: string | null;
          tags?: string[];
          owner_username?: string;
          is_favorite?: boolean;
          status?: CustomerStatus;
          merged_into_id?: string | null;
          bag_no?: string | null;
          created_by_import_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["customers"]["Insert"]>;
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          customer_id: string;
          order_number: string | null;
          order_date: string;
          status: string;
          total_amount: number;
          recipient_name: string;
          phone_snapshot: string | null;
          address_snapshot: string | null;
          zipcode: string | null;
          delivery_memo: string | null;
          courier: string | null;
          tracking_number: string | null;
          sales_channel: string | null;
          buyer_name: string | null;
          buyer_id: string | null;
          shipped_at: string | null;
          delivery_date: string | null;
          delivery_area: string | null;
          bag_number: string | null;
          bag_returned: boolean;
          order_source: OrderSource;
          delivery_status: DeliveryStatus;
          driver_id: string | null;
          completed_at: string | null;
          import_id: string | null;
          owner_username: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          order_number?: string | null;
          order_date: string;
          status?: string;
          total_amount?: number;
          recipient_name: string;
          phone_snapshot?: string | null;
          address_snapshot?: string | null;
          zipcode?: string | null;
          delivery_memo?: string | null;
          courier?: string | null;
          tracking_number?: string | null;
          sales_channel?: string | null;
          buyer_name?: string | null;
          buyer_id?: string | null;
          shipped_at?: string | null;
          delivery_date?: string | null;
          delivery_area?: string | null;
          bag_number?: string | null;
          bag_returned?: boolean;
          order_source?: OrderSource;
          delivery_status?: DeliveryStatus;
          driver_id?: string | null;
          completed_at?: string | null;
          import_id?: string | null;
          owner_username?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["orders"]["Insert"]>;
        Relationships: [];
      };
      drivers: {
        Row: {
          id: string;
          name: string;
          phone: string | null;
          address: string | null;
          vehicle_number: string | null;
          status: DriverStatus;
          rate_per_delivery: number;
          owner_username: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          phone?: string | null;
          address?: string | null;
          vehicle_number?: string | null;
          status?: DriverStatus;
          rate_per_delivery?: number;
          owner_username?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["drivers"]["Insert"]>;
        Relationships: [];
      };
      settlements: {
        Row: {
          id: string;
          driver_id: string;
          period_start: string;
          period_end: string;
          delivery_count: number;
          amount: number;
          status: SettlementStatus;
          paid_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          driver_id: string;
          period_start: string;
          period_end: string;
          delivery_count?: number;
          amount?: number;
          status?: SettlementStatus;
          paid_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["settlements"]["Insert"]>;
        Relationships: [];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          product_order_number: string | null;
          product_code: string | null;
          product_name: string;
          option_name: string | null;
          quantity: number;
          unit_price: number;
          amount: number;
          extra: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_order_number?: string | null;
          product_code?: string | null;
          product_name: string;
          option_name?: string | null;
          quantity?: number;
          unit_price?: number;
          amount?: number;
          extra?: Record<string, unknown>;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["order_items"]["Insert"]>;
        Relationships: [];
      };
      imports: {
        Row: {
          id: string;
          file_name: string;
          status: string;
          total_rows: number;
          success_rows: number;
          failed_rows: number;
          new_customers: number;
          existing_customers: number;
          duplicate_candidates: number;
          column_mapping: Record<string, string> | null;
          error_log: unknown | null;
          owner_username: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          file_name: string;
          status?: string;
          total_rows?: number;
          success_rows?: number;
          failed_rows?: number;
          new_customers?: number;
          existing_customers?: number;
          duplicate_candidates?: number;
          column_mapping?: Record<string, string> | null;
          error_log?: unknown | null;
          owner_username?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["imports"]["Insert"]>;
        Relationships: [];
      };
      duplicate_candidates: {
        Row: {
          id: string;
          existing_customer_id: string;
          new_customer_id: string;
          import_id: string | null;
          match_type: string;
          confidence: string;
          reason: string;
          status: string;
          owner_username: string;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          existing_customer_id: string;
          new_customer_id: string;
          import_id?: string | null;
          match_type: string;
          confidence: string;
          reason: string;
          status?: string;
          owner_username?: string;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["duplicate_candidates"]["Insert"]>;
        Relationships: [];
      };
      merge_history: {
        Row: {
          id: string;
          duplicate_candidate_id: string | null;
          kept_customer_id: string;
          removed_customer_id: string;
          orders_moved: number;
          performed_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          duplicate_candidate_id?: string | null;
          kept_customer_id: string;
          removed_customer_id: string;
          orders_moved?: number;
          performed_by?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["merge_history"]["Insert"]>;
        Relationships: [];
      };
      customer_change_logs: {
        Row: {
          id: string;
          customer_id: string;
          entity: string;
          field: string | null;
          old_value: string | null;
          new_value: string | null;
          performed_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          entity: string;
          field?: string | null;
          old_value?: string | null;
          new_value?: string | null;
          performed_by?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["customer_change_logs"]["Insert"]>;
        Relationships: [];
      };
      app_accounts: {
        Row: {
          username: string;
          password_hash: string;
          role: string;
          driver_id: string | null;
          updated_at: string;
        };
        Insert: {
          username: string;
          password_hash: string;
          role: string;
          driver_id?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["app_accounts"]["Insert"]>;
        Relationships: [];
      };
      app_settings: {
        Row: {
          key: string;
          value: Record<string, unknown>;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: Record<string, unknown>;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["app_settings"]["Insert"]>;
        Relationships: [];
      };
    };
  };
}
