"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Copy, Eye } from "lucide-react";
import { createProgram, type ActionState } from "../actions";
import { AppShell } from "@/components/app-shell";
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
  workouts: DuplicateWorkout[];
}

/**
 * The preview a trainer must step through before duplicating a week: a
 * centered popup (not an inline accordion) showing one workout at a time,
 * with arrows on the sides to flip between the week's workouts. Confirming
 * here is the only way to actually select a candidate — closing/cancelling
 * leaves the previous selection untouched.
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
      <p className="mb-3 text-xs text-muted-foreground">
        {formatWeekLabel(weekStart)} · {formatWeekRange(weekStart)}
      </p>

      {candidate.workouts.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">אין אימונים בשבוע זה.</p>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label="האימון הקודם"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <div className="min-w-0 flex-1 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{dayName(workout.dayOfWeek)}</p>
              <p className="text-xs text-muted-foreground">
                אימון {index + 1} מתוך {candidate.workouts.length}
              </p>
            </div>
            {workout.exercises.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">אין תרגילים.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {workout.exercises.map((ex) => (
                  <li key={ex.id}>
                    <span className="text-foreground">{ex.name}</span> — {ex.sets}×{ex.reps}
                    {ex.weight ? ` · ${ex.weight}` : ""}
                    {ex.rpe != null ? ` · RPE ${ex.rpe}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={() => go(1)}
            disabled={index === candidate.workouts.length - 1}
            aria-label="האימון הבא"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Button type="button" onClick={() => onConfirm(candidate.programId)} className="flex-1">
          <Check className="h-4 w-4" />
          אשר ובחר שבוע זה
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          ביטול
        </Button>
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
        אין שבועות שמורים בחודש האחרון לשכפול.
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
}: {
  traineeId: string;
  traineeName: string;
  duplicateCandidates: DuplicateCandidate[];
}) {
  const action = createProgram.bind(null, traineeId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [week, setWeek] = useState(weekOptions[0].key);
  const [duplicateEnabled, setDuplicateEnabled] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  const canSubmit = !duplicateEnabled || selectedCandidateId != null;

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
            <form action={formAction} className="space-y-4">
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
                <div className="grid gap-2">
                  {weekOptions.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setWeek(opt.key)}
                      className={cn(
                        "flex items-center justify-between rounded-lg border p-3 text-start transition-colors",
                        week === opt.key
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted",
                      )}
                    >
                      <span className="font-medium">{opt.label}</span>
                      <span className="text-sm text-muted-foreground">
                        {opt.range}
                      </span>
                    </button>
                  ))}
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
                  שכפול שבוע — העתק את כל האימונים והתרגילים משבוע קודם
                </label>
                {duplicateEnabled && (
                  <p className="text-xs text-muted-foreground">
                    לחץ על שבוע כדי לצפות בתצוגה מקדימה ולבחור אותו.
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
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
