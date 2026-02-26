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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      actions: {
        Row: {
          action_id: string
          ai_suggested: boolean
          cluster_id: string
          cluster_name: string
          created_at: string
          deadline: string | null
          id: string
          owner_initials: string
          owner_name: string
          owner_role: string
          status: string
          suggested_action: string
        }
        Insert: {
          action_id: string
          ai_suggested?: boolean
          cluster_id: string
          cluster_name: string
          created_at?: string
          deadline?: string | null
          id?: string
          owner_initials: string
          owner_name: string
          owner_role: string
          status?: string
          suggested_action: string
        }
        Update: {
          action_id?: string
          ai_suggested?: boolean
          cluster_id?: string
          cluster_name?: string
          created_at?: string
          deadline?: string | null
          id?: string
          owner_initials?: string
          owner_name?: string
          owner_role?: string
          status?: string
          suggested_action?: string
        }
        Relationships: []
      }
      clusters: {
        Row: {
          category: string
          cluster_id: string
          created_at: string
          feedback_count: number
          id: string
          linked_actions_count: number
          name: string
          priority: string
          sentiment: string
          tags: string[]
        }
        Insert: {
          category: string
          cluster_id: string
          created_at?: string
          feedback_count?: number
          id?: string
          linked_actions_count?: number
          name: string
          priority?: string
          sentiment?: string
          tags?: string[]
        }
        Update: {
          category?: string
          cluster_id?: string
          created_at?: string
          feedback_count?: number
          id?: string
          linked_actions_count?: number
          name?: string
          priority?: string
          sentiment?: string
          tags?: string[]
        }
        Relationships: []
      }
      customer_portal: {
        Row: {
          action_taken: string
          created_at: string
          feedback_text: string
          id: string
          status: string
        }
        Insert: {
          action_taken?: string
          created_at?: string
          feedback_text: string
          id?: string
          status?: string
        }
        Update: {
          action_taken?: string
          created_at?: string
          feedback_text?: string
          id?: string
          status?: string
        }
        Relationships: []
      }
      feedback: {
        Row: {
          channel: string | null
          cluster_id: string | null
          created_at: string
          customer_name: string
          feedback_id: string
          id: string
          sentiment: string
          source: string
          status: string
          text: string
          timestamp: string
        }
        Insert: {
          channel?: string | null
          cluster_id?: string | null
          created_at?: string
          customer_name: string
          feedback_id: string
          id?: string
          sentiment?: string
          source: string
          status?: string
          text: string
          timestamp?: string
        }
        Update: {
          channel?: string | null
          cluster_id?: string | null
          created_at?: string
          customer_name?: string
          feedback_id?: string
          id?: string
          sentiment?: string
          source?: string
          status?: string
          text?: string
          timestamp?: string
        }
        Relationships: []
      }
      integrations: {
        Row: {
          config: Json
          connected_at: string | null
          created_at: string
          display_name: string
          id: string
          provider: string
          status: string
          user_id: string
        }
        Insert: {
          config?: Json
          connected_at?: string | null
          created_at?: string
          display_name: string
          id?: string
          provider: string
          status?: string
          user_id: string
        }
        Update: {
          config?: Json
          connected_at?: string | null
          created_at?: string
          display_name?: string
          id?: string
          provider?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          anomaly_alerts: boolean
          created_at: string
          email_digest: boolean
          id: string
          user_id: string
          weekly_summary: boolean
        }
        Insert: {
          anomaly_alerts?: boolean
          created_at?: string
          email_digest?: boolean
          id?: string
          user_id: string
          weekly_summary?: boolean
        }
        Update: {
          anomaly_alerts?: boolean
          created_at?: string
          email_digest?: boolean
          id?: string
          user_id?: string
          weekly_summary?: boolean
        }
        Relationships: []
      }
      onboarding_progress: {
        Row: {
          action_created: boolean
          cluster_reviewed: boolean
          created_at: string
          dismissed: boolean
          id: string
          profile_completed: boolean
          source_connected: boolean
          user_id: string
        }
        Insert: {
          action_created?: boolean
          cluster_reviewed?: boolean
          created_at?: string
          dismissed?: boolean
          id?: string
          profile_completed?: boolean
          source_connected?: boolean
          user_id: string
        }
        Update: {
          action_created?: boolean
          cluster_reviewed?: boolean
          created_at?: string
          dismissed?: boolean
          id?: string
          profile_completed?: boolean
          source_connected?: boolean
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_initials: string
          created_at: string
          full_name: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_initials?: string
          created_at?: string
          full_name?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_initials?: string
          created_at?: string
          full_name?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      roadmap: {
        Row: {
          cluster_id: string
          cluster_name: string
          created_at: string
          id: string
          impact_count: number
          impact_rationale: string | null
          initiative_id: string
          owner_initials: string
          owner_name: string
          predicted_impact: string
          raw_feedback_count: number
          status: string
          title: string
        }
        Insert: {
          cluster_id: string
          cluster_name: string
          created_at?: string
          id?: string
          impact_count?: number
          impact_rationale?: string | null
          initiative_id: string
          owner_initials: string
          owner_name: string
          predicted_impact: string
          raw_feedback_count?: number
          status?: string
          title: string
        }
        Update: {
          cluster_id?: string
          cluster_name?: string
          created_at?: string
          id?: string
          impact_count?: number
          impact_rationale?: string | null
          initiative_id?: string
          owner_initials?: string
          owner_name?: string
          predicted_impact?: string
          raw_feedback_count?: number
          status?: string
          title?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
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
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "pm" | "cs" | "exec"
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
    Enums: {
      app_role: ["pm", "cs", "exec"],
    },
  },
} as const
