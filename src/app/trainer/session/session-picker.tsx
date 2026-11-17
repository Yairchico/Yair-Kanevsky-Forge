"use client";

import { countExercises } from "@/lib/format";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchInput } from "@/components/ui/search-input";
import { startTraineeSession } from "./actions";
import { startFreeSession } from "./free/actions";
import { StartTemplateModal, type TraineeOption } from "./start-template-modal";

export interface PickerTrainee {
  id: string;
  name: string;
  /** What this week looks like for them, e.g. "2/3 אימונים בוצעו". */
  subtitle: string;
}

/** Step 1: who the session is with. Filtering is local; picking is a plain link. */
export function TraineePickList({ trainees }: { trainees: PickerTrainee[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle ? trainees.filter((t) => t.name.toLowerCase().includes(needle)) : trainees;

  return (
    <div className="space-y-2">
      {trainees.length > 6 && (
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש מתאמן…" />
      )}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {trainees.length === 0 ? "אין עדיין מתאמנים פעילים." : "לא נמצאו מתאמנים."}
        </p>
      ) : (
        filtered.map((t) => (
          <Link
            key={t.id}
            href={`/trainer/session?trainee=${t.id}`}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-hover"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-tint font-semibold text-primary-text">
              {t.name.trim().charAt(0)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{t.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{t.subtitle}</span>
            </span>
            <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))
      )}
    </div>
  );
}

/** "התחל" on one workout of the trainee's weekly plan. Navigates to the live screen on success. */
export function StartWorkoutButton({
  workoutId,
  label = "התחל",
  disabled = false,
}: {
  workoutId: string;
  label?: string;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        disabled={pending || disabled}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              // Redirects on success; only comes back with an error.
              const result = await startTraineeSession(workoutId);
              if (result?.error) setError(result.error);
            } catch {
              setError("אין חיבור — נסו שוב");
            }
          });
        }}
      >
        <Play className="h-4 w-4" />
        {pending ? "פותח…" : label}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Starts an empty free session — exercises get picked as it goes. With
 * `traineeId` it's assigned to that trainee from the start (they turned up
 * on a day with nothing planned); otherwise it's for nobody, with an
 * optional name ("אורח").
 */
export function StartFreeSessionForm({ traineeId = null }: { traineeId?: string | null }) {
  const [guestLabel, setGuestLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleStart() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await startFreeSession({ traineeId, guestLabel: traineeId ? null : guestLabel });
        if (result?.error) setError(result.error);
      } catch {
        setError("אין חיבור — נסו שוב");
      }
    });
  }

  return (
    <div className="space-y-2">
      {!traineeId && (
        <div className="space-y-1">
          <Label htmlFor="free-session-new-label">
            שם או כינוי <span className="font-normal text-muted-foreground">(אופציונלי)</span>
          </Label>
          <Input
            id="free-session-new-label"
            value={guestLabel}
            maxLength={80}
            placeholder="לדוגמה: אורח, אימון ניסיון"
            onChange={(e) => setGuestLabel(e.target.value)}
          />
        </div>
      )}
      <Button
        type="button"
        size={traineeId ? "default" : "lg"}
        variant={traineeId ? "outline" : "default"}
        className={traineeId ? undefined : "w-full"}
        onClick={handleStart}
        disabled={pending}
      >
        <Play className="h-4 w-4" />
        {pending ? "פותח…" : traineeId ? "אימון חופשי (בלי תוכנית)" : "התחל אימון חופשי"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export interface PickerTemplate {
  id: string;
  title: string;
  exerciseCount: number;
}

/** "מתוך אימון שמור": each saved workout with a start button (who it's for is asked in a dialog). */
export function TemplateStartList({
  templates,
  trainees,
  initialTraineeId = null,
}: {
  templates: PickerTemplate[];
  trainees: TraineeOption[];
  /** Preselected in the dialog when the picker already knows who the session is with. */
  initialTraineeId?: string | null;
}) {
  const [starting, setStarting] = useState<PickerTemplate | null>(null);

  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        עדיין אין אימונים שמורים.{" "}
        <Link href="/trainer/session/templates" className="text-primary-text underline-offset-4 hover:underline">
          ליצירת אימון שמור
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {templates.map((template) => (
        <div
          key={template.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
        >
          <span className="min-w-0">
            <span className="block truncate font-medium">{template.title}</span>
            <span className="block text-xs text-muted-foreground">{countExercises(template.exerciseCount)}</span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={template.exerciseCount === 0}
            onClick={() => setStarting(template)}
          >
            <Play className="h-4 w-4" />
            התחל
          </Button>
        </div>
      ))}
      <StartTemplateModal
        key={starting?.id ?? "closed"}
        template={starting}
        trainees={trainees}
        initialTraineeId={initialTraineeId}
        onClose={() => setStarting(null)}
      />
    </div>
  );
}
