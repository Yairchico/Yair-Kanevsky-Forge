import { notFound } from "next/navigation";
import Link from "next/link";
import { Layers, Play } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { isReadOnlyViewer } from "@/lib/viewer";
import { TraineeEditForm } from "./trainee-edit-form";
import { DeleteTraineeButton } from "./delete-trainee-button";
import { TraineeWeekView } from "./trainee-week-view";
import { ProgramRow } from "./program-row";
import { cn } from "@/lib/utils";
import { addDays, getWeekStart, toDateKey, israelNow, formatWeekRange, parseDateKey } from "@/lib/week";
import {
  PLANNED_SET_COLUMNS,
  SET_LOG_COLUMNS,
  formatLegacyActual,
  toLoggedSet,
  toPlannedSet,
  type LoggedSet,
  type PlannedSet,
} from "@/lib/sets";
import { selectInChunks } from "@/lib/previous-sets";
import { loadFreeSessionList } from "@/lib/free-session-data";
import { rollForwardBlocks } from "@/lib/block-server";
import { formatShortDateTime, countExercises, countSets } from "@/lib/format";

export default async function TraineeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const readOnly = user ? await isReadOnlyViewer(supabase, user.id) : false;

  // Training blocks: the once-a-week maintenance first, so the targets and
  // statuses read below are current. (Not for the read-only viewer.)
  if (!readOnly) await rollForwardBlocks(supabase, id);

  // Independent of each other — fetched together instead of one after
  // another, which used to add up (this page was reported as slow to open).
  const [{ data: trainee }, { data: programs }, { data: blocks }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, username, phone, email, status, created_at")
      .eq("id", id)
      .eq("role", "trainee")
      .single(),
    supabase
      .from("programs")
      .select("id, title, status, week_start_date, block_id, block_week_index, is_deload")
      .eq("trainee_id", id)
      .is("deleted_at", null)
      .order("week_start_date", { ascending: false }),
    supabase
      .from("blocks")
      .select("id, title, weeks_count, status, created_at")
      .eq("trainee_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  if (!trainee) notFound();

  const allPrograms = programs ?? [];
  const currentWeekKey = toDateKey(getWeekStart(israelNow()));
  const blockCards = (blocks ?? []).map((block) => {
    const weeks = allPrograms
      .filter((p) => p.block_id === block.id && p.block_week_index != null)
      .sort((a, b) => (a.block_week_index ?? 0) - (b.block_week_index ?? 0));
    const current = weeks.find((p) => p.week_start_date === currentWeekKey);
    const lastIndex = Math.max(0, ...weeks.map((p) => p.block_week_index ?? 0));
    const first = weeks[0];
    const upcoming = first != null && first.week_start_date > currentWeekKey;
    return {
      id: block.id,
      title: block.title,
      active: block.status === "active",
      lastIndex,
      currentIndex: current?.block_week_index ?? null,
      upcoming,
      range: first ? formatWeekRange(parseDateKey(first.week_start_date)) : null,
    };
  });
  const eightWeeksAgo = toDateKey(addDays(getWeekStart(israelNow()), -8 * 7));
  // Reuses the same fetch above instead of a second, near-identical
  // `programs` query just to narrow the date range.
  const recentPrograms = allPrograms.filter((p) => p.week_start_date >= eightWeeksAgo);

  const programIds = recentPrograms.map((p) => p.id);
  const noRows = ["00000000-0000-0000-0000-000000000000"];

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, program_id, day_of_week, order_index")
    .in("program_id", programIds.length ? programIds : noRows)
    .order("day_of_week")
    .order("order_index");

  const workoutIds = (workouts ?? []).map((w) => w.id);

  const [
    { data: workoutExercises },
    { data: exercises },
    { data: workoutCompletions },
    { data: exerciseCompletions },
  ] = await Promise.all([
    supabase
      .from("workout_exercises")
      .select("id, workout_id, exercise_id, order_index, rest_seconds, instructions")
      .in("workout_id", workoutIds.length ? workoutIds : noRows)
      .order("order_index"),
    supabase.from("exercises").select("id, name, muscle_group"),
    supabase
      .from("workout_completions")
      .select("workout_id, completed_at, source, notes")
      .eq("trainee_id", id)
      .in("workout_id", workoutIds.length ? workoutIds : noRows),
    supabase
      .from("workout_exercise_completions")
      .select("workout_exercise_id")
      .eq("trainee_id", id),
  ]);

  // Planned vs. performed per set (migration 0013), plus the exercise-level
  // note and, for anything logged before sets were split, the old value.
  const workoutExerciseIds = (workoutExercises ?? []).map((we) => we.id);
  const [plannedRows, loggedRows, exerciseLogRows] = await Promise.all([
    selectInChunks(workoutExerciseIds, (chunk) =>
      supabase.from("workout_exercise_sets").select(PLANNED_SET_COLUMNS).in("workout_exercise_id", chunk),
    ),
    selectInChunks(workoutExerciseIds, (chunk) =>
      supabase
        .from("set_logs")
        .select(SET_LOG_COLUMNS)
        .eq("trainee_id", id)
        .eq("status", "done")
        .in("workout_exercise_id", chunk),
    ),
    selectInChunks(workoutExerciseIds, (chunk) =>
      supabase
        .from("workout_logs")
        .select("workout_exercise_id, actual_sets, notes")
        .eq("trainee_id", id)
        .in("workout_exercise_id", chunk),
    ),
  ]);

  // Free sessions the trainer assigned to this trainee (migration 0016).
  const freeSessions = (await loadFreeSessionList(supabase, { traineeId: id, limit: 12 })).filter(
    (session) => session.setCount > 0 || !session.finishedAt,
  );

  const exerciseById = new Map((exercises ?? []).map((e) => [e.id, e]));
  const submissionByWorkoutId = new Map((workoutCompletions ?? []).map((c) => [c.workout_id, c]));
  const doneExerciseIds = new Set(
    (exerciseCompletions ?? []).map((c) => c.workout_exercise_id),
  );
  const plannedByWe = new Map<string, PlannedSet[]>();
  for (const row of plannedRows) {
    const list = plannedByWe.get(row.workout_exercise_id) ?? [];
    list.push(toPlannedSet(row));
    plannedByWe.set(row.workout_exercise_id, list);
  }
  const loggedByWe = new Map<string, LoggedSet[]>();
  for (const row of loggedRows) {
    // Carried-over rows are shown through legacyActual (the original text) instead.
    if (row.source === "legacy") continue;
    const list = loggedByWe.get(row.workout_exercise_id) ?? [];
    list.push(toLoggedSet(row));
    loggedByWe.set(row.workout_exercise_id, list);
  }
  const exerciseLogByWe = new Map(exerciseLogRows.map((l) => [l.workout_exercise_id, l]));

  const weeks = recentPrograms.map((program) => ({
    programId: program.id,
    title: program.title,
    status: program.status,
    weekStartDate: program.week_start_date,
    workouts: (workouts ?? [])
      .filter((w) => w.program_id === program.id)
      .map((w) => ({
        id: w.id,
        dayOfWeek: w.day_of_week,
        orderIndex: w.order_index,
        submittedAt: submissionByWorkoutId.get(w.id)?.completed_at ?? null,
        submittedBy: submissionByWorkoutId.get(w.id)?.source ?? null,
        sessionNote: submissionByWorkoutId.get(w.id)?.notes ?? null,
        exercises: (workoutExercises ?? [])
          .filter((we) => we.workout_id === w.id)
          .map((we) => {
            const exercise = exerciseById.get(we.exercise_id);
            const loggedSets = (loggedByWe.get(we.id) ?? []).sort((a, b) => a.setIndex - b.setIndex);
            const exerciseLog = exerciseLogByWe.get(we.id);
            return {
              id: we.id,
              name: exercise?.name ?? "תרגיל לא ידוע",
              muscleGroup: exercise?.muscle_group ?? null,
              plannedSets: (plannedByWe.get(we.id) ?? []).sort((a, b) => a.setIndex - b.setIndex),
              loggedSets,
              restSeconds: we.rest_seconds,
              instructions: we.instructions,
              done: doneExerciseIds.has(we.id),
              note: exerciseLog?.notes ?? null,
              // Only when nothing has been logged per set since (re-logging
              // an old exercise replaces the old value as what's current).
              legacyActual: loggedSets.length === 0 ? formatLegacyActual(exerciseLog?.actual_sets) : null,
            };
          }),
      })),
  }));

  return (
    <AppShell title={trainee.full_name} backHref="/trainer/trainees" readOnly={readOnly}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>פרטי מתאמן</CardTitle>
            <CardDescription>עריכה ואיפוס סיסמה</CardDescription>
          </CardHeader>
          <CardContent>
            <TraineeEditForm trainee={trainee} readOnly={readOnly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div className="min-w-[12rem] flex-1">
              <CardTitle>תוכניות אימון</CardTitle>
              <CardDescription>תוכניות שבועיות עבור {trainee.full_name}</CardDescription>
            </div>
            {!readOnly && (
              <Link
                href={`/trainer/trainees/${id}/programs/new`}
                className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
              >
                + תוכנית חדשה
              </Link>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {!allPrograms.length ? (
              <p className="text-sm text-muted-foreground">עדיין אין תוכניות.</p>
            ) : (
              allPrograms.map((p) => (
                <ProgramRow
                  key={p.id}
                  traineeId={id}
                  program={p}
                  blockTag={
                    p.block_id && p.block_week_index != null
                      ? `בלוק · שבוע ${p.block_week_index}${p.is_deload ? " · דילואד" : ""}`
                      : null
                  }
                  readOnly={readOnly}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div className="min-w-[12rem] flex-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4 text-primary-text" />
              בלוקים
            </CardTitle>
            <CardDescription>רצף שבועות שבו היעדים מתקדמים אוטומטית לפי הביצוע</CardDescription>
          </div>
          {!readOnly && (
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Link
                href={`/trainer/trainees/${id}/blocks/convert`}
                className={buttonVariants({ size: "sm", variant: "ghost" })}
              >
                משבועות קיימים
              </Link>
              <Link
                href={`/trainer/trainees/${id}/blocks/new`}
                className={buttonVariants({ size: "sm", variant: "outline" })}
              >
                + בלוק חדש
              </Link>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {blockCards.length === 0 ? (
            <p className="text-sm text-muted-foreground">עדיין אין בלוקים.</p>
          ) : (
            blockCards.map((block) => (
              <Link
                key={block.id}
                href={`/trainer/trainees/${id}/blocks/${block.id}`}
                className="block rounded-md border border-border p-3 text-sm transition-colors hover:bg-hover"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{block.title}</p>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      block.active ? "bg-success/15 text-success" : "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {!block.active
                      ? "הסתיים"
                      : block.currentIndex != null
                        ? `שבוע ${block.currentIndex} מתוך ${block.lastIndex}`
                        : block.upcoming
                          ? `מתחיל ${block.range ?? ""}`
                          : "פעיל"}
                  </span>
                </div>
                {block.active && block.lastIndex > 0 && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${((block.currentIndex ?? (block.upcoming ? 0 : block.lastIndex)) / block.lastIndex) * 100}%` }}
                    />
                  </div>
                )}
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div className="min-w-[12rem] flex-1">
            <CardTitle>התוכנית השבועית</CardTitle>
            <CardDescription>מה שהמתאמן סימן, ביצע בפועל והגיש (קריאה בלבד)</CardDescription>
          </div>
          {!readOnly && (
            <Link
              href={`/trainer/session?trainee=${id}`}
              className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
            >
              <Play className="h-4 w-4" />
              אימון אישי
            </Link>
          )}
        </CardHeader>
        <CardContent>
          {!weeks.length ? (
            <p className="text-sm text-muted-foreground">אין עדיין תוכניות.</p>
          ) : (
            <TraineeWeekView weeks={weeks} />
          )}
        </CardContent>
      </Card>

      {freeSessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">אימונים חופשיים</CardTitle>
            <CardDescription>
              אימונים עם המאמן שלא מהתוכנית השבועית. מופיעים בהיסטוריה של {trainee.full_name}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {freeSessions.map((session) => (
              <Link
                key={session.id}
                href={`/trainer/session/free/${session.id}`}
                className="flex items-center justify-between gap-2 rounded-md p-2 text-sm transition-colors hover:bg-hover"
              >
                <span className="truncate font-medium">
                  {session.guestLabel?.trim() || "אימון חופשי"}
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · {countExercises(session.exerciseCount)} · {countSets(session.setCount)}
                    {session.finishedAt ? "" : " · לא הסתיים"}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatShortDateTime(session.startedAt)}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {!readOnly && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-destructive">אזור מסוכן</CardTitle>
          </CardHeader>
          <CardContent>
            <DeleteTraineeButton traineeId={id} traineeName={trainee.full_name} />
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
