// Hand-written types matching supabase/migrations/0001_init.sql.
//
// Once the Supabase project is linked, regenerate the real thing with:
//   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
// and this file (and this comment) can go away.
//
// Every table needs `Relationships` (even if empty) and the schema needs
// `Views`/`Functions` (even if empty) — @supabase/postgrest-js's generic
// constraints require them structurally, or column types silently degrade
// to `never`.

export type UserRole = "trainer" | "trainee";
export type ProgramStatus = "draft" | "published";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          role: UserRole;
          full_name: string;
          username: string;
          phone: string | null;
          email: string | null;
          avatar_url: string | null;
          status: "active" | "archived";
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          id: string;
          full_name: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      exercises: {
        Row: {
          id: string;
          name: string;
          muscle_group: string | null;
          equipment: string | null;
          instructions: string | null;
          media_url: string | null;
          is_custom: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["exercises"]["Row"]> & {
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["exercises"]["Row"]>;
        Relationships: [];
      };
      programs: {
        Row: {
          id: string;
          trainee_id: string;
          title: string;
          status: ProgramStatus;
          version: number;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["programs"]["Row"]> & {
          trainee_id: string;
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["programs"]["Row"]>;
        Relationships: [];
      };
      program_days: {
        Row: {
          id: string;
          program_id: string;
          day_index: number;
          label: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["program_days"]["Row"]> & {
          program_id: string;
          day_index: number;
        };
        Update: Partial<Database["public"]["Tables"]["program_days"]["Row"]>;
        Relationships: [];
      };
      workouts: {
        Row: {
          id: string;
          program_day_id: string;
          order_index: number;
          title: string | null;
          notes: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["workouts"]["Row"]> & {
          program_day_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["workouts"]["Row"]>;
        Relationships: [];
      };
      workout_exercises: {
        Row: {
          id: string;
          workout_id: string;
          exercise_id: string;
          order_index: number;
          sets: number | null;
          reps: string | null;
          weight: string | null;
          rpe: number | null;
          rest_seconds: number | null;
          instructions: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["workout_exercises"]["Row"]> & {
          workout_id: string;
          exercise_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["workout_exercises"]["Row"]>;
        Relationships: [];
      };
      workout_logs: {
        Row: {
          id: string;
          workout_exercise_id: string;
          trainee_id: string;
          performed_at: string;
          actual_sets: unknown | null;
          rpe_actual: number | null;
          notes: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["workout_logs"]["Row"]> & {
          workout_exercise_id: string;
          trainee_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["workout_logs"]["Row"]>;
        Relationships: [];
      };
      workout_completions: {
        Row: {
          id: string;
          workout_id: string;
          trainee_id: string;
          completed_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["workout_completions"]["Row"]> & {
          workout_id: string;
          trainee_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["workout_completions"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      email_for_username: {
        Args: { p_username: string };
        Returns: string | null;
      };
    };
  };
}
