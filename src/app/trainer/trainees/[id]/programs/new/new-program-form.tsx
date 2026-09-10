"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, Eye } from "lucide-react";
import { createProgram, type ActionState } from "../actions";
import { AppShell } from "@/components/app-shell";
import { Brand } from "@/components/brand";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { addDays, dayName, formatWeekLabel, formatWeekRange, getWeekStart, parseDateKey, toDateKey } from "@/lib/week";
import { formatWeight } from "@/lib/format";
import { cn } from "@/lib/utils";

const initialState: ActionState = {};

const today = new Date();
const currentWeekStart = getWeekStart(today);
const weekOptions = [0, 1, 2].map((offset) => {
  const start = addDays(currentWeekStart, offset * 7);
  return {
    key: toDateKey(start),
    label: formatWeekLabel(start, today),
    range: formatWeekRange(start),
  };
});

interface DuplicateExercise {
  id: string;
  name: string;
  sets: number | null;
  reps: string | null;
  weight: string | null;
  rpe: number | null;
  restSeconds: number | null;
  instructions: string | null;
}

interface DuplicateWorkout {
  id: string;
  dayOfWeek: number;
  orderIndex: number;
  exercises: DuplicateExercise[];
}

interface DuplicateCandidate {
  programId: string;
  title: string;
  weekStartDate: string;
  status: "draft" | "published";
  /** Still ongoing (this week's own program) — a valid duplication source too, not just past weeks. */
  isCurrentWeek: boolean;
  workouts: DuplicateWorkout[];
}

/**
 * The preview a trainer must step through before duplicating a program: a
 * centered popup (not an inline accordion) showing one workout (day) at a
 * time, with arrows on the sides to flip between the program's workouts —
 * each exercise shown with its full planned detail (sets/reps/weight/RPE),
 * not just a name. Confirming here is the only way to actually select a
 * candidate — closing/cancelling leaves the previous selection untouched.
 */
function PreviewModal({
  candidate,
  onConfirm,
  onClose,
}: {
  candidate: DuplicateCandidate | null;
  onConfirm: (programId: string) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);

  if (!candidate) return null;
  const workout = candidate.workouts[index];
  const weekStart = parseDateKey(candidate.weekStartDate);

  function go(delta: number) {
    if (!candidate) return;
    setIndex((i) => Math.max(0, Math.min(candidate.workouts.length - 1, i + delta)));
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`תצוגה מקדימה — ${candidate.title}`}
      className="max-w-lg"
    >
      <p className="mb-3 text-sm text-muted-foreground">
        {formatWeekLabel(weekStart)} · {formatWeekRange(weekStart)}
        {candidate.isCurrentWeek && " · השבוע הנוכחי"}
      </p>

      {candidate.workouts.length === 0 ? (
        <p className="py-6 text-center text-base text-muted-foreground">אין אימונים בשבוע זה.</p>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label="האימון הקודם"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1 rounded-lg border border-border p-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-base font-semibold">{dayName(workout.dayOfWeek)}</p>
              <p className="text-sm text-muted-foreground">
                אימון {index + 1} מתוך {candidate.workouts.length}
              </p>
            </div>
            {workout.exercises.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">אין תרגילים.</p>
            ) : (
              <div className="mt-2 divide-y divide-border">
                {workout.exercises.map((ex) => (
                  <div key={ex.id} className="space-y-1 py-2 first:pt-0 last:pb-0">
                    <p className="text-sm font-medium">{ex.name}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                      {ex.sets != null && <span>{ex.sets} סטים</span>}
                      {ex.reps && <span>{ex.reps} חזרות</span>}
                      {formatWeight(ex.weight) && <span>{formatWeight(ex.weight)}</span>}
                      {ex.rpe != null && <span>RPE {ex.rpe}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => go(1)}
            disabled={index === candidate.workouts.length - 1}
            aria-label="האימון הבא"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Button type="button" onClick={() => onConfirm(candidate.programId)} className="flex-1">
          <Check className="h-4 w-4" />
          אשר והמשך
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          בטל
        </Button>
      </div>
    </Modal>
  );
}

/**
 * The confirmation a trainer must clear before creating a program on a
 * week that already has one — the only way to actually get "replace_existing"
 * onto the form submit (see NewProgramForm's handleSubmit); closing/
 * cancelling leaves the existing program untouched.
 */
function ReplaceProgramModal({
  open,
  existingTitle,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  existingTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <Modal open onClose={onCancel} className="max-w-sm">
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <Brand />
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="text-lg font-semibold">כבר קיימת תוכנית לשבוע זה</p>
        <p className="text-base text-muted-foreground">
          &quot;{existingTitle}&quot; — האם אתה בטוח שברצונך ליצור תוכנית חדשה?
        </p>
        <div className="mt-1 flex w-full gap-2">
          <Button type="button" variant="destructive" onClick={onConfirm} className="flex-1">
            המשך ומחק את התוכנית הישנה
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
            בטל
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DuplicateWeekPicker({
  candidates,
  selectedId,
  onSelect,
}: {
  candidates: DuplicateCandidate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [previewCandidate, setPreviewCandidate] = useState<DuplicateCandidate | null>(null);

  if (!candidates.length) {
    return (
      <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
        אין תוכניות שמורות בחודש האחרון לשכפול.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {candidates.map((c) => {
        const weekStart = parseDateKey(c.weekStartDate);
        const isSelected = selectedId === c.programId;
        const totalExercises = c.workouts.reduce((n, w) => n + w.exercises.length, 0);

        return (
          <button
            key={c.programId}
            type="button"
            onClick={() => setPreviewCandidate(c)}
            className={cn(
              "flex w-full items-start justify-between gap-2 rounded-lg border p-3 text-start transition-colors",
              isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
            )}
          >
            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium">
                {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                {c.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatWeekLabel(weekStart)} · {formatWeekRange(weekStart)} ·{" "}
                {c.status === "published" ? "פורסם" : "טיוטה"}
                {c.isCurrentWeek && " · מתרחש כעת"}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-xs text-primary">
              <Eye className="h-3.5 w-3.5" />
              {c.workouts.length} אימונים · {totalExercises} תרגילים
            </span>
          </button>
        );
      })}

      <PreviewModal
        candidate={previewCandidate}
        onClose={() => setPreviewCandidate(null)}
        onConfirm={(programId) => {
          onSelect(programId);
          setPreviewCandidate(null);
        }}
      />
    </div>
  );
}

export function NewProgramForm({
  traineeId,
  traineeName,
  duplicateCandidates,
  existingProgramByWeek,
}: {
  traineeId: string;
  traineeName: string;
  duplicateCandidates: DuplicateCandidate[];
  /** The 3 selectable weeks (this week, +1, +2) that already have a program — keyed by week_start_date. */
  existingProgramByWeek: Record<string, { id: string; title: string }>;
}) {
  const action = createProgram.bind(null, traineeId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [week, setWeek] = useState(weekOptions[0].key);
  const [duplicateEnabled, setDuplicateEnabled] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  const canSubmit = !duplicateEnabled || selectedCandidateId != null;

  // Confirming "כבר קיימת תוכנית לשבוע זה" needs replace_existing on the
  // actual submitted form, but setting state and calling requestSubmit in
  // the same tick would submit before React re-renders the hidden input
  // with the new value — so onConfirm only records which week was
  // confirmed, and this effect (running after that re-render lands) does
  // the real submit.
  const [confirmedReplaceWeek, setConfirmedReplaceWeek] = useState<string | null>(null);
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (confirmedReplaceWeek) formRef.current?.requestSubmit();
  }, [confirmedReplaceWeek]);

  const existingForSelectedWeek = existingProgramByWeek[week];

  function handleSubmit(e: React.FormEvent) {
    if (existingForSelectedWeek && confirmedReplaceWeek !== week) {
      e.preventDefault();
      setShowReplaceModal(true);
    }
  }

  function selectWeek(key: string) {
    setWeek(key);
    setConfirmedReplaceWeek(null);
  }

  return (
    <AppShell title="תוכנית חדשה" backHref={`/trainer/trainees/${traineeId}`}>
      <div className="mx-auto w-full max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>תוכנית חדשה עבור {traineeName}</CardTitle>
            <CardDescription>
              תוכנית תמיד שייכת לשבוע קלנדרי מסוים. תוכל להוסיף אימונים
              ולפרסם כשמוכן — המתאמן לא יראה אותה לפני כן.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="title">שם התוכנית</Label>
                <Input
                  id="title"
                  name="title"
                  required
                  placeholder='למשל: "מחזור כוח - ספטמבר"'
                />
              </div>

              <div className="space-y-1.5">
                <Label>שבוע</Label>
                <input type="hidden" name="week_start_date" value={week} />
                <input
                  type="hidden"
                  name="replace_existing"
                  value={existingForSelectedWeek && confirmedReplaceWeek === week ? "1" : ""}
                />
                <div className="grid gap-2">
                  {weekOptions.map((opt) => {
                    const existingProgram = existingProgramByWeek[opt.key];
                    const isSelected = week === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => selectWeek(opt.key)}
                        className={cn(
                          "flex items-center justify-between rounded-lg border p-3 text-start transition-colors",
                          existingProgram
                            ? isSelected
                              ? "border-destructive bg-destructive/5"
                              : "border-destructive/40 hover:bg-destructive/5"
                            : isSelected
                              ? "border-primary bg-primary/5"
                              : "border-border hover:bg-muted",
                        )}
                      >
                        <span>
                          <span className={cn("font-medium", existingProgram && "text-destructive")}>
                            {opt.label}
                          </span>
                          {existingProgram && (
                            <span className="block text-xs text-destructive">
                              כבר קיימת תוכנית: {existingProgram.title}
                            </span>
                          )}
                        </span>
                        <span className="text-sm text-muted-foreground">{opt.range}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2 border-t border-border pt-4">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={duplicateEnabled}
                    onChange={(e) => {
                      setDuplicateEnabled(e.target.checked);
                      if (!e.target.checked) setSelectedCandidateId(null);
                    }}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <Copy className="h-3.5 w-3.5" />
                  שכפול מתוכנית — העתק את כל האימונים והתרגילים מתוכנית קודמת
                </label>
                {duplicateEnabled && (
                  <p className="text-xs text-muted-foreground">
                    כולל השבוע הנוכחי, גם אם עדיין לא הסתיים. לחץ על תוכנית
                    כדי לצפות בתצוגה מקדימה ולבחור אותה.
                  </p>
                )}

                {duplicateEnabled && (
                  <DuplicateWeekPicker
                    candidates={duplicateCandidates}
                    selectedId={selectedCandidateId}
                    onSelect={setSelectedCandidateId}
                  />
                )}

                <input
                  type="hidden"
                  name="duplicate_from_program_id"
                  value={duplicateEnabled ? (selectedCandidateId ?? "") : ""}
                />
              </div>

              {state.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}

              <div className="flex gap-2">
                <Button type="submit" disabled={pending || !canSubmit}>
                  {pending ? "יוצר…" : "צור תוכנית"}
                </Button>
                <Link
                  href={`/trainer/trainees/${traineeId}`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  ביטול
                </Link>
              </div>
            </form>

            {existingForSelectedWeek && (
              <ReplaceProgramModal
                open={showReplaceModal}
                existingTitle={existingForSelectedWeek.title}
                onCancel={() => setShowReplaceModal(false)}
                onConfirm={() => {
                  setShowReplaceModal(false);
                  setConfirmedReplaceWeek(week);
                }}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
