"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import type { ProgramSlots, WeekOption } from "@/lib/program-slots";
import { cn } from "@/lib/utils";
import { DAY_NAMES } from "@/lib/week";
import { addTemplateToProgram } from "./templates/actions";
import type { TraineeOption } from "./start-template-modal";

const MAX_WORKOUTS_PER_DAY = 2;

/**
 * "הוסף לתוכנית של מתאמן" (planning/PLAN.md Q5.12): a saved workout copied
 * into a trainee's weekly program as a new workout on a chosen day. Shows,
 * for the chosen trainee and week, whether there's a program already and
 * which days are full; a week with no program gets a new draft one.
 */
export function AddToProgramModal({
  template,
  trainees,
  weeks,
  slots,
  onClose,
}: {
  /** null = closed. */
  template: { id: string; title: string } | null;
  trainees: TraineeOption[];
  weeks: WeekOption[];
  slots: ProgramSlots;
  onClose: () => void;
}) {
  const [traineeId, setTraineeId] = useState(trainees[0]?.id ?? "");
  const [weekKey, setWeekKey] = useState(weeks[0]?.key ?? "");
  const [day, setDay] = useState<number | null>(null);
  const [programTitle, setProgramTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ href: string; revertedToDraft: boolean; createdProgram: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const slot = slots[traineeId]?.[weekKey] ?? null;
  const dayCounts = slot?.dayCounts ?? [0, 0, 0, 0, 0, 0, 0];
  const dayFull = (d: number) => dayCounts[d] >= MAX_WORKOUTS_PER_DAY;

  function handleAdd() {
    if (!template) return;
    if (!traineeId) return setError("יש לבחור מתאמן");
    if (day == null) return setError("יש לבחור יום");
    setError(null);
    startTransition(async () => {
      try {
        const result = await addTemplateToProgram(template.id, {
          traineeId,
          weekStart: weekKey,
          dayOfWeek: day,
          programTitle: slot ? null : programTitle,
        });
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setDone({
          href: `/trainer/trainees/${traineeId}/programs/${result.programId}`,
          revertedToDraft: result.revertedToDraft,
          createdProgram: result.createdProgram,
        });
      } catch {
        setError("אין חיבור — נסו שוב בעוד רגע");
      }
    });
  }

  return (
    <Modal
      open={template != null}
      onClose={onClose}
      title={template ? `הוספת "${template.title}" לתוכנית של מתאמן` : undefined}
    >
      {done ? (
        <div className="space-y-3">
          <p className="text-sm text-success">
            {done.createdProgram ? "נוצרה תוכנית חדשה (טיוטה), והאימון נוסף אליה." : "האימון נוסף לתוכנית."}
          </p>
          {done.revertedToDraft && (
            <p className="rounded-md bg-warning/15 px-3 py-2 text-sm text-warning-foreground">
              התוכנית הייתה מפורסמת, ולכן חזרה לטיוטה כדי שתבדקו אותה. המתאמן יראה את השינוי אחרי שתפרסמו אותה שוב.
            </p>
          )}
          {done.createdProgram && (
            <p className="text-sm text-muted-foreground">המתאמן יראה אותה אחרי שתפרסמו אותה מהבילדר.</p>
          )}
          <div className="flex gap-2">
            <Link href={done.href} className={buttonVariants()}>
              פתח בבילדר
            </Link>
            <Button type="button" variant="outline" onClick={onClose}>
              סגור
            </Button>
          </div>
        </div>
      ) : trainees.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין מתאמנים פעילים.</p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="add-to-program-trainee">מתאמן</Label>
            <Select
              id="add-to-program-trainee"
              value={traineeId}
              onChange={(e) => {
                setTraineeId(e.target.value);
                setDay(null);
              }}
            >
              {trainees.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-to-program-week">שבוע</Label>
            <Select
              id="add-to-program-week"
              value={weekKey}
              onChange={(e) => {
                setWeekKey(e.target.value);
                setDay(null);
              }}
            >
              {weeks.map((w) => {
                const existing = slots[traineeId]?.[w.key];
                return (
                  <option key={w.key} value={w.key}>
                    {w.label}
                    {existing ? ` · ${existing.title} (${existing.status === "published" ? "פורסם" : "טיוטה"})` : " · אין תוכנית"}
                  </option>
                );
              })}
            </Select>
            {slot ? (
              <p className="text-xs text-muted-foreground">
                האימון יתווסף לתוכנית &quot;{slot.title}&quot;
                {slot.status === "published" ? ". היא מפורסמת, ולכן תחזור לטיוטה עד שתפרסמו אותה שוב." : "."}
                {slot.inBlock ? " השבוע הזה שייך לבלוק: התרגילים יתווספו בלי קפיצה." : ""}
              </p>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="add-to-program-title" className="text-xs">
                  אין תוכנית בשבוע הזה — תיווצר תוכנית חדשה (טיוטה) בשם:
                </Label>
                <Input
                  id="add-to-program-title"
                  value={programTitle}
                  maxLength={120}
                  placeholder={template?.title ?? ""}
                  onChange={(e) => setProgramTitle(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>יום</Label>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
              {DAY_NAMES.map((name, d) => (
                <button
                  key={name}
                  type="button"
                  disabled={dayFull(d)}
                  aria-pressed={day === d}
                  onClick={() => setDay(d)}
                  className={cn(
                    "flex flex-col items-center rounded-lg border px-1 py-2 text-sm font-medium transition-colors",
                    day === d
                      ? "border-primary bg-primary text-primary-foreground"
                      : dayFull(d)
                        ? "cursor-not-allowed border-border bg-muted text-muted-foreground/60"
                        : "border-border hover:border-primary",
                  )}
                >
                  {name}
                  <span className={cn("text-[10px] font-normal", day === d ? "opacity-80" : "text-muted-foreground")}>
                    {dayCounts[d]}/{MAX_WORKOUTS_PER_DAY}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="button" className="w-full" onClick={handleAdd} disabled={pending || day == null}>
            {pending ? "מוסיף…" : "הוסף לתוכנית"}
          </Button>
        </div>
      )}
    </Modal>
  );
}
