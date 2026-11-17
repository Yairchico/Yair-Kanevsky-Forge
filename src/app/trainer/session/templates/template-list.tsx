"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarPlus, Copy, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { formatShortDate, countExercises } from "@/lib/format";
import type { ProgramSlots, WeekOption } from "@/lib/program-slots";
import { AddToProgramModal } from "../add-to-program-modal";
import { StartTemplateModal, type TraineeOption } from "../start-template-modal";
import { createTemplate, deleteTemplate, duplicateTemplate, type CreateTemplateState } from "./actions";

export interface TemplateCard {
  id: string;
  title: string;
  notes: string | null;
  createdAt: string;
  exerciseCount: number;
  /** The first few exercise names, for a glance at what's inside. */
  exerciseNames: string[];
  lastUsed: { at: string; who: string | null } | null;
}

const initialCreateState: CreateTemplateState = {};

function NewTemplateForm() {
  const [state, formAction, pending] = useActionState(createTemplate, initialCreateState);
  return (
    <form action={formAction} className="space-y-2">
      <div className="flex gap-2">
        <Input name="title" required maxLength={120} placeholder="שם לאימון שמור חדש" aria-label="שם האימון השמור" />
        <Button type="submit" className="h-11 shrink-0" disabled={pending}>
          <Plus className="h-4 w-4" />
          {pending ? "יוצר…" : "אימון שמור חדש"}
        </Button>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

/**
 * The saved workouts as cards: what's in each, when it was last used, and
 * — for the trainer — start / edit / duplicate / delete. The read-only
 * viewer gets the cards and a "view" link only.
 */
export function TemplateList({
  readOnly,
  templates,
  trainees,
  weeks,
  slots,
}: {
  readOnly: boolean;
  templates: TemplateCard[];
  trainees: TraineeOption[];
  /** "הוסף לתוכנית של מתאמן": the weeks offered, and what each trainee already has in them. */
  weeks: WeekOption[];
  slots: ProgramSlots;
}) {
  const [starting, setStarting] = useState<TemplateCard | null>(null);
  const [adding, setAdding] = useState<TemplateCard | null>(null);
  const [deleting, setDeleting] = useState<TemplateCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDuplicate(template: TemplateCard) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await duplicateTemplate(template.id);
        if (result.error) setError(result.error);
      } catch {
        setError("אין חיבור — נסו שוב בעוד רגע");
      }
    });
  }

  function handleDelete() {
    const template = deleting;
    if (!template) return;
    setError(null);
    startTransition(async () => {
      try {
        // Redirects back to this (refreshed) list on success.
        const result = await deleteTemplate(template.id);
        if (result?.error) setError(result.error);
      } catch {
        setError("אין חיבור — נסו שוב בעוד רגע");
      } finally {
        setDeleting(null);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">אימונים שמורים</h1>
        <p className="text-sm text-muted-foreground">
          תבניות לאימון אישי. לא שייכות לאף מתאמן, ואפשר להפעיל אותן כמה פעמים שרוצים.
        </p>
      </div>

      {!readOnly && <NewTemplateForm />}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {templates.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {readOnly
            ? "אין אימונים שמורים."
            : "עדיין אין אימונים שמורים. אפשר לבנות אחד כאן, או לשמור אימון חופשי שהסתיים כאימון שמור."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {templates.map((template) => (
            <Card key={template.id}>
              <CardContent className="space-y-3 p-4">
                <div>
                  <p className="font-semibold">{template.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {countExercises(template.exerciseCount)} · נוצר {formatShortDate(template.createdAt)}
                  </p>
                </div>
                {template.exerciseNames.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {template.exerciseNames.join(", ")}
                    {template.exerciseCount > template.exerciseNames.length ? "…" : ""}
                  </p>
                )}
                {template.notes && <p className="text-sm whitespace-pre-line">{template.notes}</p>}
                <p className="text-xs text-muted-foreground">
                  שימוש אחרון:{" "}
                  {template.lastUsed
                    ? `${formatShortDate(template.lastUsed.at)}${template.lastUsed.who ? ` · ${template.lastUsed.who}` : ""}`
                    : "טרם נעשה בו שימוש"}
                </p>

                {readOnly ? (
                  <Link
                    href={`/trainer/session/templates/${template.id}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    צפייה
                  </Link>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={template.exerciseCount === 0}
                      title={template.exerciseCount === 0 ? "אין תרגילים באימון השמור הזה" : undefined}
                      onClick={() => setStarting(template)}
                    >
                      <Play className="h-4 w-4" />
                      התחל
                    </Button>
                    <Link
                      href={`/trainer/session/templates/${template.id}`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      <Pencil className="h-4 w-4" />
                      ערוך
                    </Link>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => handleDuplicate(template)}
                    >
                      <Copy className="h-4 w-4" />
                      שכפל
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={template.exerciseCount === 0}
                      onClick={() => setAdding(template)}
                    >
                      <CalendarPlus className="h-4 w-4" />
                      לתוכנית של מתאמן
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`מחק את ${template.title}`}
                      disabled={pending}
                      onClick={() => setDeleting(template)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Keyed so each opening starts from that template's own defaults. */}
      <AddToProgramModal
        key={adding ? `add-${adding.id}` : "add-closed"}
        template={adding}
        trainees={trainees}
        weeks={weeks}
        slots={slots}
        onClose={() => setAdding(null)}
      />

      <StartTemplateModal
        key={starting?.id ?? "closed"}
        template={starting}
        trainees={trainees}
        onClose={() => setStarting(null)}
      />

      <Modal open={deleting != null} onClose={() => setDeleting(null)} title="מחיקת אימון שמור">
        <div className="space-y-3">
          <p className="text-sm">
            למחוק את &quot;{deleting?.title}&quot;? אימונים שכבר נעשו ממנו נשארים בהיסטוריה כמו שהם.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={pending}>
              {pending ? "מוחק…" : "כן, למחוק"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>
              ביטול
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
