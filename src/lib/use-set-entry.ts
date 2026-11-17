"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useDeferredSync } from "@/lib/use-deferred-sync";
import {
  formatKg,
  isSetTargetMet,
  parseLoggedNumber,
  type LoggedSet,
  type PlannedSet,
} from "@/lib/sets";
import {
  EMPTY_EXERCISE_DRAFT,
  EMPTY_SET_DRAFT,
  loadWorkoutDraft,
  saveWorkoutDraft,
  type ExerciseDraft,
  type SetDraft,
  type WorkoutDraft,
} from "@/lib/workout-draft";

/**
 * The state machine behind every screen where sets are entered one at a
 * time: the trainee's own workout, the trainer-led session and the free
 * session. One rule everywhere:
 *
 *   what's on screen = the server's copy + whatever hasn't been saved yet
 *
 * - `logged` mirrors the server (updated optimistically when a save comes
 *   back, and re-synced whenever the page's server data changes — including
 *   when someone ELSE logged the same workout meanwhile).
 * - the draft (localStorage, src/lib/workout-draft.ts) holds only unsaved
 *   edits and saves that couldn't reach the server. An entry is dropped the
 *   moment it's saved — or when the server's copy of that set has changed
 *   underneath it, so a stale phone never overwrites newer numbers.
 *
 * The save itself returns as soon as the set is written, without reloading
 * the page's data (that reload used to make every ✓ slow, and the next ✓
 * wait behind it). The server copy is refreshed once, shortly after the
 * last ✓ of a burst — see scheduleSync below and src/app/sync-actions.ts.
 *
 * Confirming a set (✓) saves it right away; with no reception it's kept as
 * `pending` and retried on mount, when the browser comes back online, when
 * the tab becomes visible again, and before the workout is submitted.
 */

export interface SetEntryExercise {
  /** workout_exercises.id, or free_session_exercises.id. */
  id: string;
  plannedSets: PlannedSet[];
  loggedSets: LoggedSet[];
  initialNote: string | null;
}

export interface SetLogValues {
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
}

export interface SetEntryApi {
  log(
    exerciseId: string,
    setIndex: number,
    values: SetLogValues,
  ): Promise<{ error?: string; log?: LoggedSet; exerciseDone?: boolean }>;
  unlog(exerciseId: string, setIndex: number): Promise<{ error?: string }>;
}

export type SetRowState = "logged" | "logged-short" | "pending" | "changed" | "open";

type LoggedMap = Record<string, Record<number, LoggedSet>>;

// ---------------------------------------------------------------------------
// The draft as an external store: localStorage, with an in-memory copy in
// front of it so typing still works when storage is unavailable (private
// browsing, quota). useSyncExternalStore keeps hydration honest: the server
// (and the first client render) see "no draft", then the real one appears.
// ---------------------------------------------------------------------------

const memory = new Map<string, WorkoutDraft>();
const listeners = new Map<string, Set<() => void>>();

function readDraft(key: string): WorkoutDraft {
  let draft = memory.get(key);
  if (!draft) {
    draft = loadWorkoutDraft(key);
    memory.set(key, draft);
  }
  return draft;
}

function writeDraft(key: string, draft: WorkoutDraft) {
  memory.set(key, draft);
  saveWorkoutDraft(key, draft);
  listeners.get(key)?.forEach((notify) => notify());
}

function subscribeDraft(key: string, notify: () => void) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(notify);
  // Another tab of the same browser edited the same workout.
  function onStorage(event: StorageEvent) {
    if (event.key === key) {
      memory.delete(key);
      notify();
    }
  }
  window.addEventListener("storage", onStorage);
  return () => {
    set.delete(notify);
    window.removeEventListener("storage", onStorage);
  };
}

const NO_DRAFT: WorkoutDraft = {};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function fromLog(log: LoggedSet): SetDraft {
  return {
    weight: log.weightKg != null ? formatKg(log.weightKg) : "",
    reps: log.reps != null ? String(log.reps) : "",
    rpe: log.rpe != null ? String(log.rpe) : "",
  };
}

function toLoggedMap(exercises: SetEntryExercise[]): LoggedMap {
  return Object.fromEntries(
    exercises.map((ex) => [ex.id, Object.fromEntries(ex.loggedSets.map((l) => [l.setIndex, l]))]),
  );
}

function versionOf(exercises: SetEntryExercise[]): string {
  return exercises
    .map((ex) => `${ex.id}:${ex.loggedSets.map((l) => `${l.setIndex}@${l.loggedAt}`).join(",")}`)
    .join("|");
}

const keyOf = (exerciseId: string, setIndex: number) => `${exerciseId}:${setIndex}`;

/**
 * Drops draft entries the server has since overtaken: an unsaved edit typed
 * over a copy that's no longer the server's, or a pending save older than
 * what the server now holds. Entries being saved right now are left alone.
 */
function reconcile(draft: WorkoutDraft, server: LoggedMap, saving: Set<string>): WorkoutDraft {
  let anyChanged = false;
  const next: WorkoutDraft = {};
  for (const [exerciseId, exDraft] of Object.entries(draft)) {
    const serverSets = server[exerciseId];
    if (!serverSets) {
      next[exerciseId] = exDraft;
      continue;
    }
    let changed = false;
    const sets: Record<number, SetDraft> = {};
    for (const [index, entry] of Object.entries(exDraft.sets)) {
      const i = Number(index);
      const log = serverSets[i];
      let keep = true;
      if (!saving.has(keyOf(exerciseId, i)) && log) {
        keep =
          entry.status === "pending"
            ? Date.parse(log.loggedAt) <= (entry.at ?? 0)
            : (entry.basedOn ?? null) === log.loggedAt;
      }
      if (keep) sets[i] = entry;
      else changed = true;
    }
    next[exerciseId] = changed ? { ...exDraft, sets } : exDraft;
    anyChanged = anyChanged || changed;
  }
  return anyChanged ? next : draft;
}

function sameAsLog(values: SetLogValues, log: LoggedSet): boolean {
  return values.reps === log.reps && values.weightKg === log.weightKg && values.rpe === log.rpe;
}

/** How long after the last confirmed / un-confirmed set the page's server copy is refreshed. */
const SYNC_DELAY_MS = 2500;

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export function useSetEntry({
  storageKey,
  exercises,
  api,
  editable = true,
  openEnded = false,
  onToast,
  onExerciseDone,
}: {
  storageKey: string;
  exercises: SetEntryExercise[];
  api: SetEntryApi;
  /** False = view only (a locked week): nothing can be changed. */
  editable?: boolean;
  /**
   * Free sessions. An exercise with nothing planned always keeps one open
   * row after its last logged set, and a row beyond the plan that's left
   * empty means "same as the previous set".
   */
  openEnded?: boolean;
  onToast?: (message: string) => void;
  onExerciseDone?: (exerciseId: string) => void;
}) {
  const router = useRouter();

  // ---- server copy
  const [logged, setLogged] = useState<LoggedMap>(() => toLoggedMap(exercises));
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const serverVersion = versionOf(exercises);
  const [syncedVersion, setSyncedVersion] = useState(serverVersion);
  if (serverVersion !== syncedVersion) {
    // The page's server data changed (our own save revalidated it, the tab
    // was refreshed on focus, an exercise was added). The server wins for
    // every set that isn't mid-save right now.
    setSyncedVersion(serverVersion);
    const server = toLoggedMap(exercises);
    setLogged((prev) => {
      const next: LoggedMap = {};
      for (const ex of exercises) {
        const merged = { ...server[ex.id] };
        for (const key of saving) {
          const [exerciseId, index] = key.split(":");
          if (exerciseId !== ex.id) continue;
          const i = Number(index);
          const local = prev[ex.id]?.[i];
          if (local) merged[i] = local;
          else delete merged[i];
        }
        next[ex.id] = merged;
      }
      return next;
    });
  }

  // ---- unsaved copy
  const subscribe = useCallback((notify: () => void) => subscribeDraft(storageKey, notify), [storageKey]);
  const storedDraft = useSyncExternalStore(
    subscribe,
    () => readDraft(storageKey),
    () => NO_DRAFT,
  );
  const draft = useMemo(() => reconcile(storedDraft, logged, saving), [storedDraft, logged, saving]);

  const [errors, setErrors] = useState<Record<string, string | null>>({});

  // Fresh values for code that runs after an await.
  const latest = useRef({ logged, saving, exercises });
  useEffect(() => {
    latest.current = { logged, saving, exercises };
  });

  /** Read-modify-write straight against the store, so it's never working from a stale render. */
  const commit = useCallback(
    (update: (current: WorkoutDraft) => WorkoutDraft) => {
      const current = reconcile(readDraft(storageKey), latest.current.logged, latest.current.saving);
      writeDraft(storageKey, update(current));
    },
    [storageKey],
  );

  const updateExerciseDraft = useCallback(
    (exerciseId: string, update: (current: ExerciseDraft) => ExerciseDraft) => {
      commit((current) => ({ ...current, [exerciseId]: update(current[exerciseId] ?? EMPTY_EXERCISE_DRAFT) }));
    },
    [commit],
  );

  const setEntry = useCallback(
    (exerciseId: string, setIndex: number, entry: SetDraft | null) => {
      updateExerciseDraft(exerciseId, (ex) => {
        const sets = { ...ex.sets };
        if (entry) sets[setIndex] = entry;
        else delete sets[setIndex];
        return { ...ex, sets };
      });
    },
    [updateExerciseDraft],
  );

  /** State + the `latest` mirror together, so code after an await sees its own changes at once. */
  function applySaving(update: (prev: Set<string>) => Set<string>) {
    latest.current = { ...latest.current, saving: update(latest.current.saving) };
    setSaving(update);
  }

  function applyLogged(update: (prev: LoggedMap) => LoggedMap) {
    latest.current = { ...latest.current, logged: update(latest.current.logged) };
    setLogged(update);
  }

  function setSavingFlag(key: string, on: boolean) {
    applySaving((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function setError(exerciseId: string, message: string | null) {
    setErrors((prev) => (prev[exerciseId] === message ? prev : { ...prev, [exerciseId]: message }));
  }

  // ---- catching up with the server after saves
  // Saving a set doesn't reload the page's data. Once things have been quiet
  // for a moment, one request does what every save used to do: brings this
  // page's fresh server copy (in a training block, next week's targets may
  // have changed) and marks every other visited page to be re-fetched.
  const scheduleSync = useDeferredSync(SYNC_DELAY_MS, () => latest.current.saving.size > 0);

  // ---- reading

  function valuesFor(exerciseId: string, setIndex: number): SetDraft {
    const entry = draft[exerciseId]?.sets[setIndex];
    if (entry) return entry;
    const log = logged[exerciseId]?.[setIndex];
    return log ? fromLog(log) : EMPTY_SET_DRAFT;
  }

  function plannedFor(exercise: SetEntryExercise, setIndex: number): PlannedSet | undefined {
    return exercise.plannedSets.find((s) => s.setIndex === setIndex);
  }

  /** What an empty field stands for: the plan, or (open-ended) the previous set. */
  function fallbackFor(
    exercise: SetEntryExercise,
    setIndex: number,
    loggedMap: LoggedMap,
  ): { weightKg: number | null; reps: number | null } {
    const planned = plannedFor(exercise, setIndex);
    if (planned) return { weightKg: planned.weightKg, reps: planned.repsMin };
    if (openEnded) {
      const previous = loggedMap[exercise.id]?.[setIndex - 1];
      if (previous) return { weightKg: previous.weightKg, reps: previous.reps };
    }
    return { weightKg: null, reps: null };
  }

  function placeholderFor(exercise: SetEntryExercise, setIndex: number): { weight: string; reps: string; rpe: string } {
    const fallback = fallbackFor(exercise, setIndex, logged);
    const planned = plannedFor(exercise, setIndex);
    return {
      weight: fallback.weightKg != null ? formatKg(fallback.weightKg) : "—",
      reps: fallback.reps != null ? String(fallback.reps) : "",
      rpe: planned?.rpe != null ? String(planned.rpe) : "",
    };
  }

  function indexesFor(exercise: SetEntryExercise): number[] {
    const planned = exercise.plannedSets.map((s) => s.setIndex);
    const maxPlanned = planned.length ? Math.max(...planned) : 0;
    const loggedIndexes = Object.keys(logged[exercise.id] ?? {}).map(Number);
    const draftIndexes = Object.keys(draft[exercise.id]?.sets ?? {}).map(Number);
    let maxIndex = Math.max(maxPlanned + (draft[exercise.id]?.extraSets ?? 0), ...loggedIndexes, ...draftIndexes, 0);
    if (openEnded && planned.length === 0) {
      const lastDone = Math.max(
        ...loggedIndexes,
        ...draftIndexes.filter((i) => draft[exercise.id]?.sets[i]?.status === "pending"),
        0,
      );
      maxIndex = Math.max(maxIndex, lastDone + 1);
    }
    const indexes = [...planned];
    for (let i = maxPlanned + 1; i <= maxIndex; i += 1) indexes.push(i);
    return indexes;
  }

  function parseValues(exercise: SetEntryExercise, setIndex: number): { values: SetLogValues } | { error: string } {
    const entry = reconcile(readDraft(storageKey), latest.current.logged, latest.current.saving)[exercise.id]?.sets[setIndex];
    const log = latest.current.logged[exercise.id]?.[setIndex];
    const shown = entry ?? (log ? fromLog(log) : EMPTY_SET_DRAFT);
    const fallback = fallbackFor(exercise, setIndex, latest.current.logged);
    // An empty field means the placeholder the user was looking at.
    const weightText = shown.weight.trim() || (fallback.weightKg != null ? String(fallback.weightKg) : "");
    const repsText = shown.reps.trim() || (fallback.reps != null ? String(fallback.reps) : "");
    const weight = parseLoggedNumber(weightText, "weight");
    const reps = parseLoggedNumber(repsText, "reps");
    const rpe = parseLoggedNumber(shown.rpe, "rpe");
    if ("error" in weight) return { error: weight.error };
    if ("error" in reps) return { error: reps.error };
    if ("error" in rpe) return { error: rpe.error };
    if (reps.value == null) return { error: "יש למלא מספר חזרות" };
    return { values: { weightKg: weight.value, reps: reps.value, rpe: rpe.value } };
  }

  function stateFor(exercise: SetEntryExercise, setIndex: number): SetRowState {
    const entry = draft[exercise.id]?.sets[setIndex];
    const log = logged[exercise.id]?.[setIndex];
    if (entry?.status === "pending") return "pending";
    if (log) {
      if (entry) return "changed";
      return isSetTargetMet(plannedFor(exercise, setIndex), log) ? "logged" : "logged-short";
    }
    return "open";
  }

  function loggedCountFor(exercise: SetEntryExercise): number {
    return indexesFor(exercise).filter(
      (i) => logged[exercise.id]?.[i] || draft[exercise.id]?.sets[i]?.status === "pending",
    ).length;
  }

  // ---- writing

  function changeSet(exerciseId: string, setIndex: number, patch: Partial<Pick<SetDraft, "weight" | "reps" | "rpe">>) {
    if (!editable) return;
    const log = latest.current.logged[exerciseId]?.[setIndex];
    updateExerciseDraft(exerciseId, (ex) => {
      const current = ex.sets[setIndex];
      const base: SetDraft = current ?? (log ? { ...fromLog(log), basedOn: log.loggedAt } : { ...EMPTY_SET_DRAFT, basedOn: null });
      const next: SetDraft = { ...base, ...patch };
      if (next.status === "pending") next.at = Date.now();
      const sets = { ...ex.sets };
      // Back to exactly what's saved (or to nothing at all) = no unsaved edit.
      const untouched = log
        ? next.status !== "pending" &&
          next.weight.trim() === fromLog(log).weight &&
          next.reps.trim() === fromLog(log).reps &&
          next.rpe.trim() === fromLog(log).rpe
        : !next.status && !next.weight.trim() && !next.reps.trim() && !next.rpe.trim();
      if (untouched) delete sets[setIndex];
      else sets[setIndex] = next;
      return { ...ex, sets };
    });
  }

  /** The − / + buttons of the session screens. */
  function stepSet(exercise: SetEntryExercise, setIndex: number, field: "weight" | "reps", delta: number) {
    const shown = valuesFor(exercise.id, setIndex);
    const fallback = fallbackFor(exercise, setIndex, logged);
    const text = shown[field].trim().replace(",", ".");
    const current = text && Number.isFinite(Number(text)) ? Number(text) : ((field === "weight" ? fallback.weightKg : fallback.reps) ?? 0);
    const next = Math.max(0, Math.round((current + delta) * 100) / 100);
    changeSet(exercise.id, setIndex, { [field]: field === "weight" ? formatKg(next) : String(Math.round(next)) });
  }

  /** Sends one set. Resolves false only when the server couldn't be reached (the set is kept as pending). */
  async function sendSet(exercise: SetEntryExercise, setIndex: number, values: SetLogValues, quiet = false): Promise<boolean> {
    const key = keyOf(exercise.id, setIndex);
    setSavingFlag(key, true);
    try {
      const result = await api.log(exercise.id, setIndex, values);
      if (result.error || !result.log) {
        // The server answered "no" (validation, locked week, the workout
        // changed) — retrying won't help. Keep what was typed, not pending.
        setError(exercise.id, result.error ?? "שגיאה בשמירת הסט");
        updateExerciseDraft(exercise.id, (ex) => {
          const current = ex.sets[setIndex];
          if (!current?.status) return ex;
          return { ...ex, sets: { ...ex.sets, [setIndex]: { ...current, status: undefined, at: undefined } } };
        });
        return true;
      }
      const log = result.log;
      applyLogged((prev) => ({ ...prev, [exercise.id]: { ...prev[exercise.id], [setIndex]: log } }));
      updateExerciseDraft(exercise.id, (ex) => {
        const sets = { ...ex.sets };
        delete sets[setIndex];
        // An extra row the user opened is accounted for by the saved set
        // itself from here on; keep counting only rows opened beyond it.
        const maxPlanned = Math.max(0, ...exercise.plannedSets.map((s) => s.setIndex));
        const extraSets = setIndex >= maxPlanned + ex.extraSets ? 0 : ex.extraSets;
        return { ...ex, sets, extraSets };
      });
      setError(exercise.id, null);
      scheduleSync();
      if (result.exerciseDone) onExerciseDone?.(exercise.id);
      if (!quiet) onToast?.(`סט ${setIndex} נשמר ✓`);
      return true;
    } catch {
      // A thrown server action = no answer at all (no reception, server
      // unreachable), unlike result.error above. Keep it and retry later.
      const log = latest.current.logged[exercise.id]?.[setIndex];
      setEntry(exercise.id, setIndex, {
        weight: values.weightKg != null ? formatKg(values.weightKg) : "",
        reps: values.reps != null ? String(values.reps) : "",
        rpe: values.rpe != null ? String(values.rpe) : "",
        status: "pending",
        at: Date.now(),
        basedOn: log?.loggedAt ?? null,
      });
      if (!quiet) onToast?.("אין חיבור — הסט יישמר כשהחיבור יחזור");
      return false;
    } finally {
      setSavingFlag(key, false);
    }
  }

  async function sendUnlog(exercise: SetEntryExercise, setIndex: number) {
    const key = keyOf(exercise.id, setIndex);
    const previous = latest.current.logged[exercise.id]?.[setIndex];
    setSavingFlag(key, true);
    try {
      const result = await api.unlog(exercise.id, setIndex);
      if (result.error) {
        setError(exercise.id, result.error);
        return;
      }
      applyLogged((prev) => {
        const sets = { ...prev[exercise.id] };
        delete sets[setIndex];
        return { ...prev, [exercise.id]: sets };
      });
      // Leave the numbers in the fields, unsaved — un-confirming is usually
      // followed by fixing one of them and confirming again.
      if (previous) setEntry(exercise.id, setIndex, { ...fromLog(previous), basedOn: null });
      setError(exercise.id, null);
      scheduleSync();
    } catch {
      onToast?.("אין חיבור — אי אפשר לבטל את הסט כרגע");
    } finally {
      setSavingFlag(key, false);
    }
  }

  function confirmSet(exercise: SetEntryExercise, setIndex: number) {
    if (!editable || latest.current.saving.has(keyOf(exercise.id, setIndex))) return;
    const entry = draft[exercise.id]?.sets[setIndex];
    const log = logged[exercise.id]?.[setIndex];

    // A second tap on a saved, untouched set un-confirms it.
    if (log && !entry) {
      void sendUnlog(exercise, setIndex);
      return;
    }
    const parsed = parseValues(exercise, setIndex);
    if ("error" in parsed) {
      setError(exercise.id, parsed.error);
      return;
    }
    if (log && entry?.status !== "pending" && sameAsLog(parsed.values, log)) {
      // Typed over a saved set but ended up with the same numbers ("82.50"
      // for 82.5): nothing to save, and certainly nothing to un-confirm.
      setEntry(exercise.id, setIndex, null);
      setError(exercise.id, null);
      return;
    }
    void sendSet(exercise, setIndex, parsed.values);
  }

  /** Retries every pending set. Resolves to how many are still pending. */
  async function flushPending(): Promise<number> {
    let remaining = 0;
    for (const exercise of latest.current.exercises) {
      const sets = reconcile(readDraft(storageKey), latest.current.logged, latest.current.saving)[exercise.id]?.sets ?? {};
      for (const [index, entry] of Object.entries(sets)) {
        if (entry.status !== "pending") continue;
        const setIndex = Number(index);
        const parsed = parseValues(exercise, setIndex);
        if ("error" in parsed) {
          setEntry(exercise.id, setIndex, { ...entry, status: undefined, at: undefined });
          continue;
        }
        if (!(await sendSet(exercise, setIndex, parsed.values, true))) remaining += 1;
      }
    }
    return remaining;
  }

  function addExtraSet(exerciseId: string) {
    if (!editable) return;
    updateExerciseDraft(exerciseId, (ex) => ({ ...ex, extraSets: ex.extraSets + 1 }));
  }

  function noteFor(exercise: SetEntryExercise): string {
    return draft[exercise.id]?.notes ?? exercise.initialNote ?? "";
  }

  function setNote(exerciseId: string, notes: string) {
    if (!editable) return;
    updateExerciseDraft(exerciseId, (ex) => ({ ...ex, notes }));
  }

  /** The note of every exercise as it should be saved (null = none). */
  function getNotes(): { exerciseId: string; notes: string | null }[] {
    const current = readDraft(storageKey);
    return latest.current.exercises.map((ex) => ({
      exerciseId: ex.id,
      notes: (current[ex.id]?.notes ?? ex.initialNote ?? "").trim() || null,
    }));
  }

  /** The notes reached the server: from now on show the server's copy again. */
  function markNotesSaved() {
    commit((current) =>
      Object.fromEntries(Object.entries(current).map(([id, ex]) => [id, { ...ex, notes: undefined }])),
    );
  }

  /** An exercise left the list (free sessions): forget everything typed for it. */
  function forgetExercise(exerciseId: string) {
    commit((current) => {
      const next = { ...current };
      delete next[exerciseId];
      return next;
    });
  }

  const pendingCount = Object.values(draft).reduce(
    (sum, ex) => sum + Object.values(ex.sets).filter((s) => s.status === "pending").length,
    0,
  );

  // ---- background: retry when the connection is back, re-sync when the tab is looked at again
  const lastRefresh = useRef(0);
  const onOnline = useEffectEvent(() => {
    void flushPending();
  });
  const onVisible = useEffectEvent(() => {
    if (document.visibilityState !== "visible") return;
    void flushPending();
    // Someone else may have logged this workout meanwhile (the trainer, in a
    // session; the trainee, on another device). Not on every flicker.
    if (Date.now() - lastRefresh.current > 15_000) {
      lastRefresh.current = Date.now();
      router.refresh();
    }
  });
  // Closing the tab with sets that never reached the server: ask first. They
  // stay in localStorage either way, but they're only retried from here.
  const onBeforeUnload = useEffectEvent((event: BeforeUnloadEvent) => {
    if (pendingCount > 0) event.preventDefault();
  });
  useEffect(() => {
    lastRefresh.current = Date.now();
    onOnline();
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return {
    logged,
    draft,
    errors,
    pendingCount,
    isSaving: (exerciseId: string, setIndex: number) => saving.has(keyOf(exerciseId, setIndex)),
    indexesFor,
    valuesFor,
    placeholderFor,
    plannedFor,
    stateFor,
    loggedCountFor,
    changeSet,
    stepSet,
    confirmSet,
    addExtraSet,
    noteFor,
    setNote,
    getNotes,
    markNotesSaved,
    forgetExercise,
    flushPending,
    setError,
  };
}

export type SetEntry = ReturnType<typeof useSetEntry>;
