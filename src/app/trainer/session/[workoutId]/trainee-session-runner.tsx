"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Minus, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { Toast, useToast } from "@/components/toast";
import { SessionFrame } from "@/components/session/session-frame";
import {
  SessionExercisePanel,
  type SessionExerciseData,
} from "@/components/session/session-exercise-panel";
import { formatLoggedSet, formatSetTarget } from "@/lib/sets";
import { useSetEntry, type SetEntryApi } from "@/lib/use-set-entry";
import { clearWorkoutDraft, draftKeys } from "@/lib/workout-draft";
import { finishTraineeSession, logSetForTrainee, unlogSetForTrainee } from "../actions";

/** The trainer's Server Actions behind the shared set-entry state machine. */
const TRAINER_SET_API: SetEntryApi = { log: logSetForTrainee, unlog: unlogSetForTrainee };

/**
 * A trainer-led session with a trainee: one exercise on screen at a time,
 * the trainer moves between them by hand (chips, previous/next) and enters
 * weight and reps for each set as it happens. Every ✓ saves that set under
 * the trainee's name right away; "סיים אימון" then marks the workout as
 * submitted. No timers, nothing advances on its own.
 */
export function TraineeSessionRunner({
  workoutId,
  traineeId,
  traineeName,
  workoutLabel,
  programTitle,
  weekLabel,
  isDraft,
  alreadySubmitted,
  initialGeneralNote,
  exercises,
}: {
  workoutId: string;
  traineeId: string;
  traineeName: string;
  workoutLabel: string;
  programTitle: string;
  weekLabel: string;
  /** Opened by direct link on a program that isn't published (the picker publishes first). */
  isDraft: boolean;
  alreadySubmitted: { bySelf: boolean } | null;
  initialGeneralNote: string;
  exercises: SessionExerciseData[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [activeIndex, setActiveIndex] = useState(() => {
    const firstOpen = exercises.findIndex((ex) => ex.loggedSets.length < ex.plannedSets.length);
    return firstOpen === -1 ? 0 : firstOpen;
  });
  const [finishing, setFinishing] = useState(false);
  const [generalNote, setGeneralNote] = useState(initialGeneralNote);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const entry = useSetEntry({
    storageKey: draftKeys.trainerSession(workoutId),
    exercises,
    api: TRAINER_SET_API,
    onToast: toast.show,
  });

  const active = exercises[Math.min(activeIndex, exercises.length - 1)];

  // ---- what the finish dialog reports
  let setsLogged = 0;
  let setsTotal = 0;
  const short: string[] = [];
  const missing: string[] = [];
  for (const ex of exercises) {
    for (const i of entry.indexesFor(ex)) {
      const planned = entry.plannedFor(ex, i);
      const state = entry.stateFor(ex, i);
      const log = entry.logged[ex.id]?.[i];
      if (planned || log) setsTotal += 1;
      if (log) {
        setsLogged += 1;
        if (state === "logged-short" && planned) {
          short.push(`${ex.name} סט ${i}: ${formatLoggedSet(log)} (יעד ${formatSetTarget(planned)})`);
        }
      } else if (planned) {
        missing.push(`${ex.name} סט ${i}`);
      }
    }
  }

  function handleFinish() {
    setFinishError(null);
    startTransition(async () => {
      const stillPending = await entry.flushPending();
      if (stillPending > 0) {
        setFinishError("יש סטים שעדיין לא נשמרו (אין חיבור). נסו שוב כשהחיבור יחזור.");
        return;
      }
      try {
        const result = await finishTraineeSession(workoutId, {
          notes: entry.getNotes().map((n) => ({ workoutExerciseId: n.exerciseId, notes: n.notes })),
          generalNote: generalNote.trim() || null,
        });
        if (result.error) {
          setFinishError(result.error);
          return;
        }
        clearWorkoutDraft(draftKeys.trainerSession(workoutId));
        router.push(`/trainer/trainees/${traineeId}`);
      } catch {
        setFinishError("אין חיבור — נסו שוב בעוד רגע");
      }
    });
  }

  return (
    <>
      <SessionFrame
        backHref={`/trainer/trainees/${traineeId}`}
        title={`${traineeName} · ${workoutLabel}`}
        subtitle={`אימון אישי · ${programTitle} · ${weekLabel}`}
        chips={exercises.map((ex) => {
          const indexes = entry.indexesFor(ex);
          return {
            id: ex.id,
            label: ex.name,
            done: indexes.length > 0 && entry.loggedCountFor(ex) === indexes.length,
          };
        })}
        activeIndex={activeIndex}
        onSelect={setActiveIndex}
        setsLogged={setsLogged}
        setsTotal={setsTotal}
        pendingCount={entry.pendingCount}
        onRetryPending={() => void entry.flushPending()}
        onFinish={() => setFinishing(true)}
      >
        {isDraft && (
          <p className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
            התוכנית הזו עדיין בטיוטה, ולכן המתאמן לא יראה את האימון עד שהיא תפורסם.
          </p>
        )}
        {alreadySubmitted && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            {alreadySubmitted.bySelf
              ? "המתאמן כבר הגיש את האימון הזה. אפשר לתקן ולהשלים — ההגשה שלו נשארת."
              : "האימון הזה כבר הסתיים. אפשר לתקן ולהשלים."}
          </p>
        )}
        {active ? (
          <SessionExercisePanel key={active.id} exercise={active} entry={entry} />
        ) : (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            אין תרגילים באימון הזה.
          </p>
        )}
      </SessionFrame>

      <Modal open={finishing} onClose={() => setFinishing(false)} title={`סיום אימון: ${traineeName}`}>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-success/10 p-2">
              <p className="text-xl font-bold text-success">{setsLogged}</p>
              <p className="text-xs text-muted-foreground">סטים בוצעו</p>
            </div>
            <div className="rounded-lg bg-warning/15 p-2">
              <p className="text-xl font-bold text-warning-foreground">{short.length}</p>
              <p className="text-xs text-muted-foreground">פחות מהיעד</p>
            </div>
            <div className="rounded-lg bg-muted p-2">
              <p className="text-xl font-bold">{missing.length}</p>
              <p className="text-xs text-muted-foreground">לא בוצעו</p>
            </div>
          </div>

          {(short.length > 0 || missing.length > 0) && (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {short.map((line) => (
                <li key={line} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-foreground" />
                  <span>{line}</span>
                </li>
              ))}
              {missing.map((line) => (
                <li key={line} className="flex items-start gap-1.5 text-muted-foreground">
                  <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{line}: לא בוצע</span>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-1">
            <Label htmlFor="session-general-note">הערה כללית לאימון</Label>
            <Textarea
              id="session-general-note"
              value={generalNote}
              maxLength={2000}
              onChange={(e) => setGeneralNote(e.target.value)}
              className="min-h-16"
            />
          </div>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" />
            האימון יישמר בהיסטוריה של {traineeName} כאימון אישי עם המאמן.
          </p>

          {finishError && <p className="text-sm text-destructive">{finishError}</p>}

          <Button type="button" size="lg" className="w-full" onClick={handleFinish} disabled={pending}>
            {pending ? "שומר…" : "שמור וסיים"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            אפשר לסיים גם אם לא כל הסטים בוצעו — הם יופיעו כ&quot;לא בוצע&quot;.
          </p>
        </div>
      </Modal>

      <Toast message={toast.message} />
    </>
  );
}
