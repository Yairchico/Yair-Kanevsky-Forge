import { notFound, redirect } from "next/navigation";
import { getRequestAuth } from "@/lib/viewer";
import { getPreviousPerformance } from "@/lib/previous-sets";
import { loadExercisesOfSessions } from "@/lib/free-session-data";
import { isUuid } from "@/lib/utils";
import { FreeSessionRunner } from "./free-session-runner";
import { FreeSessionSummary } from "./free-session-summary";

/**
 * A free session (planning/PLAN.md features 5b/5c). While it's open the
 * trainer gets the live screen; once finished — and always for the
 * read-only superadmin — it's a summary of what was done, with assigning,
 * re-opening, saving as a saved workout and deleting for the trainer.
 */
export default async function FreeSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ template?: string }>;
}) {
  const { sessionId } = await params;
  const { template: templateParam } = await searchParams;
  if (!isUuid(sessionId)) notFound();

  const { supabase, viewer } = await getRequestAuth();

  // One wait for everything that only needs the session's id.
  const [me, { data: session }, baseExercises, { data: trainees }, { data: fullCatalog }] = await Promise.all([
    viewer,
    supabase
      .from("free_sessions")
      .select("id, trainee_id, guest_label, template_id, started_at, finished_at, notes")
      .eq("id", sessionId)
      .maybeSingle(),
    loadExercisesOfSessions(supabase, [sessionId]),
    supabase
      .from("profiles")
      .select("id, full_name, status")
      .eq("role", "trainee")
      .eq("is_superadmin", false)
      .order("full_name"),
    supabase
      .from("exercises")
      .select("id, name, muscle_group, equipment, media_url, instructions")
      .order("name"),
  ]);
  if (!me) redirect("/login");
  const isTrainer = me.role === "trainer";
  if (!isTrainer && !me.isSuperadmin) redirect("/trainee");
  if (!session) notFound();

  const live = isTrainer && !session.finished_at;
  const catalog = live ? fullCatalog : [];

  // Then what needs the session row itself: its saved workout, and — when
  // it belongs to a trainee — what they did last time on each exercise.
  let exercises = baseExercises.get(sessionId) ?? [];
  const [{ data: template }, previous] = await Promise.all([
    session.template_id
      ? supabase
          .from("session_templates")
          .select("id, title, deleted_at")
          .eq("id", session.template_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    session.trainee_id && exercises.length > 0
      ? getPreviousPerformance(
          supabase,
          session.trainee_id,
          exercises.map((e) => ({ key: e.id, exerciseId: e.exerciseId })),
        )
      : null,
  ]);
  if (previous) exercises = exercises.map((e) => ({ ...e, previous: previous.get(e.id) ?? null }));

  const traineeName = (trainees ?? []).find((t) => t.id === session.trainee_id)?.full_name ?? null;
  // An inactive trainee stays selectable only if this session is already theirs.
  const traineeOptions = (trainees ?? [])
    .filter((t) => t.status === "active" || t.id === session.trainee_id)
    .map((t) => ({ id: t.id, name: t.full_name }));
  const liveTemplate = template && !template.deleted_at ? { id: template.id, title: template.title } : null;

  if (live) {
    return (
      <FreeSessionRunner
        sessionId={session.id}
        startedAt={session.started_at}
        initialLabel={session.guest_label ?? ""}
        initialGeneralNote={session.notes ?? ""}
        assignedTraineeId={session.trainee_id}
        traineeName={traineeName}
        trainees={traineeOptions}
        template={liveTemplate}
        initialExercises={exercises}
        catalog={catalog ?? []}
      />
    );
  }

  return (
    <FreeSessionSummary
      readOnly={!isTrainer}
      templateSaveFailed={templateParam === "failed"}
      session={{
        id: session.id,
        traineeId: session.trainee_id,
        guestLabel: session.guest_label,
        startedAt: session.started_at,
        finishedAt: session.finished_at,
        notes: session.notes,
      }}
      traineeName={traineeName}
      trainees={traineeOptions}
      template={template ? { id: template.id, title: template.title, deleted: Boolean(template.deleted_at) } : null}
      exercises={exercises}
    />
  );
}
