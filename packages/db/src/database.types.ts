export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      daily_stats: {
        Row: {
          day: string;
          followers: number | null;
          following: number | null;
          likes_total: number | null;
          observed_posts: number;
          posted_posts: number;
          posted_quotes: number;
          posted_replies: number;
          posted_reposts: number;
          posts_total: number | null;
          posts_with_likes: number;
          received_likes: number;
          received_quotes: number;
          received_replies: number;
          received_reposts: number;
          received_views: number;
          removed_likes: number;
          removed_posts: number;
          removed_replies: number;
          removed_reposts: number;
          replies_with_likes: number;
          updated_at: string;
          user_id: string;
          x_handle: string;
        };
        Insert: {
          day: string;
          followers?: number | null;
          following?: number | null;
          likes_total?: number | null;
          observed_posts?: number;
          posted_posts?: number;
          posted_quotes?: number;
          posted_replies?: number;
          posted_reposts?: number;
          posts_total?: number | null;
          posts_with_likes?: number;
          received_likes?: number;
          received_quotes?: number;
          received_replies?: number;
          received_reposts?: number;
          received_views?: number;
          removed_likes?: number;
          removed_posts?: number;
          removed_replies?: number;
          removed_reposts?: number;
          replies_with_likes?: number;
          updated_at?: string;
          user_id: string;
          x_handle: string;
        };
        Update: {
          day?: string;
          followers?: number | null;
          following?: number | null;
          likes_total?: number | null;
          observed_posts?: number;
          posted_posts?: number;
          posted_quotes?: number;
          posted_replies?: number;
          posted_reposts?: number;
          posts_total?: number | null;
          posts_with_likes?: number;
          received_likes?: number;
          received_quotes?: number;
          received_replies?: number;
          received_reposts?: number;
          received_views?: number;
          removed_likes?: number;
          removed_posts?: number;
          removed_replies?: number;
          removed_reposts?: number;
          replies_with_likes?: number;
          updated_at?: string;
          user_id?: string;
          x_handle?: string;
        };
        Relationships: [];
      };
      daily_stats_choices: {
        Row: {
          changed_at: string;
          enabled: boolean;
          user_id: string;
        };
        Insert: {
          changed_at?: string;
          enabled?: boolean;
          user_id: string;
        };
        Update: {
          changed_at?: string;
          enabled?: boolean;
          user_id?: string;
        };
        Relationships: [];
      };
      device_pairings: {
        Row: {
          code_hash: string;
          expires_at: string;
          user_id: string;
        };
        Insert: {
          code_hash: string;
          expires_at: string;
          user_id: string;
        };
        Update: {
          code_hash?: string;
          expires_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      device_tokens: {
        Row: {
          device_id: string;
          last_used_at: string;
          token_hash: string;
        };
        Insert: {
          device_id: string;
          last_used_at?: string;
          token_hash: string;
        };
        Update: {
          device_id?: string;
          last_used_at?: string;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'device_tokens_device_id_fkey';
            columns: ['device_id'];
            isOneToOne: true;
            referencedRelation: 'devices';
            referencedColumns: ['id'];
          },
        ];
      };
      devices: {
        Row: {
          created_at: string;
          extension_version: string;
          id: string;
          last_seen_at: string;
          name: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          extension_version: string;
          id?: string;
          last_seen_at?: string;
          name: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          extension_version?: string;
          id?: string;
          last_seen_at?: string;
          name?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      extension_releases: {
        Row: {
          published_at: string;
          security: boolean;
          version: string;
        };
        Insert: {
          published_at?: string;
          security?: boolean;
          version: string;
        };
        Update: {
          published_at?: string;
          security?: boolean;
          version?: string;
        };
        Relationships: [];
      };
      health_alert_levels: {
        Row: {
          alerted_at: string | null;
          alerted_level: number | null;
          level: number;
          user_id: string;
          x_handle: string;
        };
        Insert: {
          alerted_at?: string | null;
          alerted_level?: number | null;
          level: number;
          user_id: string;
          x_handle: string;
        };
        Update: {
          alerted_at?: string | null;
          alerted_level?: number | null;
          level?: number;
          user_id?: string;
          x_handle?: string;
        };
        Relationships: [];
      };
      health_alert_queue: {
        Row: {
          dropped_at: string | null;
          id: number;
          level: number;
          risen_at: string;
          sent_at: string | null;
          user_id: string;
          x_handle: string;
        };
        Insert: {
          dropped_at?: string | null;
          id?: never;
          level: number;
          risen_at: string;
          sent_at?: string | null;
          user_id: string;
          x_handle: string;
        };
        Update: {
          dropped_at?: string | null;
          id?: never;
          level?: number;
          risen_at?: string;
          sent_at?: string | null;
          user_id?: string;
          x_handle?: string;
        };
        Relationships: [];
      };
      health_alerts: {
        Row: {
          changed_at: string;
          enabled: boolean;
          last_sent_at: string | null;
          stop_token: string;
          user_id: string;
        };
        Insert: {
          changed_at?: string;
          enabled?: boolean;
          last_sent_at?: string | null;
          stop_token?: string;
          user_id: string;
        };
        Update: {
          changed_at?: string;
          enabled?: boolean;
          last_sent_at?: string | null;
          stop_token?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      jobs: {
        Row: {
          created_at: string;
          device_id: string;
          done: number;
          failed: number;
          finished_at: string | null;
          id: string;
          kind: string;
          local_id: string;
          matched: number;
          phase: string;
          risk_level: number | null;
          scanned: number;
          skipped: number;
          started_at: string | null;
          state: string;
          state_reason: string;
          title: string;
          updated_at: string;
          user_id: string;
          x_handle: string;
        };
        Insert: {
          created_at?: string;
          device_id: string;
          done?: number;
          failed?: number;
          finished_at?: string | null;
          id?: string;
          kind: string;
          local_id: string;
          matched?: number;
          phase?: string;
          risk_level?: number | null;
          scanned?: number;
          skipped?: number;
          started_at?: string | null;
          state: string;
          state_reason?: string;
          title: string;
          updated_at?: string;
          user_id?: string;
          x_handle: string;
        };
        Update: {
          created_at?: string;
          device_id?: string;
          done?: number;
          failed?: number;
          finished_at?: string | null;
          id?: string;
          kind?: string;
          local_id?: string;
          matched?: number;
          phase?: string;
          risk_level?: number | null;
          scanned?: number;
          skipped?: number;
          started_at?: string | null;
          state?: string;
          state_reason?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
          x_handle?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'jobs_device_id_fkey';
            columns: ['device_id'];
            isOneToOne: false;
            referencedRelation: 'devices';
            referencedColumns: ['id'];
          },
        ];
      };
      weekly_emails: {
        Row: {
          changed_at: string;
          enabled: boolean;
          last_sent_at: string | null;
          stop_token: string;
          user_id: string;
        };
        Insert: {
          changed_at?: string;
          enabled?: boolean;
          last_sent_at?: string | null;
          stop_token?: string;
          user_id: string;
        };
        Update: {
          changed_at?: string;
          enabled?: boolean;
          last_sent_at?: string | null;
          stop_token?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      choose_daily_stats: {
        Args: { enabled: boolean; owner: string };
        Returns: boolean;
      };
      create_pairing_code: {
        Args: never;
        Returns: {
          code: string;
          expires_at: string;
        }[];
      };
      daily_stats_columns: { Args: never; Returns: string[] };
      delete_account: { Args: never; Returns: undefined };
      device_for_token: {
        Args: { token: string };
        Returns: {
          created_at: string;
          extension_version: string;
          id: string;
          last_seen_at: string;
          name: string;
          user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'devices';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      device_report: {
        Args: { jobs?: Json; token: string; version: string };
        Returns: Json;
      };
      device_report_stats: {
        Args: { rows: Json; token: string };
        Returns: number;
      };
      device_set_daily_stats: {
        Args: { enabled: boolean; token: string };
        Returns: boolean;
      };
      health_alert_content: { Args: { owner: string }; Returns: Json };
      health_alert_line: {
        Args: { handle: string; level: number; risen_at: string };
        Returns: string;
      };
      health_alert_status: {
        Args: never;
        Returns: {
          can_send: boolean;
          enabled: boolean;
        }[];
      };
      health_alert_time: { Args: { at_time: string }; Returns: string };
      mask_email: { Args: { email: string }; Returns: string };
      mfa_satisfied: { Args: never; Returns: boolean };
      normalize_pairing_code: { Args: { code: string }; Returns: string };
      pair_device: {
        Args: { code: string; name: string; version: string };
        Returns: {
          account: string;
          device_id: string;
          token: string;
        }[];
      };
      release_rank: { Args: { version: string }; Returns: number[] };
      require_second_factor: { Args: never; Returns: undefined };
      send_health_alerts: { Args: { at_time?: string }; Returns: number };
      send_weekly_emails: { Args: { at_time?: string }; Returns: number };
      set_daily_stats: { Args: { enabled: boolean }; Returns: boolean };
      set_health_alert: { Args: { enabled: boolean }; Returns: boolean };
      set_weekly_email: { Args: { enabled: boolean }; Returns: boolean };
      stop_health_alert: { Args: { token: string }; Returns: boolean };
      stop_weekly_email: { Args: { token: string }; Returns: boolean };
      unpair_device: { Args: { token: string }; Returns: undefined };
      weekly_change: {
        Args: { previous: number; value: number };
        Returns: string;
      };
      weekly_count: { Args: { n: number }; Returns: string };
      weekly_email_content: {
        Args: { last_day: string; owner: string };
        Returns: Json;
      };
      weekly_numbers: {
        Args: { first_day: string; last_day: string; owner: string };
        Returns: {
          days: number;
          followers: number;
          likes_received: number;
          posts: number;
          removed: number;
          replies: number;
          replies_received: number;
          views: number;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema['Tables'] & DefaultSchema['Views']) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
