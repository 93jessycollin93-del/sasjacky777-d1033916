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
      api_key_rate_events: {
        Row: {
          api_key_id: string
          created_at: string
          endpoint: string
          id: number
          user_id: string
        }
        Insert: {
          api_key_id: string
          created_at?: string
          endpoint?: string
          id?: never
          user_id: string
        }
        Update: {
          api_key_id?: string
          created_at?: string
          endpoint?: string
          id?: never
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_key_rate_events_key_owner_fkey"
            columns: ["api_key_id", "user_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          key_hash: string
          last_used_at: string | null
          name: string
          prefix: string
          rate_limit: number
          rotated_at: string | null
          rotated_from: string | null
          scopes: Json
          superseded_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash: string
          last_used_at?: string | null
          name: string
          prefix: string
          rate_limit?: number
          rotated_at?: string | null
          rotated_from?: string | null
          scopes?: Json
          superseded_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash?: string
          last_used_at?: string | null
          name?: string
          prefix?: string
          rate_limit?: number
          rotated_at?: string | null
          rotated_from?: string | null
          scopes?: Json
          superseded_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_rotated_from_fkey"
            columns: ["rotated_from"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      api_usage_logs: {
        Row: {
          api_key_id: string
          created_at: string
          endpoint: string
          id: string
          response_time_ms: number
          status_code: number
          user_id: string
        }
        Insert: {
          api_key_id: string
          created_at?: string
          endpoint: string
          id?: string
          response_time_ms?: number
          status_code: number
          user_id: string
        }
        Update: {
          api_key_id?: string
          created_at?: string
          endpoint?: string
          id?: string
          response_time_ms?: number
          status_code?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_logs_key_owner_fkey"
            columns: ["api_key_id", "user_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      bot_api_keys: {
        Row: {
          api_key_id: string
          bot_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          api_key_id: string
          bot_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          api_key_id?: string
          bot_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_api_keys_bot_owner_fkey"
            columns: ["bot_id", "user_id"]
            isOneToOne: false
            referencedRelation: "user_bots"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "bot_api_keys_key_owner_fkey"
            columns: ["api_key_id", "user_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      chat_attachments: {
        Row: {
          conversation_id: string
          created_at: string
          file_name: string
          file_size: number
          file_type: string
          id: string
          message_id: string | null
          storage_path: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          file_name: string
          file_size: number
          file_type: string
          id?: string
          message_id?: string | null
          storage_path: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          file_name?: string
          file_size?: number
          file_type?: string
          id?: string
          message_id?: string | null
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_attachments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          memory_tier: number | null
          role: string
          security_flag: string | null
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          memory_tier?: number | null
          role: string
          security_flag?: string | null
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          memory_tier?: number | null
          role?: string
          security_flag?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_tag_links: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          tag_id: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          tag_id: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          tag_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_tag_links_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_tag_links_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "conversation_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          model: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          model?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          model?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      eye_pod_registry: {
        Row: {
          bytes_compressed: number
          bytes_raw: number
          capability: string
          color: string
          content_hash: string | null
          created_at: string
          glyph: string
          id: string
          name: string
          pod_key: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          bytes_compressed?: number
          bytes_raw?: number
          capability: string
          color?: string
          content_hash?: string | null
          created_at?: string
          glyph?: string
          id?: string
          name: string
          pod_key: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          bytes_compressed?: number
          bytes_raw?: number
          capability?: string
          color?: string
          content_hash?: string | null
          created_at?: string
          glyph?: string
          id?: string
          name?: string
          pod_key?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      game_design_entries: {
        Row: {
          category: Database["public"]["Enums"]["design_entry_category"]
          content: string
          created_at: string
          id: string
          parent_id: string | null
          project_id: string
          sort_order: number
          status: Database["public"]["Enums"]["design_entry_status"]
          tags: string[] | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["design_entry_category"]
          content?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          project_id: string
          sort_order?: number
          status?: Database["public"]["Enums"]["design_entry_status"]
          tags?: string[] | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: Database["public"]["Enums"]["design_entry_category"]
          content?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          project_id?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["design_entry_status"]
          tags?: string[] | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_design_entries_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "game_design_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_design_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "game_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      game_projects: {
        Row: {
          created_at: string
          description: string | null
          genre: string | null
          id: string
          name: string
          status: string
          updated_at: string
          user_id: string
          vision_statement: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          genre?: string | null
          id?: string
          name: string
          status?: string
          updated_at?: string
          user_id: string
          vision_statement?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          genre?: string | null
          id?: string
          name?: string
          status?: string
          updated_at?: string
          user_id?: string
          vision_statement?: string | null
        }
        Relationships: []
      }
      game_purchase_locks: {
        Row: {
          created_at: string
          id: string
          source: string
          transaction_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          source: string
          transaction_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          source?: string
          transaction_id?: string
          user_id?: string
        }
        Relationships: []
      }
      game_saves: {
        Row: {
          created_at: string
          game_state: Json
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          game_state?: Json
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          game_state?: Json
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      game_transactions: {
        Row: {
          amount: number
          balance_after: number
          balance_before: number
          created_at: string
          currency_type: string
          id: string
          metadata: Json | null
          source: string
          source_id: string | null
          transaction_type: string
          user_id: string
        }
        Insert: {
          amount: number
          balance_after?: number
          balance_before?: number
          created_at?: string
          currency_type: string
          id?: string
          metadata?: Json | null
          source: string
          source_id?: string | null
          transaction_type: string
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          balance_before?: number
          created_at?: string
          currency_type?: string
          id?: string
          metadata?: Json | null
          source?: string
          source_id?: string | null
          transaction_type?: string
          user_id?: string
        }
        Relationships: []
      }
      gunit_agents: {
        Row: {
          created_at: string
          id: string
          last_run_at: string | null
          name: string
          next_run_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_run_at?: string | null
          name: string
          next_run_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_run_at?: string | null
          name?: string
          next_run_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      gunit_bots: {
        Row: {
          code: string
          created_at: string
          description: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          code?: string
          created_at?: string
          description?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      gunit_improvements: {
        Row: {
          analysis: string
          created_at: string
          execution: string
          goal: string
          id: string
          improvement: string
          score: number
          user_id: string
        }
        Insert: {
          analysis?: string
          created_at?: string
          execution?: string
          goal: string
          id?: string
          improvement?: string
          score?: number
          user_id: string
        }
        Update: {
          analysis?: string
          created_at?: string
          execution?: string
          goal?: string
          id?: string
          improvement?: string
          score?: number
          user_id?: string
        }
        Relationships: []
      }
      gunit_memory: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      jackie_control_audit: {
        Row: {
          action_id: string | null
          actor: string
          args: Json | null
          command: string
          id: string
          message: string
          result: string
          ts: string
          user_id: string
        }
        Insert: {
          action_id?: string | null
          actor?: string
          args?: Json | null
          command: string
          id?: string
          message?: string
          result: string
          ts?: string
          user_id: string
        }
        Update: {
          action_id?: string | null
          actor?: string
          args?: Json | null
          command?: string
          id?: string
          message?: string
          result?: string
          ts?: string
          user_id?: string
        }
        Relationships: []
      }
      jackie_control_prefs: {
        Row: {
          model_override: string | null
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          model_override?: string | null
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          model_override?: string | null
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      jackie_control_swarms: {
        Row: {
          goal: string
          id: string
          models: Json
          results: Json
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          goal: string
          id?: string
          models?: Json
          results?: Json
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          goal?: string
          id?: string
          models?: Json
          results?: Json
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      jackie_core_access: {
        Row: {
          created_at: string
          email: string
          id: string
          note: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          note?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          note?: string | null
        }
        Relationships: []
      }
      jackie_core_docs: {
        Row: {
          body: string
          id: string
          slug: string
          sort_order: number
          source_file: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          id?: string
          slug: string
          sort_order?: number
          source_file?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          id?: string
          slug?: string
          sort_order?: number
          source_file?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      jackie_memory: {
        Row: {
          category: string
          confidence: number
          created_at: string
          id: string
          key: string
          source_conversation_id: string | null
          updated_at: string
          user_id: string
          value: string
        }
        Insert: {
          category?: string
          confidence?: number
          created_at?: string
          id?: string
          key: string
          source_conversation_id?: string | null
          updated_at?: string
          user_id: string
          value: string
        }
        Update: {
          category?: string
          confidence?: number
          created_at?: string
          id?: string
          key?: string
          source_conversation_id?: string | null
          updated_at?: string
          user_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "jackie_memory_source_conversation_id_fkey"
            columns: ["source_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      jackie_tasks: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          priority: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mesh_jobs: {
        Row: {
          capability_required: string
          claimed_at: string | null
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          prompt: string
          result: string | null
          router_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          capability_required: string
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          prompt: string
          result?: string | null
          router_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          capability_required?: string
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          prompt?: string
          result?: string | null
          router_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mesh_jobs_router_id_fkey"
            columns: ["router_id"]
            isOneToOne: false
            referencedRelation: "mesh_routers"
            referencedColumns: ["id"]
          },
        ]
      }
      mesh_routers: {
        Row: {
          capabilities: string[]
          created_at: string
          id: string
          last_seen_at: string | null
          name: string
          pod_id: string | null
          secret_hash: string
          status: string
          user_id: string
        }
        Insert: {
          capabilities?: string[]
          created_at?: string
          id?: string
          last_seen_at?: string | null
          name: string
          pod_id?: string | null
          secret_hash: string
          status?: string
          user_id: string
        }
        Update: {
          capabilities?: string[]
          created_at?: string
          id?: string
          last_seen_at?: string | null
          name?: string
          pod_id?: string | null
          secret_hash?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mesh_routers_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "eye_pod_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      pod_folds: {
        Row: {
          capability: string
          color: string | null
          created_at: string
          embedding: string
          glyph: string | null
          id: string
          pod_id: string | null
          router_id: string | null
          source_hash: string
          source_ref: string | null
          user_id: string
        }
        Insert: {
          capability: string
          color?: string | null
          created_at?: string
          embedding: string
          glyph?: string | null
          id?: string
          pod_id?: string | null
          router_id?: string | null
          source_hash: string
          source_ref?: string | null
          user_id: string
        }
        Update: {
          capability?: string
          color?: string | null
          created_at?: string
          embedding?: string
          glyph?: string | null
          id?: string
          pod_id?: string | null
          router_id?: string | null
          source_hash?: string
          source_ref?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pod_folds_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "eye_pod_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pod_folds_router_id_fkey"
            columns: ["router_id"]
            isOneToOne: false
            referencedRelation: "mesh_routers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_quota_policy: {
        Row: {
          enabled: boolean
          note: string | null
          per_day: number
          per_minute: number
          updated_at: string
          user_id: string
        }
        Insert: {
          enabled?: boolean
          note?: string | null
          per_day?: number
          per_minute?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          enabled?: boolean
          note?: string | null
          per_day?: number
          per_minute?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      provider_usage_events: {
        Row: {
          created_at: string
          function_name: string
          id: number
          model: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          function_name: string
          id?: never
          model?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          function_name?: string
          id?: never
          model?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_bots: {
        Row: {
          behavior_style: string
          created_at: string
          generated_code: string | null
          id: string
          language: string
          logic_modules: Json
          name: string
          platform: string
          purpose: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          behavior_style?: string
          created_at?: string
          generated_code?: string | null
          id?: string
          language?: string
          logic_modules?: Json
          name: string
          platform?: string
          purpose?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          behavior_style?: string
          created_at?: string
          generated_code?: string | null
          id?: string
          language?: string
          logic_modules?: Json
          name?: string
          platform?: string
          purpose?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      xai_generation_requests: {
        Row: {
          created_at: string
          id: string
          model: string
          provider_request_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          model: string
          provider_request_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          model?: string
          provider_request_id?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_api_key: {
        Args: { p_endpoint?: string; p_key_hash: string }
        Returns: Json
      }
      consume_provider_quota: {
        Args: { p_function: string; p_model?: string; p_user_id: string }
        Returns: Json
      }
      match_pod_folds: {
        Args: {
          match_count?: number
          match_user: string
          query_embedding: string
        }
        Returns: {
          capability: string
          color: string
          created_at: string
          glyph: string
          id: string
          pod_id: string
          router_id: string
          similarity: number
          source_hash: string
          source_ref: string
        }[]
      }
      rotate_api_key_atomic: {
        Args: {
          p_expires_at: string
          p_immediate: boolean
          p_key_hash: string
          p_key_id: string
          p_prefix: string
          p_rotated_at: string
          p_user_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "operator" | "auditor"
      design_entry_category:
        | "lore"
        | "mechanic"
        | "unit"
        | "building"
        | "resource"
        | "tech_tree"
        | "faction"
        | "event"
        | "economy_rule"
        | "battle_system"
        | "alliance"
        | "monetization"
        | "quest"
        | "map"
        | "general"
      design_entry_status: "draft" | "approved" | "implemented"
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
      app_role: ["owner", "admin", "operator", "auditor"],
      design_entry_category: [
        "lore",
        "mechanic",
        "unit",
        "building",
        "resource",
        "tech_tree",
        "faction",
        "event",
        "economy_rule",
        "battle_system",
        "alliance",
        "monetization",
        "quest",
        "map",
        "general",
      ],
      design_entry_status: ["draft", "approved", "implemented"],
    },
  },
} as const
