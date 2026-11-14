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
/** migration 0013. 'backoff' exists in the DB for later; the UI offers warmup/working only for now. */
export type SetType = "warmup" | "working" | "backoff";

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
          /** Read-only oversight account (migration 0011) — grants SELECT everywhere, never write. */
          is_superadmin: boolean;
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
          /** The permanent note: shown wherever this exercise appears in a program (unless that row hides it). */
          instructions: string | null;
          media_url: string | null;
          /** A YouTube / Vimeo / direct-file link (migration 0015) — parsed by src/lib/video.ts. */
          video_url: string | null;
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
          /** The Sunday that starts this program's calendar week. */
          week_start_date: string;
          published_at: string | null;
          created_at: string;
          updated_at: string;
          /** Soft-delete marker (migration 0010) — set instead of a hard DELETE, so history under it survives. */
          deleted_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["programs"]["Row"]> & {
          trainee_id: string;
          title: string;
          week_start_date: string;
        };
        Update: Partial<Database["public"]["Tables"]["programs"]["Row"]>;
        Relationships: [];
      };
      workouts: {
        Row: {
          id: string;
          program_id: string;
          /** 0 (Sunday) - 6 (Saturday) — see src/lib/week.ts. Up to 2 workouts/day. */
          day_of_week: number;
          /** 0-based order *within that day* (0 or 1) — not a global position. */
          order_index: number;
          title: string | null;
          notes: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["workouts"]["Row"]> & {
          program_id: string;
          day_of_week: number;
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
          /** @deprecated legacy (pre-0013) — per-set targets live in workout_exercise_sets now. Not read or written by the app. */
          sets: number | null;
          /** @deprecated legacy (pre-0013), see `sets`. */
          reps: string | null;
          /** @deprecated legacy (pre-0013), see `sets`. */
          weight: string | null;
          /** @deprecated legacy (pre-0013), see `sets`. */
          rpe: number | null;
          rest_seconds: number | null;
          /** A note for this program only — shown in addition to the exercise's permanent note. */
          instructions: string | null;
          /** Don't show the exercise's permanent note (exercises.instructions) in this program (migration 0015). */
          hide_library_note: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["workout_exercises"]["Row"]> & {
          workout_id: string;
          exercise_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["workout_exercises"]["Row"]>;
        Relationships: [];
      };
      workout_exercise_sets: {
        Row: {
          id: string;
          workout_exercise_id: string;
          /** 1-based position within the exercise. */
          set_index: number;
          set_type: SetType;
          reps_min: number | null;
          reps_max: number | null;
          /** Non-numeric reps target ("AMRAP", "30 שנ׳") — set when reps_min is null. */
          reps_note: string | null;
          weight_kg: number | null;
          /** Non-numeric load ("משקל גוף") — set when weight_kg is null. */
          weight_note: string | null;
          rpe: number | null;
          /** Training blocks (feature 2) — unused until then. */
          is_manual_override: boolean;
          progression_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["workout_exercise_sets"]["Row"]> & {
          workout_exercise_id: string;
          set_index: number;
        };
        Update: Partial<Database["public"]["Tables"]["workout_exercise_sets"]["Row"]>;
        Relationships: [];
      };
      set_logs: {
        Row: {
          id: string;
          workout_exercise_id: string;
          /** null = an extra set beyond the plan (or its planned set was removed). */
          workout_exercise_set_id: string | null;
          trainee_id: string;
          set_index: number;
          weight_kg: number | null;
          reps: number | null;
          rpe: number | null;
          status: "done" | "skipped";
          /** 'legacy' = carried over by migration 0013 from the old one-value-per-exercise workout_logs. */
          source: "trainee" | "trainer_session" | "legacy";
          logged_by: string | null;
          logged_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["set_logs"]["Row"]> & {
          workout_exercise_id: string;
          trainee_id: string;
          set_index: number;
        };
        Update: Partial<Database["public"]["Tables"]["set_logs"]["Row"]>;
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
          /** Who submitted it first — decided by a DB trigger (migration 0016), never by the client. */
          source: "trainee" | "trainer_session";
          completed_by: string | null;
          /** The overall note of a trainer-led session. */
          notes: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["workout_completions"]["Row"]> & {
          workout_id: string;
          trainee_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["workout_completions"]["Row"]>;
        Relationships: [];
      };
      workout_exercise_completions: {
        Row: {
          id: string;
          workout_exercise_id: string;
          trainee_id: string;
          completed_at: string;
        };
        Insert: Partial<
          Database["public"]["Tables"]["workout_exercise_completions"]["Row"]
        > & {
          workout_exercise_id: string;
          trainee_id: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["workout_exercise_completions"]["Row"]
        >;
        Relationships: [];
      };
      session_templates: {
        Row: {
          id: string;
          title: string;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["session_templates"]["Row"]> & { title: string };
        Update: Partial<Database["public"]["Tables"]["session_templates"]["Row"]>;
        Relationships: [];
      };
      session_template_exercises: {
        Row: {
          id: string;
          template_id: string;
          exercise_id: string;
          order_index: number;
          rest_seconds: number | null;
          instructions: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["session_template_exercises"]["Row"]> & {
          template_id: string;
          exercise_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["session_template_exercises"]["Row"]>;
        Relationships: [];
      };
      session_template_sets: {
        Row: {
          id: string;
          template_exercise_id: string;
          set_index: number;
          set_type: SetType;
          reps_min: number | null;
          reps_max: number | null;
          reps_note: string | null;
          weight_kg: number | null;
          weight_note: string | null;
          rpe: number | null;
        };
        Insert: Partial<Database["public"]["Tables"]["session_template_sets"]["Row"]> & {
          template_exercise_id: string;
          set_index: number;
        };
        Update: Partial<Database["public"]["Tables"]["session_template_sets"]["Row"]>;
        Relationships: [];
      };
      free_sessions: {
        Row: {
          id: string;
          /** null = not assigned to anyone. */
          trainee_id: string | null;
          guest_label: string | null;
          template_id: string | null;
          started_at: string;
          finished_at: string | null;
          notes: string | null;
          created_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["free_sessions"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["free_sessions"]["Row"]>;
        Relationships: [];
      };
      free_session_exercises: {
        Row: {
          id: string;
          session_id: string;
          exercise_id: string;
          order_index: number;
          rest_seconds: number | null;
          /** From the template the session was started from. */
          instructions: string | null;
          /** Typed during the session. */
          notes: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["free_session_exercises"]["Row"]> & {
          session_id: string;
          exercise_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["free_session_exercises"]["Row"]>;
        Relationships: [];
      };
      free_session_sets: {
        Row: {
          id: string;
          session_exercise_id: string;
          set_index: number;
          set_type: SetType;
          target_reps_min: number | null;
          target_reps_max: number | null;
          target_reps_note: string | null;
          target_weight_kg: number | null;
          target_weight_note: string | null;
          target_rpe: number | null;
          weight_kg: number | null;
          reps: number | null;
          rpe: number | null;
          /** null = planned but not performed. */
          logged_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["free_session_sets"]["Row"]> & {
          session_exercise_id: string;
          set_index: number;
        };
        Update: Partial<Database["public"]["Tables"]["free_session_sets"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      email_for_username: {
        Args: { p_username: string };
        Returns: string | null;
      };
      /** Creates a free session, copying a saved workout's exercises + targets into it (migration 0016). */
      start_free_session: {
        Args: { p_template_id?: string | null; p_trainee_id?: string | null; p_guest_label?: string | null };
        Returns: string;
      };
      /** New template from what a session performed (p_title), or update an existing one (p_template_id). */
      save_session_as_template: {
        Args: { p_session_id: string; p_title?: string | null; p_template_id?: string | null };
        Returns: string;
      };
      duplicate_session_template: {
        Args: { p_template_id: string };
        Returns: string;
      };
    };
  };
}
