/**
 * Hand-authored mirror of supabase/schema.sql, in the shape @supabase/supabase-js
 * expects for its generic `Database` type. If you later run
 * `supabase gen types typescript`, you can drop this in its place.
 */

export interface Database {
  public: {
    Views: Record<string, never>;
    Functions: Record<string, never>;
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
          order_number: string;
          order_date: string;
          status: string;
          total_amount: number;
          recipient_name: string;
          phone_snapshot: string | null;
          address_snapshot: string | null;
          delivery_memo: string | null;
          import_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          order_number: string;
          order_date: string;
          status?: string;
          total_amount?: number;
          recipient_name: string;
          phone_snapshot?: string | null;
          address_snapshot?: string | null;
          delivery_memo?: string | null;
          import_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["orders"]["Insert"]>;
        Relationships: [];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          product_name: string;
          option_name: string | null;
          quantity: number;
          unit_price: number;
          amount: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_name: string;
          option_name?: string | null;
          quantity?: number;
          unit_price?: number;
          amount?: number;
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
    };
  };
}
