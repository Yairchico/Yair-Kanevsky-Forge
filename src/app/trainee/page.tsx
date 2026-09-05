import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { History } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ExerciseCheckbox,
  PerformanceLogForm,
  SubmitWorkoutButton,
} from "./workout-actions";

export default async function TraineeHomePage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const { day } = await searchParams;
  const dayIndex = Number(day ?? "0") || 0;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <AppShell title="השבוע שלי">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            שגיאת התחברות.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();

  const { data: program } = await supabase
    .from("programs")
    .select("id, title")
    .eq("trainee_id", user.id)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!program) {
    return (
      <AppShell title="השבוע שלי" username={profile?.username}>
        <Card>
          <CardHeader>
            <CardTitle>עדיין אין תוכנית מפורסמת</CardTitle>
            <CardDescription>
              כשהמאמן יפרסם עבורך תוכנית שבועית, היא תופיע כאן.
            </CardDescription>
          </CardHeader>
        </Card>
      </AppShell>
    );
  }

  const { data: days } = await supabase
    .from("program_days")
    .select("id, day_index, label")
    .eq("program_id", program.id)
    .order("day_index");

  const dayIds = (days ?? []).map((d) => d.id);
  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, program_day_id")
    .in("program_day_id", dayIds.length ? dayIds : ["00000000-0000-0000-0000-000000000000"]);

  const workoutIds = (workouts ?? []).map((w) => w.id);
  const [
    { data: workoutExercises },
    { data: exercises },
    { data: workoutCompletions },
    { data: exerciseCompletions },
  ] = await Promise.all([
    supabase
      .from("workout_exercises")
      .select(
        "id, workout_id, exercise_id, order_index, sets, reps, weight, rpe, rest_seconds, instructions",
      )
      .in(
        "workout_id",
        workoutIds.length ? workoutIds : ["00000000-0000-0000-0000-000000000000"],
      )
      .order("order_index"),
    supabase.from("exercises").select("id, name, muscle_group"),
    supabase
      .from("workout_completions")
      .select("workout_id")
      .eq("trainee_id", user.id)
      .in(
        "workout_id",
        workoutIds.length ? workoutIds : ["00000000-0000-0000-0000-000000000000"],
      ),
    supabase
      .from("workout_exercise_completions")
      .select("workout_exercise_id")
      .eq("trainee_id", user.id),
  ]);

  const exerciseById = new Map((exercises ?? []).map((e) => [e.id, e]));
  const submittedWorkoutIds = new Set(
    (workoutCompletions ?? []).map((c) => c.workout_id),
  );
  const doneExerciseIds = new Set(
    (exerciseCompletions ?? []).map((c) => c.workout_exercise_id),
  );

  const currentDay = (days ?? []).find((d) => d.day_index === dayIndex) ?? days?.[0];
  const currentWorkout = (workouts ?? []).find(
    (w) => w.program_day_id === currentDay?.id,
  );
  const currentExercises = (workoutExercises ?? [])
    .filter((we) => we.workout_id === currentWorkout?.id)
    .map((we) => ({ ...we, exercise: exerciseById.get(we.exercise_id) }));

  return (
    <AppShell title={program.title} username={profile?.username}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(days ?? []).map((d) => {
          const w = (workouts ?? []).find((w) => w.program_day_id === d.id);
          const submitted = w ? submittedWorkoutIds.has(w.id) : false;
          return (
            <Link
              key={d.id}
              href={`/trainee?day=${d.day_index}`}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                d.day_index === dayIndex
                  ? "bg-primary text-primary-foreground"
                  : submitted
                    ? "bg-success/15 text-success"
                    : "bg-secondary text-secondary-foreground hover:bg-muted",
              )}
            >
              {d.label}
            </Link>
          );
          })}
        </div>
        <Link
          href="/trainee/history"
          className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <History className="h-4 w-4" />
          היסטוריה
        </Link>
      </div>

      {currentExercises.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            אין אימון מתוכנן ליום הזה.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {currentExercises.map((we) => (
              <Card key={we.id}>
                <CardContent className="flex items-start gap-3 p-4">
                  <ExerciseCheckbox
                    workoutExerciseId={we.id}
                    completed={doneExerciseIds.has(we.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{we.exercise?.name}</p>
                    {we.exercise?.muscle_group && (
                      <p className="text-xs text-muted-foreground">
                        {we.exercise.muscle_group}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      {we.sets != null && <span>{we.sets} סטים</span>}
                      {we.reps && <span>{we.reps} חזרות</span>}
                      {we.weight && <span>{we.weight}</span>}
                      {we.rpe != null && <span>RPE {we.rpe}</span>}
                      {we.rest_seconds != null && (
                        <span>{we.rest_seconds} שנ׳ מנוחה</span>
                      )}
                    </div>
                    {we.instructions && (
                      <p className="mt-2 text-sm">{we.instructions}</p>
                    )}
                    <div className="mt-2">
                      <PerformanceLogForm workoutExerciseId={we.id} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {currentWorkout && (
            <SubmitWorkoutButton
              workoutId={currentWorkout.id}
              submitted={submittedWorkoutIds.has(currentWorkout.id)}
            />
          )}
        </>
      )}
    </AppShell>
  );
}
