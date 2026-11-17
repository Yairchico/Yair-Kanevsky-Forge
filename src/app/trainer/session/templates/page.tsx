import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getRequestAuth } from "@/lib/viewer";
import { selectInChunks } from "@/lib/previous-sets";
import { addToProgramWeeks, loadProgramSlots } from "@/lib/program-slots";
import { TemplateList, type TemplateCard } from "./template-list";

/**
 * Saved workouts (planning/PLAN.md feature 5c): templates for a
 * trainer-led session. Trainer (and, read-only, the superadmin) only.
 */
export default async function SessionTemplatesPage() {
  const { supabase, viewer } = await getRequestAuth();
  const weeks = addToProgramWeeks();

  // Two waits instead of six: everything that depends on nothing, then
  // what hangs off the list of saved workouts.
  async function loadTemplates() {
    const { data: templates } = await supabase
      .from("session_templates")
      .select("id, title, notes, created_at, updated_at")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    const templateIds = (templates ?? []).map((t) => t.id);
    const [templateExercises, sessions] = await Promise.all([
      selectInChunks(templateIds, (chunk) =>
        supabase
          .from("session_template_exercises")
          .select("template_id, exercise_id, order_index")
          .in("template_id", chunk)
          .order("order_index"),
      ),
      selectInChunks(templateIds, (chunk) =>
        supabase
          .from("free_sessions")
          .select("template_id, trainee_id, guest_label, started_at")
          .in("template_id", chunk)
          .order("started_at", { ascending: false }),
      ),
    ]);
    return { templates, templateExercises, sessions };
  }

  const [me, { templates, templateExercises, sessions }, { data: trainees }, { data: exercises }, allSlots] =
    await Promise.all([
      viewer,
      loadTemplates(),
      supabase
        .from("profiles")
        .select("id, full_name, status")
        .eq("role", "trainee")
        .eq("is_superadmin", false)
        .order("full_name"),
      supabase.from("exercises").select("id, name"),
      loadProgramSlots(supabase, weeks),
    ]);
  if (!me) redirect("/login");
  const isTrainer = me.role === "trainer";
  if (!isTrainer && !me.isSuperadmin) redirect("/trainee");

  const exerciseName = new Map((exercises ?? []).map((e) => [e.id, e.name]));
  const traineeName = new Map((trainees ?? []).map((t) => [t.id, t.full_name]));

  const cards: TemplateCard[] = (templates ?? []).map((template) => {
    const rows = templateExercises
      .filter((e) => e.template_id === template.id)
      .sort((a, b) => a.order_index - b.order_index);
    const lastSession = sessions
      .filter((s) => s.template_id === template.id)
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0];
    return {
      id: template.id,
      title: template.title,
      notes: template.notes,
      createdAt: template.created_at,
      exerciseCount: rows.length,
      exerciseNames: rows.slice(0, 4).map((e) => exerciseName.get(e.exercise_id) ?? "תרגיל"),
      lastUsed: lastSession
        ? {
            at: lastSession.started_at,
            who: lastSession.trainee_id
              ? (traineeName.get(lastSession.trainee_id) ?? null)
              : lastSession.guest_label?.trim() || null,
          }
        : null,
    };
  });

  const activeTrainees = (trainees ?? []).filter((t) => t.status === "active").map((t) => ({ id: t.id, name: t.full_name }));
  const slots = isTrainer ? allSlots : {};

  return (
    <AppShell title="אימונים שמורים" backHref="/trainer/session" username={me.username} readOnly={!isTrainer}>
      <TemplateList
        readOnly={!isTrainer}
        templates={cards}
        trainees={activeTrainees}
        weeks={weeks}
        slots={slots}
      />
    </AppShell>
  );
}
