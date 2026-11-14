"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUp, Check, ChevronLeft, History, Lock, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getExerciseImage } from "@/lib/exercise-image";
import { ExerciseThumbnail } from "@/components/exercise-photo";
import { dayName } from "@/lib/week";
import { Toast, useToast } from "@/components/toast";
import { summarizeSets } from "@/lib/sets";
import { useSetEntry, type SetEntryApi } from "@/lib/use-set-entry";
import { draftKeys } from "@/lib/workout-draft";
import { SubmitWorkoutButton } from "./workout-actions";
import { logSet, toggleExerciseCompletion, unlogSet } from "./actions";
import { TraineeExerciseModal, type TraineeExerciseData } from "./trainee-exercise-modal";

interface ExerciseData extends TraineeExerciseData {
  done: boolean;
}

export interface WorkoutData {
  id: string;
  dayOfWeek: number;
  orderIndex: number;
  submitted: boolean;
  /** False for weeks older than the previous one — see isEditableWeek in actions.ts. */
  editable: boolean;
  exercises: ExerciseData[];
}

/**
 * All of the current week's workouts are fetched once by the server (see
 * page.tsx) and handed here, so switching between "אימון 1" / "אימון 2" is
 * a local state change — no server round trip. That used to be a `<Link
 * href="/trainee?workout=N">`, i.e. a full server re-render just to look
 * at a different workout, which is exactly what made it feel slow.
 *
 * Defaults to the earliest not-yet-submitted workout (falling back to the
 * first one if everything's already done) instead of always the first tab
 * — a trainee opening this screen mid-week usually wants to pick up where
 * they left off, not re-see Sunday's already-submitted workout. (The
 * weekly progress summary and "האימון הבא" preview live on the home
 * screen, /trainee — see home-dashboard.tsx — not here; this screen is
 * just the workouts themselves.)
 */
export function TraineeWorkoutTabs({ workouts }: { workouts: WorkoutData[] }) {
  const [activeId, setActiveId] = useState(
    () => workouts.find((w) => !w.submitted)?.id ?? workouts[0]?.id ?? null,
  );
  const activeWorkout = workouts.find((w) => w.id === activeId) ?? workouts[0];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {workouts.map((w) => {
            const sameDayCount = workouts.filter((x) => x.dayOfWeek === w.dayOfWeek).length;
            const label =
              sameDayCount > 1
                ? `${dayName(w.dayOfWeek)} · אימון ${w.orderIndex + 1}`
                : dayName(w.dayOfWeek);
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => setActiveId(w.id)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  w.id === activeWorkout?.id
                    ? "bg-primary text-primary-foreground"
                    : w.submitted
                      ? "bg-success/15 text-success"
                      : "bg-secondary text-secondary-foreground hover:bg-muted",
                )}
              >
                {label}
              </button>
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

      {!activeWorkout || activeWorkout.exercises.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-base text-muted-foreground">
            אין תרגילים באימון הזה.
          </CardContent>
        </Card>
      ) : (
        // Keyed by workout id so switching tabs remounts this panel — its
        // draft state is reloaded fresh from localStorage for whichever
        // workout is now active, rather than one panel juggling every
        // workout's draft at once.
        <WorkoutPanel key={activeWorkout.id} workout={activeWorkout} />
      )}
    </div>
  );
}

/** The trainee's own Server Actions behind the shared set-entry state machine. */
const TRAINEE_SET_API: SetEntryApi = { log: logSet, unlog: unlogSet };

/**
 * One workout: the list of exercise cards, the exercise modal, and the
 * submit button. All of the per-set entry state — what's saved, what's
 * typed but not saved, what's waiting for a connection — is useSetEntry's
 * (src/lib/use-set-entry.ts); this component only adds the exercise "done"
 * marks and wires things together.
 */
function WorkoutPanel({ workout }: { workout: WorkoutData }) {
  const toast = useToast();

  // The server's "done" marks, plus whatever this screen changed since.
  const [doneOverrides, setDoneOverrides] = useState<Record<string, boolean>>({});
  const isDone = (ex: ExerciseData) => doneOverrides[ex.id] ?? ex.done;
  const [, startDoneTransition] = useTransition();

  const entry = useSetEntry({
    storageKey: draftKeys.trainee(workout.id),
    exercises: workout.exercises,
    api: TRAINEE_SET_API,
    editable: workout.editable,
    onToast: toast.show,
    onExerciseDone: (exerciseId) => setDoneOverrides((prev) => ({ ...prev, [exerciseId]: true })),
  });

  const [openExerciseId, setOpenExerciseId] = useState<string | null>(null);

  function toggleDone(exerciseId: string, next: boolean) {
    setDoneOverrides((prev) => ({ ...prev, [exerciseId]: next }));
    startDoneTransition(() => {
      void toggleExerciseCompletion(exerciseId, next);
    });
  }

  const openExercise = openExerciseId
    ? workout.exercises.find((ex) => ex.id === openExerciseId)
    : undefined;

  return (
    <>
      {!workout.editable && (
        <p className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          אימון משבוע ישן — לצפייה בלבד
        </p>
      )}

      {entry.pendingCount > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <span className="text-warning-foreground">
            {entry.pendingCount === 1 ? "סט אחד ממתין לשמירה" : `${entry.pendingCount} סטים ממתינים לשמירה`} —
            יישלחו כשהחיבור יחזור
          </span>
          <button
            type="button"
            onClick={() => void entry.flushPending()}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            נסה שוב
          </button>
        </div>
      )}

      <div className="space-y-2.5">
        {workout.exercises.map((ex) => {
          const done = isDone(ex);
          const total = entry.indexesFor(ex).length;
          const loggedCount = entry.loggedCountFor(ex);
          return (
            <Card
              key={ex.id}
              role="button"
              tabIndex={0}
              onClick={() => setOpenExerciseId(ex.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpenExerciseId(ex.id);
                }
              }}
              className={cn(
                "cursor-pointer transition-shadow hover:shadow-sm",
                done && "border-success/40 bg-success/5",
              )}
            >
              <CardContent className="flex items-center gap-3 p-4">
                <ExerciseThumbnail
                  src={getExerciseImage({
                    name: ex.name,
                    muscle_group: ex.muscleGroup,
                    media_url: ex.imageUrl,
                  })}
                  className="h-12 w-12 rounded-lg bg-primary/10"
                />
                <div
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2",
                    done ? "border-success bg-success text-success-foreground" : "border-border text-transparent",
                  )}
                >
                  <Check className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium">{ex.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {summarizeSets(ex.plannedSets)}
                  </p>
                  {ex.jump && (
                    <p className="flex items-center gap-1 truncate text-xs font-medium text-success">
                      <ArrowUp className="h-3 w-3 shrink-0" />
                      {ex.jump}
                    </p>
                  )}
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                    loggedCount === total && total > 0
                      ? "bg-success/15 text-success"
                      : "bg-secondary text-secondary-foreground",
                  )}
                >
                  {loggedCount}/{total}
                </span>
                <ChevronLeft className="h-5 w-5 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <SubmitWorkoutButton
        workoutId={workout.id}
        submitted={workout.submitted}
        disabled={!workout.editable}
        getNotes={() => entry.getNotes().map((n) => ({ workoutExerciseId: n.exerciseId, notes: n.notes }))}
        flushPending={entry.flushPending}
        onSubmitted={entry.markNotesSaved}
      />

      {openExercise && (
        <TraineeExerciseModal
          exercise={openExercise}
          entry={entry}
          done={isDone(openExercise)}
          editable={workout.editable}
          onToggleDone={(next) => toggleDone(openExercise.id, next)}
          onClose={() => setOpenExerciseId(null)}
          onToast={toast.show}
        />
      )}

      <Toast message={toast.message} />
    </>
  );
}
