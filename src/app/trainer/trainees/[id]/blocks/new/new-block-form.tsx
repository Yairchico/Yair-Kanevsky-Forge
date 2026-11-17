"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { BlockFields, DEFAULT_BLOCK_FIELDS } from "@/components/block-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatWeekRange, parseDateKey } from "@/lib/week";
import { createBlock, type BlockActionState } from "../actions";

const initialState: BlockActionState = {};

/**
 * The form behind "בלוק חדש". Everything is controlled state, so a refused
 * submit (a validation message, or weeks that already have a program) comes
 * back with the form exactly as it was typed.
 */
export function NewBlockForm({
  traineeId,
  traineeName,
  currentWeekKey,
  startOptions,
  sources,
}: {
  traineeId: string;
  traineeName: string;
  currentWeekKey: string;
  startOptions: { key: string; label: string }[];
  /** Existing programs of the trainee that week 1 can be copied from. */
  sources: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(createBlock.bind(null, traineeId), initialState);
  const [fields, setFields] = useState(DEFAULT_BLOCK_FIELDS);
  const [startWeek, setStartWeek] = useState(currentWeekKey);
  const [sourceId, setSourceId] = useState("");
  const [autoPublish, setAutoPublish] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);

  // The weeks a refusal listed apply to the range that was submitted. Once
  // the trainer changes the range they no longer do, and must not keep
  // demanding a "replace" tick for weeks that aren't in it.
  const rangeKey = `${startWeek}:${fields.weeksCount}`;
  const [seenState, setSeenState] = useState(state);
  const [conflictRange, setConflictRange] = useState<string | null>(null);
  if (state !== seenState) {
    setSeenState(state);
    setConflictRange(state.conflicts?.length ? rangeKey : null);
  }
  const conflicts = conflictRange === rangeKey ? (state.conflicts ?? []) : [];

  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader>
        <CardTitle>בלוק חדש עבור {traineeName}</CardTitle>
        <CardDescription>
          רצף שבועות שבו היעדים מתקדמים אוטומטית: בונים שבוע אחד, קובעים לכל תרגיל קפיצה, והשבועות הבאים
          מחושבים מהשבוע הקודם ומהביצוע בפועל. כל השבועות נוצרים כטיוטה, ואתם מפרסמים.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5">
          <BlockFields idPrefix="new-block" values={fields} onChange={setFields} />

          <div className="space-y-1.5">
            <Label htmlFor="new-block-start">שבוע התחלה</Label>
            <Select
              id="new-block-start"
              name="start_week"
              value={startWeek}
              onChange={(e) => setStartWeek(e.target.value)}
            >
              {startOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-block-source">שבוע 1</Label>
            <Select
              id="new-block-source"
              name="source_program_id"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
            >
              <option value="">ריק — אבנה אותו בעצמי</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  העתק מ: {source.label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              כשמעתיקים תוכנית קיימת, גם השבועות הבאים מקבלים מיד את אותם אימונים. את הקפיצות קובעים אחר כך,
              בבילדר של שבוע 1.
            </p>
          </div>

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
              פרסם אוטומטית כל שבוע כשהוא מתחיל
              <span className="block text-xs text-muted-foreground">
                כבוי כברירת מחדל: כל שבוע נשאר טיוטה עד שתפרסמו אותו, אחרי שראיתם מה חושב.
              </span>
            </span>
          </label>

          {conflicts.length > 0 && (
            <div className="space-y-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
              <p className="flex items-start gap-2 font-medium">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                {conflicts.length === 1 ? "בשבוע אחד בטווח כבר יש תוכנית:" : `ב-${conflicts.length} שבועות בטווח כבר יש תוכנית:`}
              </p>
              <ul className="list-inside list-disc text-muted-foreground">
                {conflicts.map((week) => (
                  <li key={week}>{formatWeekRange(parseDateKey(week))}</li>
                ))}
              </ul>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  name="replace_existing"
                  value="1"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                />
                <span>
                  להחליף את התוכניות האלה בשבועות של הבלוק
                  <span className="block text-xs text-muted-foreground">
                    תוכנית שהמתאמן כבר התחיל לבצע לא תוחלף — במקרה כזה בחרו שבוע התחלה מאוחר יותר.
                  </span>
                </span>
              </label>
            </div>
          )}

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || (conflicts.length > 0 && !replaceExisting)}>
              {pending ? "יוצר…" : "צור בלוק"}
            </Button>
            <Link href={`/trainer/trainees/${traineeId}`} className={buttonVariants({ variant: "outline" })}>
              ביטול
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
