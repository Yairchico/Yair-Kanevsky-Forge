"use client";

import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronLeft, History, Lock, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getExerciseImage } from "@/lib/exercise-image";
import { ExerciseThumbnail } from "@/components/exercise-photo";
import { dayName } from "@/lib/week";
import { Toast, useToast } from "@/components/toast";
import { formatKg, parseLoggedNumber, summarizeSets, type LoggedSet } from "@/lib/sets";
import { SubmitWorkoutButton } from "./workout-actions";
import { logSet, toggleExerciseCompletion, unlogSet, type ExerciseNoteEntry } from "./actions";
import { TraineeExerciseModal, setIndexesFor, type TraineeExerciseData } from "./trainee-exercise-modal";
import {
  loadWorkoutDraft,
  saveWorkoutDraft,
  EMPTY_EXERCISE_DRAFT,
  EMPTY_SET_DRAFT,
  type ExerciseDraft,
  type SetDraft,
  type WorkoutDraft,
} from "@/lib/workout-draft";

interface ExerciseData extends TraineeExerciseData {
  done: boolean;
  /** The note from the last submission (workout_logs.notes), if any. */
  initialNote: string | null;
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

type LoggedMap = Record<string, Record<number, LoggedSet>>;

function loggedValuesDraft(log: LoggedSet): SetDraft {
  return {
    weight: log.weightKg != null ? formatKg(log.weightKg) : "",
    reps: log.reps != null ? String(log.reps) : "",
    rpe: log.rpe != null ? String(log.rpe) : "",
  };
}

/**
 * Owns one workout's entry state: what's been saved per set (from the
 * server, then kept current locally), the localStorage draft (typed values
 * not yet confirmed + sets waiting to be retried — src/lib/workout-draft.ts),
 * and each exercise's "done" mark. The list itself is just clickable
 * exercise cards; the per-set entry lives in TraineeExerciseModal.
 *
 * Each set is saved on its own the moment the trainee taps ✓ (logSet). If
 * the request can't reach the server (no reception), the set is kept as
 * `pending` in the draft and retried automatically: when the panel mounts,
 * when the browser reports it's back online, and before "הגש אימון".
 */
function WorkoutPanel({ workout }: { workout: WorkoutData }) {
  const [logged, setLogged] = useState<LoggedMap>(() =>
    Object.fromEntries(
      workout.exercises.map((ex) => [ex.id, Object.fromEntries(ex.loggedSets.map((l) => [l.setIndex, l]))]),
    ),
  );

  const [draft, setDraft] = useState<WorkoutDraft>(() => {
    const stored = loadWorkoutDraft(workout.id);
    const initial: WorkoutDraft = {};
    for (const ex of workout.exercises) {
      const saved = stored[ex.id];
      const sets: Record<number, SetDraft> = {};
      // Server values first, then anything still in the draft on top (an
      // unconfirmed edit or a pending retry is newer than the server's copy).
      for (const log of ex.loggedSets) sets[log.setIndex] = loggedValuesDraft(log);
      for (const [index, value] of Object.entries(saved?.sets ?? {})) {
        const i = Number(index);
        const hasTyped = value.weight.trim() || value.reps.trim() || value.rpe.trim();
        if (value.status || hasTyped) sets[i] = value;
      }
      initial[ex.id] = {
        sets,
        notes: saved?.notes ?? ex.initialNote ?? "",
        extraSets: saved?.extraSets ?? 0,
      };
    }
    return initial;
  });
  const draftRef = useRef(draft);

  const [doneMap, setDoneMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(workout.exercises.map((ex) => [ex.id, ex.done])),
  );
  const [, startDoneTransition] = useTransition();
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [openExerciseId, setOpenExerciseId] = useState<string | null>(null);
  const toast = useToast();

  function commitDraft(update: (prev: WorkoutDraft) => WorkoutDraft) {
    setDraft((prev) => {
      const next = update(prev);
      draftRef.current = next;
      saveWorkoutDraft(workout.id, next);
      return next;
    });
  }

  function updateExercise(exerciseId: string, update: (prev: ExerciseDraft) => ExerciseDraft) {
    commitDraft((prev) => ({ ...prev, [exerciseId]: update(prev[exerciseId] ?? EMPTY_EXERCISE_DRAFT) }));
  }

  function updateSet(exerciseId: string, setIndex: number, next: Partial<SetDraft>) {
    updateExercise(exerciseId, (ex) => ({
      ...ex,
      sets: { ...ex.sets, [setIndex]: { ...(ex.sets[setIndex] ?? EMPTY_SET_DRAFT), ...next } },
    }));
  }

  function setSavingFlag(key: string, on: boolean) {
    setSaving((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function setError(exerciseId: string, message: string | null) {
    setErrors((prev) => ({ ...prev, [exerciseId]: message }));
  }

  /** Sends one set to the server. Returns false if it couldn't be reached (kept as pending). */
  async function sendSet(
    exerciseId: string,
    setIndex: number,
    values: { weightKg: number | null; reps: number | null; rpe: number | null },
    { quiet = false }: { quiet?: boolean } = {},
  ): Promise<boolean> {
    const key = `${exerciseId}:${setIndex}`;
    setSavingFlag(key, true);
    try {
      const result = await logSet(exerciseId, setIndex, values);
      if (result.error || !result.log) {
        // The server answered "no" (validation, locked week, workout
        // changed) — retrying won't help, so drop the pending mark.
        setError(exerciseId, result.error ?? "שגיאה בשמירת הסט");
        updateSet(exerciseId, setIndex, { status: undefined });
        return true;
      }
      const log = result.log;
      setLogged((prev) => ({ ...prev, [exerciseId]: { ...prev[exerciseId], [setIndex]: log } }));
      updateSet(exerciseId, setIndex, { ...loggedValuesDraft(log), status: undefined });
      setError(exerciseId, null);
      if (result.exerciseDone) setDoneMap((prev) => ({ ...prev, [exerciseId]: true }));
      if (!quiet) toast.show(`סט ${setIndex} נשמר ✓`);
      return true;
    } catch {
      // A thrown server action = no answer at all (no reception, server
      // unreachable), unlike result.error above. Keep it and retry later.
      updateSet(exerciseId, setIndex, { status: "pending" });
      if (!quiet) toast.show("אין חיבור — הסט יישמר כשהחיבור יחזור");
      return false;
    } finally {
      setSavingFlag(key, false);
    }
  }

  async function sendUnlog(exerciseId: string, setIndex: number): Promise<boolean> {
    const key = `${exerciseId}:${setIndex}`;
    setSavingFlag(key, true);
    try {
      const result = await unlogSet(exerciseId, setIndex);
      if (result.error) {
        setError(exerciseId, result.error);
        updateSet(exerciseId, setIndex, { status: undefined });
        return true;
      }
      setLogged((prev) => {
        const sets = { ...prev[exerciseId] };
        delete sets[setIndex];
        return { ...prev, [exerciseId]: sets };
      });
      updateSet(exerciseId, setIndex, { status: undefined });
      setError(exerciseId, null);
      return true;
    } catch {
      // Unreachable — hide it as un-confirmed now; the delete is retried later.
      setLogged((prev) => {
        const sets = { ...prev[exerciseId] };
        delete sets[setIndex];
        return { ...prev, [exerciseId]: sets };
      });
      updateSet(exerciseId, setIndex, { status: "pending-delete" });
      return false;
    } finally {
      setSavingFlag(key, false);
    }
  }

  function parseDraftValues(exercise: ExerciseData, setIndex: number) {
    const d = draftRef.current[exercise.id]?.sets[setIndex] ?? EMPTY_SET_DRAFT;
    const planned = exercise.plannedSets.find((s) => s.setIndex === setIndex);
    // An empty field means "as planned" — the placeholder the trainee saw.
    const weightText = d.weight.trim() || (planned?.weightKg != null ? String(planned.weightKg) : "");
    const repsText = d.reps.trim() || (planned?.repsMin != null ? String(planned.repsMin) : "");
    const weight = parseLoggedNumber(weightText, "weight");
    const reps = parseLoggedNumber(repsText, "reps");
    const rpe = parseLoggedNumber(d.rpe, "rpe");
    if ("error" in weight) return { error: weight.error };
    if ("error" in reps) return { error: reps.error };
    if ("error" in rpe) return { error: rpe.error };
    if (reps.value == null) return { error: "יש למלא מספר חזרות" };
    return { values: { weightKg: weight.value, reps: reps.value, rpe: rpe.value } };
  }

  function handleConfirmSet(exercise: ExerciseData, setIndex: number) {
    const current = logged[exercise.id]?.[setIndex];
    const d = draftRef.current[exercise.id]?.sets[setIndex] ?? EMPTY_SET_DRAFT;
    const parsed = parseDraftValues(exercise, setIndex);

    const unchanged =
      current &&
      !("error" in parsed) &&
      parsed.values.reps === current.reps &&
      parsed.values.weightKg === current.weightKg &&
      parsed.values.rpe === current.rpe;

    if (current && unchanged && d.status !== "pending") {
      // Second tap on a saved set = un-confirm it.
      void sendUnlog(exercise.id, setIndex);
      return;
    }
    if ("error" in parsed) {
      setError(exercise.id, parsed.error ?? null);
      return;
    }
    void sendSet(exercise.id, setIndex, parsed.values);
  }

  /** Retries every pending set (and pending un-confirm). Returns how many are still pending. */
  async function flushPending(): Promise<number> {
    let remaining = 0;
    for (const exercise of workout.exercises) {
      const sets = draftRef.current[exercise.id]?.sets ?? {};
      for (const [index, value] of Object.entries(sets)) {
        const setIndex = Number(index);
        if (value.status === "pending") {
          const parsed = parseDraftValues(exercise, setIndex);
          if ("error" in parsed) {
            updateSet(exercise.id, setIndex, { status: undefined });
            continue;
          }
          if (!(await sendSet(exercise.id, setIndex, parsed.values, { quiet: true }))) remaining += 1;
        } else if (value.status === "pending-delete") {
          if (!(await sendUnlog(exercise.id, setIndex))) remaining += 1;
        }
      }
    }
    return remaining;
  }

  const onReconnect = useEffectEvent(() => {
    void flushPending();
  });
  useEffect(() => {
    onReconnect();
    window.addEventListener("online", onReconnect);
    return () => window.removeEventListener("online", onReconnect);
  }, []);

  function toggleDone(exerciseId: string, next: boolean) {
    setDoneMap((prev) => ({ ...prev, [exerciseId]: next }));
    startDoneTransition(() => {
      void toggleExerciseCompletion(exerciseId, next);
    });
  }

  function getNotes(): ExerciseNoteEntry[] {
    return workout.exercises.map((ex) => ({
      workoutExerciseId: ex.id,
      notes: draftRef.current[ex.id]?.notes.trim() || null,
    }));
  }

  const pendingCount = Object.values(draft).reduce(
    (sum, ex) => sum + Object.values(ex.sets).filter((s) => s.status).length,
    0,
  );

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

      {pendingCount > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <span className="text-warning-foreground">
            {pendingCount === 1 ? "סט אחד ממתין לשמירה" : `${pendingCount} סטים ממתינים לשמירה`} — יישלחו כשהחיבור יחזור
          </span>
          <button
            type="button"
            onClick={() => void flushPending()}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            נסה שוב
          </button>
        </div>
      )}

      <div className="space-y-2.5">
        {workout.exercises.map((ex) => {
          const done = doneMap[ex.id] ?? false;
          const exDraft = draft[ex.id] ?? EMPTY_EXERCISE_DRAFT;
          const exLogged = logged[ex.id] ?? {};
          const indexes = setIndexesFor(ex, exLogged, exDraft.extraSets);
          const loggedCount = indexes.filter((i) => exLogged[i]).length;
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
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                    loggedCount === indexes.length && indexes.length > 0
                      ? "bg-success/15 text-success"
                      : "bg-secondary text-secondary-foreground",
                  )}
                >
                  {loggedCount}/{indexes.length}
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
        getNotes={getNotes}
        flushPending={flushPending}
      />

      {openExercise && (
        <TraineeExerciseModal
          exercise={openExercise}
          done={doneMap[openExercise.id] ?? false}
          draft={draft[openExercise.id] ?? EMPTY_EXERCISE_DRAFT}
          logged={logged[openExercise.id] ?? {}}
          savingSetIndexes={
            new Set(
              [...saving]
                .filter((key) => key.startsWith(`${openExercise.id}:`))
                .map((key) => Number(key.split(":")[1])),
            )
          }
          error={errors[openExercise.id] ?? null}
          editable={workout.editable}
          onSetChange={(setIndex, next) => updateSet(openExercise.id, setIndex, next)}
          onConfirmSet={(setIndex) => handleConfirmSet(openExercise, setIndex)}
          onAddExtraSet={() =>
            updateExercise(openExercise.id, (ex) => ({ ...ex, extraSets: ex.extraSets + 1 }))
          }
          onNotesChange={(notes) => updateExercise(openExercise.id, (ex) => ({ ...ex, notes }))}
          onToggleDone={(next) => toggleDone(openExercise.id, next)}
          onClose={() => setOpenExerciseId(null)}
          onToast={toast.show}
        />
      )}

      <Toast message={toast.message} />
    </>
  );
}
