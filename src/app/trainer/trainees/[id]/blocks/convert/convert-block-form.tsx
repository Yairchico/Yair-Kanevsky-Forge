"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_DELOAD_PCT, MAX_BLOCK_WEEKS, MAX_DELOAD_PCT, MIN_DELOAD_PCT } from "@/lib/blocks";
import { cn } from "@/lib/utils";
import { convertToBlock, type BlockActionState } from "../actions";

export interface ConvertCandidate {
  id: string;
  title: string;
  weekKey: string;
  /** "לפני 2 שבועות · 1/11–7/11" */
  label: string;
  status: "draft" | "published";
  workoutCount: number;
  exerciseCount: number;
  /** Workouts of it the trainee already submitted. */
  submittedCount: number;
  /** Pre-ticked: the last month's weeks. */
  suggested: boolean;
}

const initialState: BlockActionState = {};

/**
 * The form behind "המר שבועות קיימים לבלוק": which of the trainee's weekly
 * programs become the block's first weeks, and how many new weeks to add
 * after them. Every value is controlled, so a refused submit comes back
 * exactly as it was.
 */
export function ConvertBlockForm({
  traineeId,
  traineeName,
  candidates,
}: {
  traineeId: string;
  traineeName: string;
  candidates: ConvertCandidate[];
}) {
  const [state, formAction, pending] = useActionState(convertToBlock.bind(null, traineeId), initialState);
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(candidates.filter((c) => c.suggested).map((c) => c.id)),
  );
  const [extraWeeks, setExtraWeeks] = useState(0);
  const [deloadWeeks, setDeloadWeeks] = useState<number[]>([]);
  const [deloadPct, setDeloadPct] = useState(DEFAULT_DELOAD_PCT);
  const [autoPublish, setAutoPublish] = useState(false);

  const count = selected.size;
  const maxExtra = Math.max(0, MAX_BLOCK_WEEKS - count);
  const extra = Math.min(extraWeeks, maxExtra);
  const addedWeekNumbers = Array.from({ length: extra }, (_, i) => count + i + 1);
  const deloads = deloadWeeks.filter((w) => addedWeekNumbers.includes(w));
  const chosen = candidates.filter((c) => selected.has(c.id));
  const gaps = chosen.some((c, i) => {
    if (i === 0) return false;
    const prev = new Date(`${chosen[i - 1].weekKey}T00:00:00Z`).getTime();
    return new Date(`${c.weekKey}T00:00:00Z`).getTime() - prev !== 7 * 24 * 60 * 60 * 1000;
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader>
        <CardTitle>בלוק משבועות קיימים</CardTitle>
        <CardDescription>
          תוכניות שכבר בניתם ל{traineeName} הופכות לשבועות הראשונים של בלוק. אותו תרגיל מזוהה משבוע לשבוע, היעדים
          שקבעתם נשארים בדיוק כמו שהם (מסומנים &quot;ידני&quot;), ואפשר להוסיף אחריהם שבועות חדשים שהיעדים שלהם
          מחושבים אוטומטית לפי הקפיצות שתקבעו.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {candidates.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              אין ל{traineeName} תוכניות שבועיות שאינן כבר חלק מבלוק.
            </p>
            <Link href={`/trainer/trainees/${traineeId}/blocks/new`} className={buttonVariants({ variant: "outline" })}>
              בלוק חדש
            </Link>
          </div>
        ) : (
          <form action={formAction} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="convert-title">שם הבלוק</Label>
              <Input
                id="convert-title"
                name="title"
                required
                maxLength={120}
                placeholder="לדוגמה: בלוק כוח 1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">שבועות קיימים</legend>
              <div className="space-y-1.5">
                {candidates.map((c) => {
                  const on = selected.has(c.id);
                  const order = on ? chosen.findIndex((x) => x.id === c.id) + 1 : null;
                  return (
                    <label
                      key={c.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-sm transition-colors",
                        on ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
                      )}
                    >
                      <input
                        type="checkbox"
                        name="program_ids"
                        value={c.id}
                        checked={on}
                        onChange={() => toggle(c.id)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.title} · {c.status === "published" ? "פורסם" : "טיוטה"} · {c.exerciseCount} תרגילים
                          {c.submittedCount > 0 ? ` · ${c.submittedCount} אימונים בוצעו` : ""}
                        </span>
                      </span>
                      {order != null && (
                        <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                          שבוע {order}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              {gaps && (
                <p className="text-xs text-warning-foreground">
                  יש פער בין השבועות שנבחרו. זה מותר — השבועות ימוספרו ברצף, והקפיצה תחושב מהשבוע הקודם שנבחר.
                </p>
              )}
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="convert-extra">שבועות חדשים להוסיף אחריהם</Label>
              <Input
                id="convert-extra"
                name="extra_weeks"
                type="number"
                inputMode="numeric"
                min={0}
                max={maxExtra}
                className="w-28"
                value={extra}
                onChange={(e) => setExtraWeeks(Math.max(0, Math.round(Number(e.target.value)) || 0))}
              />
              <p className="text-xs text-muted-foreground">
                השבועות החדשים מתחילים מיד אחרי השבוע האחרון שנבחר (ולא לפני השבוע הנוכחי), כטיוטות, עם אותם אימונים
                כמו השבוע האחרון. היעדים שלהם מחושבים לפי הקפיצה שתקבעו לכל תרגיל בבילדר של השבוע האחרון.
              </p>
            </div>

            {addedWeekNumbers.length > 0 && (
              <div className="space-y-1.5">
                <Label>שבועות דילואד מבין החדשים (אופציונלי)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {addedWeekNumbers.map((week) => {
                    const on = deloads.includes(week);
                    return (
                      <button
                        key={week}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setDeloadWeeks((prev) => (on ? prev.filter((w) => w !== week) : [...prev, week]))
                        }
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
                        )}
                      >
                        שבוע {week}
                      </button>
                    );
                  })}
                </div>
                {deloads.map((w) => (
                  <input key={w} type="hidden" name="deload_weeks" value={w} />
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <Label htmlFor="convert-pct" className="text-xs">
                    משקל בדילואד (% מהשבוע הקודם)
                  </Label>
                  <Input
                    id="convert-pct"
                    name="deload_pct"
                    type="number"
                    inputMode="numeric"
                    min={MIN_DELOAD_PCT}
                    max={MAX_DELOAD_PCT}
                    className="h-9 w-20"
                    value={deloadPct}
                    onChange={(e) => setDeloadPct(Math.round(Number(e.target.value)) || 0)}
                  />
                </div>
              </div>
            )}

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="auto_publish"
                value="1"
                className="mt-0.5 h-4 w-4 accent-primary"
                checked={autoPublish}
                onChange={(e) => setAutoPublish(e.target.checked)}
              />
              <span>
                פרסם אוטומטית כל שבוע חדש כשהוא מתחיל
                <span className="block text-xs text-muted-foreground">
                  השבועות הקיימים נשארים בדיוק כמו שהם (מפורסמים או טיוטה).
                </span>
              </span>
            </label>

            <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
              {count === 0
                ? "בחרו לפחות שבוע אחד."
                : `בלוק של ${count + extra} שבועות: ${count} קיימים${extra ? ` ו-${extra} חדשים` : ""}.`}
            </p>

            {state.error && <p className="text-sm text-destructive">{state.error}</p>}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending || count === 0 || !title.trim()}>
                {pending ? "יוצר…" : "צור בלוק"}
              </Button>
              <Link href={`/trainer/trainees/${traineeId}`} className={buttonVariants({ variant: "outline" })}>
                ביטול
              </Link>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
