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

/**
 * workout_exercises.progression_info (migration 0017): how a block week's
 * targets for one exercise were derived from the week before. Absent keys
 * mean "not applicable" (the function strips nulls).
 */
export interface ProgressionInfo {
  /**
   * advanced: the base week was completed (or the rule doesn't look at
   * performance); projected: not decided yet, assuming success; repeated:
   * done but short of the targets; skipped: not done at all; deload: a
   * deload week; none: no rule, the base week's targets carried over.
   */
  outcome: "advanced" | "projected" | "repeated" | "skipped" | "deload" | "none";
  /** The block week these targets were computed from. */
  base_week: number;
  /** Working sets completed at target in the base week, out of `total`. */
  completed?: number;
  total?: number;
  /** Change of the first working set vs. the base week (displayed weight / minimum reps). */
  delta_kg?: number;
  delta_reps?: number;
  /** The exact weight, when the displayed one is rounded from it. */
  exact_kg?: number;
  /** Double progression: reps went back to where the block started (with a weight step). */
  reset_reps?: boolean;
  deload_pct?: number;
}

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
          /** An uploaded video in the "exercise-videos" bucket (migration 0019); never set together with video_url. */
          video_storage_path: string | null;
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
          /** The training block this week belongs to, if any (migration 0017). */
          block_id: string | null;
          /** 1-based week number inside the block. Only meaningful with block_id. */
          block_week_index: number | null;
          is_deload: boolean;
          /** null = the block's default_deload_pct. */
          deload_pct: number | null;
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
          /** "The same workout" across the weeks of a block (migration 0017). */
          slot_key: string;
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
          /** "The same exercise" across the weeks of a block (migration 0017). */
          slot_key: string;
          /** How this exercise moves from this week to the next one in its block. */
          progression_type: "none" | "weight" | "reps" | "double";
          weight_step_unit: "kg" | "pct";
          weight_step_kg: number | null;
          weight_step_pct: number | null;
          reps_step: number | null;
          reps_cap: number | null;
          progression_basis: "actual" | "planned";
          rounding_kg: number;
          /** Why this week's targets are what they are — written by block_recompute_internal(). */
          progression_info: ProgressionInfo | null;
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
          /** The weight before rounding, when it differs from weight_kg (percent progression, migration 0017). */
          weight_kg_exact: number | null;
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
      blocks: {
        Row: {
          id: string;
          trainee_id: string;
          title: string;
          weeks_count: number;
          status: "active" | "completed";
          default_deload_pct: number;
          auto_publish_next_week: boolean;
          notes: string | null;
          /** The week (its Sunday) up to which block_roll_forward() already ran. */
          rolled_through: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["blocks"]["Row"]> & {
          trainee_id: string;
          title: string;
          weeks_count: number;
        };
        Update: Partial<Database["public"]["Tables"]["blocks"]["Row"]>;
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
      /** Copies a program's workouts, exercises and planned sets into an empty program, atomically (migration 0018). Trainer only. */
      /** A saved workout copied into a trainee's weekly program (migration 0019). Errors: BK003 "DAY_FULL". */
      add_template_to_program: {
        Args: {
          p_template_id: string;
          p_trainee_id: string;
          p_week_start: string;
          p_day_of_week: number;
          p_program_title?: string | null;
        };
        Returns: { program_id: string; workout_id: string; created_program: boolean; reverted_to_draft: boolean };
      };
      /** Existing weekly programs become a training block (migration 0019). Errors: BK001, BK004. */
      convert_programs_to_block: {
        Args: {
          p_trainee_id: string;
          p_title: string;
          p_program_ids: string[];
          p_extra_weeks?: number;
          p_deload_weeks?: number[];
          p_deload_pct?: number;
          p_auto_publish?: boolean;
        };
        Returns: string;
      };
      copy_program_structure: {
        Args: { p_from: string; p_to: string };
        Returns: undefined;
      };
      // ---- training blocks (migration 0017). All SECURITY DEFINER with their own caller checks.
      /** Errors: BK001 "WEEK_TAKEN <date>", BK002 "WEEK_HAS_PERFORMANCE <date>". */
      create_block: {
        Args: {
          p_trainee_id: string;
          p_title: string;
          p_start_week: string;
          p_weeks_count: number;
          p_deload_weeks?: number[];
          p_deload_pct?: number;
          p_source_program_id?: string | null;
          p_use_performed?: boolean;
          p_replace_existing?: boolean;
          p_auto_publish?: boolean;
        };
        Returns: string;
      };
      /** Returns { updated: number[]; frozen: number[] } — block week numbers. */
      apply_block_structure: {
        Args: { p_program_id: string };
        Returns: { updated: number[]; frozen: number[] };
      };
      recompute_block: {
        Args: { p_block_id: string; p_from_index?: number };
        Returns: undefined;
      };
      /** Callable by the workout's trainee or the trainer. */
      apply_block_progression: {
        Args: { p_workout_id: string };
        Returns: undefined;
      };
      /** Callable by the block's trainee or the trainer. */
      block_roll_forward: {
        Args: { p_block_id: string };
        Returns: undefined;
      };
      set_exercise_progression: {
        Args: {
          p_workout_exercise_id: string;
          p_type: string;
          p_unit: string;
          p_step_kg: number | null;
          p_step_pct: number | null;
          p_reps_step: number | null;
          p_reps_cap: number | null;
          p_basis: string;
          p_rounding_kg: number;
        };
        Returns: undefined;
      };
      clear_set_override: {
        Args: { p_set_id: string };
        Returns: undefined;
      };
      shift_block: {
        Args: { p_block_id: string; p_from_index: number };
        Returns: undefined;
      };
      insert_block_deload: {
        Args: { p_block_id: string; p_after_index: number; p_deload_pct?: number | null };
        Returns: string;
      };
      set_block_week_deload: {
        Args: { p_program_id: string; p_is_deload: boolean; p_deload_pct?: number | null };
        Returns: undefined;
      };
      end_block: {
        Args: { p_block_id: string; p_remove_future?: boolean };
        Returns: undefined;
      };
      delete_block: {
        Args: { p_block_id: string };
        Returns: undefined;
      };
      start_next_block: {
        Args: {
          p_block_id: string;
          p_title: string;
          p_weeks_count: number;
          p_deload_weeks?: number[];
          p_deload_pct?: number;
          p_use_performed?: boolean;
          p_replace_existing?: boolean;
        };
        Returns: string;
      };
    };
  };
}
