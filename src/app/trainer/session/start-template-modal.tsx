"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { startFreeSession } from "./free/actions";

export interface TraineeOption {
  id: string;
  name: string;
}

/**
 * "התחל" on a saved workout: with a trainee (the session lands in their
 * history, and their "last time" is shown next to each target) or without
 * one (a guest, a trial session, the trainer's own). Starting copies the
 * saved workout's exercises and targets into a new free session.
 */
export function StartTemplateModal({
  template,
  trainees,
  initialTraineeId = null,
  onClose,
}: {
  /** null = closed. */
  template: { id: string; title: string } | null;
  trainees: TraineeOption[];
  initialTraineeId?: string | null;
  onClose: () => void;
}) {
  const [withTrainee, setWithTrainee] = useState(initialTraineeId != null || trainees.length > 0);
  const [traineeId, setTraineeId] = useState(initialTraineeId ?? trainees[0]?.id ?? "");
  const [guestLabel, setGuestLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleStart() {
    if (!template) return;
    if (withTrainee && !traineeId) {
      setError("יש לבחור מתאמן");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        // Redirects to the session on success; only comes back with an error.
        const result = await startFreeSession({
          templateId: template.id,
          traineeId: withTrainee ? traineeId : null,
          guestLabel: withTrainee ? null : guestLabel,
        });
        if (result?.error) setError(result.error);
      } catch {
        setError("אין חיבור — נסו שוב בעוד רגע");
      }
    });
  }

  const optionClass = (selected: boolean) =>
    cn(
      "block w-full rounded-xl border p-3 text-start transition-colors",
      selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
    );

  return (
    <Modal open={template != null} onClose={onClose} title={template ? `התחלת "${template.title}"` : undefined}>
      <div className="space-y-3">
        <div className={optionClass(withTrainee)}>
          <label className="flex items-center gap-2 font-medium">
            <input
              type="radio"
              name="start-template-mode"
              className="h-4 w-4 accent-primary"
              checked={withTrainee}
              disabled={trainees.length === 0}
              onChange={() => setWithTrainee(true)}
            />
            עם מתאמן
          </label>
          {withTrainee && (
            <Select
              aria-label="מתאמן"
              className="mt-2"
              value={traineeId}
              onChange={(e) => setTraineeId(e.target.value)}
            >
              {trainees.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
          {trainees.length === 0 && <p className="mt-1 text-xs text-muted-foreground">אין עדיין מתאמנים.</p>}
        </div>

        <div className={optionClass(!withTrainee)}>
          <label className="flex items-center gap-2 font-medium">
            <input
              type="radio"
              name="start-template-mode"
              className="h-4 w-4 accent-primary"
              checked={!withTrainee}
              onChange={() => setWithTrainee(false)}
            />
            ללא מתאמן
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">אורח, אימון ניסיון או אימון של המאמן</p>
          {!withTrainee && (
            <div className="mt-2 space-y-1">
              <Label htmlFor="start-template-label" className="text-xs">
                שם או כינוי (אופציונלי)
              </Label>
              <Input
                id="start-template-label"
                value={guestLabel}
                maxLength={80}
                onChange={(e) => setGuestLabel(e.target.value)}
              />
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          היעדים מהאימון השמור ימולאו מראש בכל סט. עם מתאמן יוצג גם מה שעשה בפעם הקודמת בכל תרגיל.
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="button" size="lg" className="w-full" onClick={handleStart} disabled={pending}>
          {pending ? "פותח…" : "התחל אימון"}
        </Button>
      </div>
    </Modal>
  );
}
