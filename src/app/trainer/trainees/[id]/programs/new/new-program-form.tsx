"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Copy } from "lucide-react";
import { createProgram, type ActionState } from "../actions";
import { AppShell } from "@/components/app-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { addDays, formatWeekLabel, formatWeekRange, getWeekStart, parseDateKey, toDateKey } from "@/lib/week";
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
  exercises: DuplicateExercise[];
}

interface DuplicateCandidate {
  programId: string;
  title: string;
  weekStartDate: string;
  status: "draft" | "published";
  workouts: DuplicateWorkout[];
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
        const isExpanded = expandedId === c.programId;
        const totalExercises = c.workouts.reduce((n, w) => n + w.exercises.length, 0);

        return (
          <div
            key={c.programId}
            className={cn(
              "rounded-lg border p-3 transition-colors",
              isSelected ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(c.programId)}
              className="flex w-full items-start justify-between gap-2 text-start"
            >
              <div>
                <p className="text-sm font-medium">{c.title}</p>
                <p className="text-xs text-muted-foreground">
                  {formatWeekLabel(weekStart)} · {formatWeekRange(weekStart)} ·{" "}
                  {c.status === "published" ? "פורסם" : "טיוטה"}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {c.workouts.length} אימונים · {totalExercises} תרגילים
              </span>
            </button>

            <button
              type="button"
              onClick={() => setExpandedId(isExpanded ? null : c.programId)}
              className="mt-1.5 flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  הסתר תצוגה מקדימה
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  תצוגה מקדימה
                </>
              )}
            </button>

            {isExpanded && (
              <div className="mt-2 space-y-2 border-t border-border pt-2">
                {c.workouts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">אין אימונים בשבוע זה.</p>
                ) : (
                  c.workouts.map((w, i) => (
                    <div key={w.id}>
                      <p className="text-xs font-semibold">אימון {i + 1}</p>
                      {w.exercises.length === 0 ? (
                        <p className="text-xs text-muted-foreground">אין תרגילים.</p>
                      ) : (
                        <ul className="ms-4 list-disc space-y-0.5 text-xs text-muted-foreground">
                          {w.exercises.map((ex) => (
                            <li key={ex.id}>
                              {ex.name} — {ex.sets}×{ex.reps}
                              {ex.weight ? ` · ${ex.weight}` : ""}
                              {ex.rpe != null ? ` · RPE ${ex.rpe}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
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
