"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Pencil, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import type { SessionExerciseData } from "@/components/session/session-exercise-panel";
import { SetsTable } from "@/components/sets-table";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatShortDateTime, countExercises, countSets } from "@/lib/format";
import { isSessionStale, sessionDurationMinutes } from "@/lib/free-sessions";
import { cn } from "@/lib/utils";
import {
  assignFreeSession,
  deleteFreeSession,
  reopenFreeSession,
  saveFreeSessionAsTemplate,
} from "../actions";

/**
 * A free session read back: what was done, exercise by exercise. The
 * trainer can also change who it belongs to (at any time — assigning only
 * ever moves it between histories), re-open it to fix something, keep it
 * as a saved workout, or delete it. The read-only viewer gets none of that.
 */
export function FreeSessionSummary({
  readOnly,
  templateSaveFailed = false,
  session,
  traineeName,
  trainees,
  template,
  exercises,
}: {
  readOnly: boolean;
  /** Arrived here from "finish" with a saved-workout step that failed. */
  templateSaveFailed?: boolean;
  session: {
    id: string;
    traineeId: string | null;
    guestLabel: string | null;
    startedAt: string;
    finishedAt: string | null;
    notes: string | null;
  };
  traineeName: string | null;
  trainees: { id: string; name: string }[];
  template: { id: string; title: string; deleted: boolean } | null;
  exercises: SessionExerciseData[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [assignedTo, setAssignedTo] = useState(session.traineeId ?? "");
  const [templateTitle, setTemplateTitle] = useState("");
  const [savedTemplate, setSavedTemplate] = useState<{ id: string; updated: boolean } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const performed = exercises.filter((ex) => ex.loggedSets.length > 0);
  const setCount = performed.reduce((sum, ex) => sum + ex.loggedSets.length, 0);
  const minutes = sessionDurationMinutes(session.startedAt, session.finishedAt);
  const title = traineeName ?? (session.guestLabel?.trim() || "אימון חופשי");
  const backHref = session.traineeId ? `/trainer/trainees/${session.traineeId}` : "/trainer/session";

  function run(action: () => Promise<{ error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) setError(result.error);
        else after?.();
      } catch {
        setError("אין חיבור — נסו שוב בעוד רגע");
      }
    });
  }

  function handleAssign(next: string) {
    const previous = assignedTo;
    setAssignedTo(next);
    setError(null);
    startTransition(async () => {
      try {
        const result = await assignFreeSession(session.id, next || null);
        if (result.error) {
          setAssignedTo(previous);
          setError(result.error);
        }
      } catch {
        setAssignedTo(previous);
        setError("אין חיבור — השיוך לא נשמר");
      }
    });
  }

  function handleSaveTemplate(updateExisting: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveFreeSessionAsTemplate(
          session.id,
          updateExisting ? { updateExisting: true } : { title: templateTitle },
        );
        if (result.error || !result.templateId) {
          setError(result.error ?? "שגיאה בשמירת האימון השמור");
          return;
        }
        setSavedTemplate({ id: result.templateId, updated: updateExisting });
        setTemplateTitle("");
      } catch {
        setError("אין חיבור — נסו שוב בעוד רגע");
      }
    });
  }

  return (
    <AppShell title="אימון חופשי" backHref={backHref} readOnly={readOnly}>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            {formatShortDateTime(session.startedAt)}
            {minutes != null ? ` · ${minutes} דק׳` : ""} · {countExercises(performed.length)} · {countSets(setCount)}
            {template ? ` · מתוך "${template.title}"` : ""}
          </CardDescription>
          <div className="flex flex-wrap gap-1.5 pt-1 text-xs font-medium">
            <span
              className={cn(
                "rounded-full px-2.5 py-1",
                traineeName ? "bg-success/15 text-success" : "bg-secondary text-secondary-foreground",
              )}
            >
              {traineeName ? `משויך: ${traineeName}` : "לא משויך"}
            </span>
            {traineeName && session.guestLabel?.trim() && (
              <span className="rounded-full bg-secondary px-2.5 py-1 text-secondary-foreground">
                {session.guestLabel.trim()}
              </span>
            )}
            {!session.finishedAt && (
              <span className="rounded-full bg-warning/20 px-2.5 py-1 text-warning-foreground">
                {isSessionStale(session.startedAt) ? "לא הסתיים" : "האימון עדיין פתוח"}
              </span>
            )}
          </div>
        </CardHeader>
        {session.notes && (
          <CardContent>
            <p className="rounded-md bg-muted/60 p-3 text-sm whitespace-pre-line">{session.notes}</p>
          </CardContent>
        )}
      </Card>

      {exercises.length === 0 ? (
        <p className="text-sm text-muted-foreground">לא נרשמו תרגילים באימון הזה.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {exercises.map((ex, index) => (
            <Card key={ex.id}>
              <CardContent className="space-y-2 p-4">
                <div>
                  <p className="font-semibold">
                    {index + 1}. {ex.name}
                  </p>
                  {ex.muscleGroup && <p className="text-xs text-muted-foreground">{ex.muscleGroup}</p>}
                </div>
                {ex.plannedSets.length === 0 && ex.loggedSets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">לא בוצע</p>
                ) : (
                  <SetsTable
                    planned={ex.plannedSets}
                    logged={ex.loggedSets}
                    mode={ex.plannedSets.length > 0 ? "both" : "performed"}
                  />
                )}
                {ex.initialNote && (
                  <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-sm whitespace-pre-line">{ex.initialNote}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!readOnly && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">פעולות</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1">
              <Label htmlFor="free-session-assigned">שיוך למתאמן</Label>
              <Select
                id="free-session-assigned"
                value={assignedTo}
                disabled={pending}
                onChange={(e) => handleAssign(e.target.value)}
              >
                <option value="">לא משויך</option>
                {trainees.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                אימון משויך מופיע בהיסטוריה של המתאמן. הוא לא משפיע על התוכנית השבועית או על קפיצות של בלוק.
              </p>
            </div>

            {setCount > 0 && (
              <div className="space-y-2">
                {templateSaveFailed && !savedTemplate && (
                  <p className="rounded-md bg-warning/15 px-3 py-2 text-sm text-warning-foreground">
                    האימון נשמר, אבל השמירה כאימון שמור נכשלה. אפשר לנסות שוב כאן.
                  </p>
                )}
                <Label htmlFor="free-session-template-title">שמירה כאימון שמור (תבנית לשימוש חוזר)</Label>
                <div className="flex gap-2">
                  <Input
                    id="free-session-template-title"
                    value={templateTitle}
                    maxLength={120}
                    placeholder="שם האימון השמור"
                    onChange={(e) => setTemplateTitle(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 shrink-0"
                    disabled={pending || !templateTitle.trim()}
                    onClick={() => handleSaveTemplate(false)}
                  >
                    <BookmarkPlus className="h-4 w-4" />
                    שמור
                  </Button>
                </div>
                {template && !template.deleted && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => handleSaveTemplate(true)}
                  >
                    עדכן את &quot;{template.title}&quot; לפי מה שבוצע
                  </Button>
                )}
                {savedTemplate && (
                  <p className="text-sm text-success">
                    {savedTemplate.updated ? "האימון השמור עודכן." : "נשמר כאימון שמור."}{" "}
                    <Link href={`/trainer/session/templates/${savedTemplate.id}`} className="underline">
                      פתח לעריכה
                    </Link>
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => run(() => reopenFreeSession(session.id), () => router.refresh())}
              >
                <Pencil className="h-4 w-4" />
                {session.finishedAt ? "פתח מחדש לעריכה" : "המשך את האימון"}
              </Button>
              {!confirmingDelete && (
                <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmingDelete(true)}>
                  <Trash2 className="h-4 w-4" />
                  מחיקה
                </Button>
              )}
              <Link href="/trainer/session" className={buttonVariants({ variant: "ghost" })}>
                חזרה לאימון אישי
              </Link>
            </div>

            {confirmingDelete && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-destructive">
                  למחוק את האימון לצמיתות?{traineeName ? ` הוא יוסר גם מההיסטוריה של ${traineeName}.` : ""} לא ניתן לבטל.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => run(() => deleteFreeSession(session.id))}
                  >
                    {pending ? "מוחק…" : "כן, למחוק"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setConfirmingDelete(false)}>
                    ביטול
                  </Button>
                </div>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
