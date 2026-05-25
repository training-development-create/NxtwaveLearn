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
      agreement_signatures: {
        Row: {
          agreement_pdf_path: string | null
          course_id: string
          id: string
          signed_at: string
          signed_full_name: string | null
          signed_text: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          agreement_pdf_path?: string | null
          course_id: string
          id?: string
          signed_at?: string
          signed_full_name?: string | null
          signed_text?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          agreement_pdf_path?: string | null
          course_id?: string
          id?: string
          signed_at?: string
          signed_full_name?: string | null
          signed_text?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agreement_signatures_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          agreement_pdf_path: string | null
          agreement_required: boolean
          blurb: string
          created_at: string
          created_by: string | null
          due_in: string | null
          due_in_days: number | null
          duration_label: string
          emoji: string
          hue: string
          id: string
          instructor: string
          published_at: string | null
          tag: string
          title: string
          updated_at: string
        }
        Insert: {
          agreement_pdf_path?: string | null
          agreement_required?: boolean
          blurb?: string
          created_at?: string
          created_by?: string | null
          due_in?: string | null
          due_in_days?: number | null
          duration_label?: string
          emoji?: string
          hue?: string
          id?: string
          instructor?: string
          published_at?: string | null
          tag?: string
          title: string
          updated_at?: string
        }
        Update: {
          agreement_pdf_path?: string | null
          agreement_required?: boolean
          blurb?: string
          created_at?: string
          created_by?: string | null
          due_in?: string | null
          due_in_days?: number | null
          duration_label?: string
          emoji?: string
          hue?: string
          id?: string
          instructor?: string
          published_at?: string | null
          tag?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      course_assignments: {
        Row: {
          course_id: string
          created_at: string
          department_id: string | null
          employee_id: string | null
          id: string
          manager_id: string | null
          scope_all: boolean
          sub_department_id: string | null
        }
        Insert: {
          course_id: string
          created_at?: string
          department_id?: string | null
          employee_id?: string | null
          id?: string
          manager_id?: string | null
          scope_all?: boolean
          sub_department_id?: string | null
        }
        Update: {
          course_id?: string
          created_at?: string
          department_id?: string | null
          employee_id?: string | null
          id?: string
          manager_id?: string | null
          scope_all?: boolean
          sub_department_id?: string | null
        }
        Relationships: []
      }
      departments: {
        Row: {
          created_at: string
          darwin_id: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          darwin_id?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          darwin_id?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      employees: {
        Row: {
          auth_user_id: string | null
          contact: string | null
          created_at: string
          darwin_id: string | null
          department_id: string | null
          designation_name: string | null
          email: string
          employee_id: string | null
          id: string
          is_admin: boolean
          last_login_at: string | null
          last_synced_at: string | null
          manager_id: string | null
          name: string
          status: "active" | "inactive" | "unassigned"
          sub_department_id: string | null
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          contact?: string | null
          created_at?: string
          darwin_id?: string | null
          department_id?: string | null
          designation_name?: string | null
          email: string
          employee_id?: string | null
          id?: string
          is_admin?: boolean
          last_login_at?: string | null
          last_synced_at?: string | null
          manager_id?: string | null
          name?: string
          status?: "active" | "inactive" | "unassigned"
          sub_department_id?: string | null
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          contact?: string | null
          created_at?: string
          darwin_id?: string | null
          department_id?: string | null
          designation_name?: string | null
          email?: string
          employee_id?: string | null
          id?: string
          is_admin?: boolean
          last_login_at?: string | null
          last_synced_at?: string | null
          manager_id?: string | null
          name?: string
          status?: "active" | "inactive" | "unassigned"
          sub_department_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_departments: {
        Row: {
          created_at: string
          darwin_id: string | null
          department_id: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          darwin_id?: string | null
          department_id: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          darwin_id?: string | null
          department_id?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sub_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          course_id: string
          enrolled_at: string
          id: string
          user_id: string
        }
        Insert: {
          course_id: string
          enrolled_at?: string
          id?: string
          user_id: string
        }
        Update: {
          course_id?: string
          enrolled_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_progress: {
        Row: {
          completed: boolean
          id: string
          lesson_id: string
          updated_at: string
          user_id: string
          watched_seconds: number
        }
        Insert: {
          completed?: boolean
          id?: string
          lesson_id: string
          updated_at?: string
          user_id: string
          watched_seconds?: number
        }
        Update: {
          completed?: boolean
          id?: string
          lesson_id?: string
          updated_at?: string
          user_id?: string
          watched_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "lesson_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          course_id: string
          created_at: string
          duration_seconds: number
          id: string
          position: number
          title: string
          video_path: string | null
          video_url: string | null
        }
        Insert: {
          course_id: string
          created_at?: string
          duration_seconds?: number
          id?: string
          position?: number
          title: string
          video_path?: string | null
          video_url?: string | null
        }
        Update: {
          course_id?: string
          created_at?: string
          duration_seconds?: number
          id?: string
          position?: number
          title?: string
          video_path?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lessons_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      mcq_questions: {
        Row: {
          correct_index: number
          created_at: string
          hint: string | null
          id: string
          lesson_id: string
          options: Json
          position: number
          question: string
        }
        Insert: {
          correct_index: number
          created_at?: string
          hint?: string | null
          id?: string
          lesson_id: string
          options: Json
          position?: number
          question: string
        }
        Update: {
          correct_index?: number
          created_at?: string
          hint?: string | null
          id?: string
          lesson_id?: string
          options?: Json
          position?: number
          question?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcq_questions_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          link_course_id: string | null
          read: boolean
          title: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          link_course_id?: string | null
          read?: boolean
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          link_course_id?: string | null
          read?: boolean
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          employee_id: string | null
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          employee_id?: string | null
          full_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          employee_id?: string | null
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      quiz_attempts: {
        Row: {
          answers: Json
          created_at: string
          id: string
          lesson_id: string
          passed: boolean
          score: number
          total: number
          user_id: string
        }
        Insert: {
          answers?: Json
          created_at?: string
          id?: string
          lesson_id: string
          passed: boolean
          score: number
          total: number
          user_id: string
        }
        Update: {
          answers?: Json
          created_at?: string
          id?: string
          lesson_id?: string
          passed?: boolean
          score?: number
          total?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
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
      assigned_employees: {
        Args: { _course_id: string }
        Returns: { employee_id: string }[]
      }
      demote_admin: { Args: { _email: string }; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      promote_to_admin: { Args: { _email: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "learner"
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
      app_role: ["admin", "learner"],
    },
  },
} as const
