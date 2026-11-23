"use client";

import { useState } from "react";
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
import { completeWorkoutAsPlanned, logSet, markExerciseDone, unlogSet, unmarkExerciseDone } from "./actions";
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
                      : "bg-secondary text-secondary-foreground hover:bg-hover",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        <Link
          href="/trainee/history"
          className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-hover hover:text-foreground"
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
 * submit buttons. All of the per-set entry state — what's saved, what's
 * typed but not saved, what's waiting for a connection — is useSetEntry's
 * (src/lib/use-set-entry.ts, in autoSave mode: rows save themselves); this
 * component adds the exercise "done" marks — which fill every untouched
 * set with its target in one request — and "the whole workout as planned".
 */
function WorkoutPanel({ workout }: { workout: WorkoutData }) {
  const toast = useToast();

  // The server's "done" marks, plus whatever this screen changed since.
  const [doneOverrides, setDoneOverrides] = useState<Record<string, boolean>>({});
  const isDone = (ex: ExerciseData) => doneOverrides[ex.id] ?? ex.done;
  const [doneBusy, setDoneBusy] = useState<Record<string, boolean>>({});
  const setDone = (exerciseId: string, value: boolean) =>
    setDoneOverrides((prev) => ({ ...prev, [exerciseId]: value }));

  const entry = useSetEntry({
    storageKey: draftKeys.trainee(workout.id),
    exercises: workout.exercises,
    api: TRAINEE_SET_API,
    editable: workout.editable,
    autoSave: true,
    onToast: toast.show,
    onExerciseDone: (exerciseId) => setDoneOverrides((prev) => ({ ...prev, [exerciseId]: true })),
  });

  const [openExerciseId, setOpenExerciseId] = useState<string | null>(null);

  /**
   * "סמן כבוצע": every set that isn't saved yet goes in as typed, or as its
   * target where nothing was typed — one request — and the exercise is
   * marked done. Taking it back removes the mark and the sets that are
   * exactly the target (what "done" filled in); sets typed differently stay.
   */
  async function toggleDone(exercise: ExerciseData, next: boolean) {
    if (doneBusy[exercise.id]) return;
    setDoneBusy((prev) => ({ ...prev, [exercise.id]: true }));
    setDone(exercise.id, next);
    try {
      if (next) {
        const fills = entry.fillsFor(exercise);
        const indexes = fills.map((f) => f.setIndex);
        entry.markSaving(exercise.id, indexes, true);
        try {
          const result = await markExerciseDone(
            exercise.id,
            fills.map((f) => ({ setIndex: f.setIndex, input: f.values })),
          );
          if (result.error) {
            setDone(exercise.id, false);
            entry.setError(exercise.id, result.error);
            return;
          }
          entry.applyLogs(exercise.id, result.logs ?? []);
          toast.show("סומן כבוצע ✓");
        } catch {
          // No reception: the sets wait in the draft and are sent one by one
          // when it's back — the server marks the exercise done by itself
          // once every working set is in.
          entry.keepAsPending(exercise.id, fills);
          toast.show("אין חיבור — יישמר כשהחיבור יחזור");
        } finally {
          entry.markSaving(exercise.id, indexes, false);
        }
      } else {
        const indexes = entry.autoFilledIndexes(exercise);
        try {
          const result = await unmarkExerciseDone(exercise.id, indexes);
          if (result.error) {
            setDone(exercise.id, true);
            entry.setError(exercise.id, result.error);
            return;
          }
          entry.applyUnlogs(exercise.id, indexes);
          toast.show("הסימון בוטל");
        } catch {
          setDone(exercise.id, true);
          toast.show("אין חיבור — אי אפשר לבטל את הסימון כרגע");
        }
      }
    } finally {
      setDoneBusy((prev) => ({ ...prev, [exercise.id]: false }));
    }
  }

  /** "הכל בוצע כמתוכנן": every exercise, as typed or as its target, done and submitted — one request. */
  async function completeAsPlanned(): Promise<{ error?: string }> {
    const perExercise = workout.exercises.map((ex) => ({ ex, fills: entry.fillsFor(ex) }));
    for (const { ex, fills } of perExercise) entry.markSaving(ex.id, fills.map((f) => f.setIndex), true);
    try {
      const notes = entry.getNotes().map((n) => ({ workoutExerciseId: n.exerciseId, notes: n.notes }));
      const result = await completeWorkoutAsPlanned(
        workout.id,
        perExercise.flatMap(({ ex, fills }) =>
          fills.map((f) => ({ workoutExerciseId: ex.id, setIndex: f.setIndex, input: f.values })),
        ),
        notes,
      );
      if (result.error) return { error: result.error };
      for (const { ex } of perExercise) {
        entry.applyLogs(ex.id, result.logs?.[ex.id] ?? []);
        setDone(ex.id, true);
      }
      entry.markNotesSaved();
      return {};
    } catch {
      return { error: "אין חיבור — נסו שוב בעוד רגע" };
    } finally {
      for (const { ex, fills } of perExercise) entry.markSaving(ex.id, fills.map((f) => f.setIndex), false);
    }
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
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium hover:bg-hover"
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
                  className="h-12 w-12 rounded-lg bg-primary-tint"
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
        onCompleteAsPlanned={completeAsPlanned}
      />

      {openExercise && (
        <TraineeExerciseModal
          exercise={openExercise}
          entry={entry}
          done={isDone(openExercise)}
          doneBusy={!!doneBusy[openExercise.id]}
          editable={workout.editable}
          onToggleDone={(next) => void toggleDone(openExercise, next)}
          onClose={() => {
            // Whatever was just typed starts saving now, not in a second —
            // closing the exercise is often followed by leaving the page.
            entry.saveNow();
            setOpenExerciseId(null);
          }}
        />
      )}

      <Toast message={toast.message} />
    </>
  );
}
