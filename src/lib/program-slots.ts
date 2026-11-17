/**
 * Where a saved workout can be added (planning/PLAN.md Q5.12): for each
 * trainee, each of the next few weeks — whether there's already a program
 * that week and how many workouts each day has (a day holds two at most).
 * Server-side; takes an already authenticated Supabase client.
 */

import type { createClient } from "@/lib/supabase/server";
import { selectInChunks } from "@/lib/previous-sets";
import { addDays, formatWeekLabel, formatWeekRange, getWeekStart, israelNow, toDateKey } from "@/lib/week";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const ADD_TO_PROGRAM_WEEKS = 5;

export interface WeekOption {
  key: string;
  /** "השבוע הנוכחי · 15/11–21/11" */
  label: string;
}

export interface ProgramSlot {
  programId: string;
  title: string;
  status: "draft" | "published";
  /** Workouts per day, Sunday first. */
  dayCounts: number[];
  inBlock: boolean;
}

/** By trainee id, then by week key. A week missing from the map has no program yet. */
export type ProgramSlots = Record<string, Record<string, ProgramSlot>>;

export function addToProgramWeeks(): WeekOption[] {
  const current = getWeekStart(israelNow());
  return Array.from({ length: ADD_TO_PROGRAM_WEEKS }, (_, i) => {
    const start = addDays(current, i * 7);
    return { key: toDateKey(start), label: `${formatWeekLabel(start, current)} · ${formatWeekRange(start)}` };
  });
}

/**
 * Every trainee's programs of the given weeks (RLS decides whose the caller
 * may see — the trainer: everyone's). Deliberately not filtered by a list
 * of trainee ids: that way it needs nothing but the weeks and can start
 * together with a page's first queries. The caller looks up only the
 * trainees it offers, so an extra entry in the map is never shown.
 */
export async function loadProgramSlots(supabase: Supabase, weeks: WeekOption[]): Promise<ProgramSlots> {
  const slots: ProgramSlots = {};
  if (weeks.length === 0) return slots;

  const { data } = await supabase
    .from("programs")
    .select("id, trainee_id, title, status, week_start_date, block_id")
    .in(
      "week_start_date",
      weeks.map((w) => w.key),
    )
    .is("deleted_at", null);
  const programs = data ?? [];
  const workouts = await selectInChunks(
    programs.map((p) => p.id),
    (chunk) => supabase.from("workouts").select("program_id, day_of_week").in("program_id", chunk),
  );

  for (const p of programs) {
    const dayCounts = [0, 0, 0, 0, 0, 0, 0];
    for (const w of workouts) if (w.program_id === p.id) dayCounts[w.day_of_week] += 1;
    slots[p.trainee_id] ??= {};
    slots[p.trainee_id][p.week_start_date] = {
      programId: p.id,
      title: p.title,
      status: p.status,
      dayCounts,
      inBlock: p.block_id != null,
    };
  }
  return slots;
}
