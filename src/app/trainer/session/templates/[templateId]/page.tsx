import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import type { InitialEditorItem } from "@/components/exercise-editor/exercise-list-editor";
import { selectInChunks } from "@/lib/previous-sets";
import { addToProgramWeeks, loadProgramSlots } from "@/lib/program-slots";
import { toPlannedSet, type PlannedSet } from "@/lib/sets";
import { getRequestAuth } from "@/lib/viewer";
import { isUuid } from "@/lib/utils";
import { TemplateEditor } from "./template-editor";

/** The editor of one saved workout: its name and note, and its exercises with target sets. */
export default async function SessionTemplatePage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  if (!isUuid(templateId)) notFound();

  const { supabase, viewer } = await getRequestAuth();
  const weeks = addToProgramWeeks();

  // One wait for everything that only needs the saved workout's id.
  const [me, { data: template }, { data: rows }, { data: catalog }, { data: trainees }, allSlots] = await Promise.all([
    viewer,
    supabase
      .from("session_templates")
      .select("id, title, notes")
      .eq("id", templateId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("session_template_exercises")
      .select("id, exercise_id, order_index, rest_seconds, instructions")
      .eq("template_id", templateId)
      .order("order_index")
      .order("id"),
    supabase
      .from("exercises")
      .select("id, name, muscle_group, equipment, media_url, instructions")
      .order("name"),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "trainee")
      .eq("is_superadmin", false)
      .eq("status", "active")
      .order("full_name"),
    loadProgramSlots(supabase, weeks),
  ]);
  if (!me) redirect("/login");
  const isTrainer = me.role === "trainer";
  if (!isTrainer && !me.isSuperadmin) redirect("/trainee");
  if (!template) notFound();

  const exerciseRows = rows ?? [];
  const setRows = await selectInChunks(
    exerciseRows.map((e) => e.id),
    (chunk) =>
      supabase
        .from("session_template_sets")
        .select("id, template_exercise_id, set_index, set_type, reps_min, reps_max, reps_note, weight_kg, weight_note, rpe")
        .in("template_exercise_id", chunk),
  );
  const setsByExercise = new Map<string, PlannedSet[]>();
  for (const row of setRows) {
    const list = setsByExercise.get(row.template_exercise_id) ?? [];
    list.push(toPlannedSet(row));
    setsByExercise.set(row.template_exercise_id, list);
  }

  const catalogById = new Map((catalog ?? []).map((e) => [e.id, e]));
  const initialItems: InitialEditorItem[] = exerciseRows.map((row) => {
    const exercise = catalogById.get(row.exercise_id);
    return {
      id: row.id,
      exerciseId: row.exercise_id,
      exerciseName: exercise?.name ?? "תרגיל לא ידוע",
      muscleGroup: exercise?.muscle_group ?? null,
      libraryNote: exercise?.instructions ?? null,
      fields: { rest_seconds: row.rest_seconds, instructions: row.instructions, hide_library_note: false },
      sets: (setsByExercise.get(row.id) ?? []).sort((a, b) => a.setIndex - b.setIndex),
    };
  });

  const slots = isTrainer ? allSlots : {};

  return (
    <AppShell title="אימון שמור" backHref="/trainer/session/templates" readOnly={!isTrainer}>
      <TemplateEditor
        readOnly={!isTrainer}
        template={{ id: template.id, title: template.title, notes: template.notes }}
        initialItems={initialItems}
        catalog={catalog ?? []}
        trainees={(trainees ?? []).map((t) => ({ id: t.id, name: t.full_name }))}
        weeks={weeks}
        slots={slots}
      />
    </AppShell>
  );
}
