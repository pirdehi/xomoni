export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
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
          token_hash: string;
        };
        Insert: {
          device_id: string;
          token_hash: string;
        };
        Update: {
          device_id?: string;
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_pairing_code: {
        Args: never;
        Returns: {
          code: string;
          expires_at: string;
        }[];
      };
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
        Returns: undefined;
      };
      normalize_pairing_code: { Args: { code: string }; Returns: string };
      pair_device: {
        Args: { code: string; name: string; version: string };
        Returns: {
          device_id: string;
          token: string;
        }[];
      };
      unpair_device: { Args: { token: string }; Returns: undefined };
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
