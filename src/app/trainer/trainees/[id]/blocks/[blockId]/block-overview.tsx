"use client";

import { Fragment, useActionState, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  Lock,
  MoreVertical,
  Pencil,
  RefreshCw,
  Settings,
  Snowflake,
} from "lucide-react";
import { BlockFields, DEFAULT_BLOCK_FIELDS } from "@/components/block-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import {
  MAX_BLOCK_WEEKS,
  MAX_DELOAD_PCT,
  MIN_DELOAD_PCT,
  type ProgressionTone,
} from "@/lib/blocks";
import type { ProgressionInfo } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import {
  deleteBlock,
  endBlock,
  insertBlockDeload,
  recomputeBlock,
  setBlockWeekDeload,
  setBlockWeekPublished,
  shiftBlock,
  startNextBlock,
  updateBlockSettings,
  type BlockActionState,
} from "../actions";

export interface BlockWeek {
  programId: string;
  index: number;
  /** "8/11–14/11" */
  range: string;
  status: "draft" | "published";
  isDeload: boolean;
  deloadPct: number | null;
  isCurrent: boolean;
  isPast: boolean;
  /** Something was already recorded in it: it can't be moved, restructured or turned into a deload. */
  started: boolean;
  exerciseCount: number;
}

export interface BlockCell {
  /** e.g. `3 × 5 · 82.5 ק"ג` */
  summary: string;
  /** Why the targets are what they are, in words. */
  explanation: string | null;
  tone: ProgressionTone | null;
  outcome: ProgressionInfo["outcome"] | null;
  hasOverride: boolean;
  /** Working sets done at target, once anything was recorded. */
  performed: { met: number; total: number } | null;
}

export interface BlockRow {
  slotKey: string;
  exerciseName: string;
  /** The exercise's rule in words. */
  rule: string;
  /** Repeated its target two decided weeks running — the trainer should look. */
  stalled: boolean;
  cells: Record<number, BlockCell>;
}

/** One workout of the block (the same workout across the weeks) and its exercises. */
export interface BlockWorkoutGroup {
  slotKey: string;
  /** "אימון 1 · ראשון · רגליים" */
  label: string;
  rows: BlockRow[];
}

const TONE_CLASS: Record<ProgressionTone, string> = {
  up: "text-success",
  hold: "text-muted-foreground",
  warn: "text-warning-foreground",
  deload: "text-primary-text",
  neutral: "text-muted-foreground",
};

const initialNextState: BlockActionState = {};

function NextBlockForm({
  traineeId,
  blockId,
  suggestedTitle,
  onCancel,
}: {
  traineeId: string;
  blockId: string;
  suggestedTitle: string;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    startNextBlock.bind(null, traineeId, blockId),
    initialNextState,
  );
  const [fields, setFields] = useState({
    ...DEFAULT_BLOCK_FIELDS,
    title: suggestedTitle,
  });
  const [usePerformed, setUsePerformed] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const conflicts = state.conflicts ?? [];

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        הבלוק החדש מתחיל מיד אחרי הבלוק הזה. שבוע 1 שלו הוא העתק של השבוע הרגיל
        האחרון כאן, עם אותן קפיצות.
      </p>
      <BlockFields idPrefix="next-block" values={fields} onChange={setFields} />
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="use_performed"
          value="1"
          className="mt-0.5 h-4 w-4 accent-primary"
          checked={usePerformed}
          onChange={(e) => setUsePerformed(e.target.checked)}
        />
        <span>
          להתחיל מהמשקלים שבוצעו בפועל
          <span className="block text-xs text-muted-foreground">
            בלי הסימון: מהיעדים של השבוע האחרון. עם הסימון: סט שבוצע מקבל את
            המשקל שהורם בו.
          </span>
        </span>
      </label>
      {conflicts.length > 0 && (
        <label className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          <input
            type="checkbox"
            name="replace_existing"
            value="1"
            className="mt-0.5 h-4 w-4 accent-primary"
            checked={replaceExisting}
            onChange={(e) => setReplaceExisting(e.target.checked)}
          />
          <span>
            בשבועות של הבלוק החדש כבר יש תוכניות. להחליף אותן (חוץ מתוכנית שכבר
            התחילו לבצע)
          </span>
        </label>
      )}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pending || (conflicts.length > 0 && !replaceExisting)}
        >
          {pending ? "יוצר…" : "צור את הבלוק הבא"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </form>
  );
}

/**
 * The block page's interactive half: the exercise × week matrix, and the
 * dialogs for everything that can be done to the block or to one week.
 * Every action is a single database function; on success the page's own
 * data refreshes (the action revalidates it), so nothing is patched
 * locally here.
 */
export function BlockOverview({
  readOnly,
  traineeId,
  traineeName,
  block,
  weeks,
  groups,
}: {
  readOnly: boolean;
  traineeId: string;
  traineeName: string;
  block: {
    id: string;
    title: string;
    weeksCount: number;
    status: "active" | "completed";
    defaultDeloadPct: number;
    autoPublish: boolean;
  };
  weeks: BlockWeek[];
  groups: BlockWorkoutGroup[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [weekMenu, setWeekMenu] = useState<BlockWeek | null>(null);
  const [weekPct, setWeekPct] = useState("");
  const [dialog, setDialog] = useState<
    "settings" | "end" | "delete" | "next" | null
  >(null);
  const [removeFuture, setRemoveFuture] = useState(true);
  const [settings, setSettings] = useState({
    title: block.title,
    autoPublish: block.autoPublish,
    defaultDeloadPct: String(block.defaultDeloadPct),
  });

  const active = block.status === "active";
  const current = weeks.find((w) => w.isCurrent);
  const lastIndex = Math.max(0, ...weeks.map((w) => w.index));
  const progressIndex =
    current?.index ?? (weeks.every((w) => w.isPast) ? lastIndex : 0);
  const empty = groups.length === 0;
  const week1 = weeks.find((w) => w.index === 1);

  function run(
    action: () => Promise<{ error?: string }>,
    done?: string,
    close = true,
  ) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result?.error) {
          setError(result.error);
          return;
        }
        if (done) setNotice(done);
        if (close) {
          setWeekMenu(null);
          setDialog(null);
        }
      } catch {
        setError("אין חיבור — נסו שוב בעוד רגע");
      }
    });
  }

  function openWeekMenu(week: BlockWeek) {
    setError(null);
    setWeekPct(String(week.deloadPct ?? block.defaultDeloadPct));
    setWeekMenu(week);
  }

  function parsePct(text: string): number | null {
    const n = Number(text);
    return Number.isInteger(n) && n >= MIN_DELOAD_PCT && n <= MAX_DELOAD_PCT
      ? n
      : null;
  }

  const builderHref = (week: BlockWeek) =>
    `/trainer/trainees/${traineeId}/programs/${week.programId}`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{block.title}</CardTitle>
              <CardDescription>
                בלוק של {traineeName} ·{" "}
                {weeks.length === 1 ? "שבוע אחד" : `${weeks.length} שבועות`}
                {active
                  ? current
                    ? ` · עכשיו שבוע ${current.index}`
                    : ""
                  : " · הסתיים"}
                {block.autoPublish && active ? " · פרסום אוטומטי" : ""}
              </CardDescription>
            </div>
            {!readOnly && (
              <div className="flex flex-wrap gap-2">
                {active && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => recomputeBlock(traineeId, block.id),
                        "היעדים חושבו מחדש.",
                      )
                    }
                  >
                    <RefreshCw className="h-4 w-4" />
                    חשב מחדש
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDialog("settings")}
                >
                  <Settings className="h-4 w-4" />
                  הגדרות
                </Button>
              </div>
            )}
          </div>
          {weeks.length > 0 && (
            <div className="flex items-center gap-2 pt-2 text-sm">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${lastIndex ? (Math.min(progressIndex, lastIndex) / lastIndex) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="shrink-0 text-muted-foreground">
                {progressIndex === 0
                  ? "טרם התחיל"
                  : `שבוע ${Math.min(progressIndex, lastIndex)} מתוך ${lastIndex}`}
              </span>
            </div>
          )}
        </CardHeader>
        {(error || notice) && !weekMenu && !dialog && (
          <CardContent>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {notice && <p className="text-sm text-success">{notice}</p>}
          </CardContent>
        )}
      </Card>

      {empty ? (
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              הבלוק עדיין ריק. בונים את שבוע 1 בבילדר, קובעים לכל תרגיל קפיצה,
              ואז לוחצים שם &quot;החל על השבועות הבאים&quot; — והשבועות הבאים
              מחושבים לבד.
            </p>
            {week1 && !readOnly && (
              <Link href={builderHref(week1)} className={buttonVariants()}>
                <Pencil className="h-4 w-4" />
                בנה את שבוע 1
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className="sticky start-0 z-10 min-w-36 border-b border-border bg-card p-3 text-start align-bottom font-semibold">
                      תרגיל
                    </th>
                    {weeks.map((week) => (
                      <th
                        key={week.programId}
                        className={cn(
                          "min-w-36 border-b border-s border-border p-2 text-start align-top font-normal",
                          week.isCurrent && "bg-primary-tint",
                        )}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <Link
                            href={builderHref(week)}
                            className="font-semibold hover:underline"
                          >
                            שבוע {week.index}
                          </Link>
                          {!readOnly && (
                            <button
                              type="button"
                              aria-label={`פעולות לשבוע ${week.index}`}
                              onClick={() => openWeekMenu(week)}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-hover hover:text-foreground"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground" dir="ltr">
                          {week.range}
                        </p>
                        <div className="flex flex-wrap gap-1 pt-1">
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                              week.status === "published"
                                ? "bg-success/15 text-success"
                                : "bg-warning/20 text-warning-foreground",
                            )}
                          >
                            {week.status === "published" ? "פורסם" : "טיוטה"}
                          </span>
                          {week.isDeload && (
                            <span className="rounded-full bg-primary-tint px-1.5 py-0.5 text-[10px] font-medium text-primary-text">
                              דילואד {week.deloadPct ?? block.defaultDeloadPct}%
                            </span>
                          )}
                          {week.isCurrent && (
                            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                              השבוע
                            </span>
                          )}
                          {week.started && (
                            <span className="flex items-center gap-0.5 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                              <Snowflake className="h-2.5 w-2.5" />
                              התחיל
                            </span>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <Fragment key={group.slotKey}>
                      <tr>
                        <th
                          scope="colgroup"
                          className="sticky start-0 z-10 border-b border-border bg-muted p-2 px-3 text-start font-semibold"
                        >
                          {group.label}
                        </th>
                        <td
                          colSpan={weeks.length}
                          className="border-b border-border bg-muted"
                        />
                      </tr>
                      {group.rows.map((row) => (
                        <tr key={row.slotKey}>
                          <th className="sticky start-0 z-10 border-b border-border bg-card p-3 text-start align-top font-normal">
                            <p className="font-medium">{row.exerciseName}</p>
                            <p className="text-xs text-muted-foreground">
                              {row.rule}
                            </p>
                            {row.stalled && (
                              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-medium text-warning-foreground">
                                <AlertTriangle className="h-3 w-3" />
                                תקוע: שבועיים בלי קפיצה
                              </span>
                            )}
                          </th>
                          {weeks.map((week) => {
                            const cell = row.cells[week.index];
                            return (
                              <td
                                key={week.programId}
                                className={cn(
                                  "border-b border-s border-border p-2 align-top",
                                  week.isCurrent && "bg-primary-tint",
                                )}
                              >
                                {!cell ? (
                                  <span className="text-muted-foreground">
                                    —
                                  </span>
                                ) : (
                                  <div className="space-y-0.5">
                                    <p className="flex flex-wrap items-center gap-1 font-medium">
                                      {(cell.outcome === "advanced" ||
                                        cell.outcome === "projected") &&
                                        cell.tone === "up" && (
                                          <ArrowUp className="h-3.5 w-3.5 text-success" />
                                        )}
                                      <span>{cell.summary}</span>
                                      {cell.hasOverride && (
                                        <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/20 px-1.5 py-0.5 text-[10px] font-medium text-warning-foreground">
                                          <Lock className="h-2.5 w-2.5" />
                                          ידני
                                        </span>
                                      )}
                                    </p>
                                    {cell.explanation && (
                                      <p
                                        className={cn(
                                          "text-[11px] leading-snug",
                                          cell.tone
                                            ? TONE_CLASS[cell.tone]
                                            : "",
                                        )}
                                      >
                                        {cell.explanation}
                                      </p>
                                    )}
                                    {cell.performed && (
                                      <p
                                        className={cn(
                                          "flex items-center gap-1 text-[11px]",
                                          cell.performed.met >=
                                            cell.performed.total &&
                                            cell.performed.total > 0
                                            ? "text-success"
                                            : "text-warning-foreground",
                                        )}
                                      >
                                        {cell.performed.met >=
                                          cell.performed.total &&
                                          cell.performed.total > 0 && (
                                            <Check className="h-3 w-3" />
                                          )}
                                        בוצע {cell.performed.met}/
                                        {cell.performed.total}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDialog("next")}
          >
            התחל את הבלוק הבא
          </Button>
          {active && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialog("end")}
            >
              סיים את הבלוק
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            className="text-destructive"
            onClick={() => setDialog("delete")}
          >
            מחק בלוק
          </Button>
        </div>
      )}

      {/* ---- one week */}
      <Modal
        open={weekMenu != null}
        onClose={() => setWeekMenu(null)}
        title={weekMenu ? `שבוע ${weekMenu.index}` : undefined}
      >
        {weekMenu && (
          <div className="space-y-3">
            <Link
              href={builderHref(weekMenu)}
              className={cn(buttonVariants({ variant: "outline" }), "w-full")}
            >
              <Pencil className="h-4 w-4" />
              פתח בבילדר
            </Link>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={
                pending ||
                (weekMenu.status === "draft" && weekMenu.exerciseCount === 0)
              }
              onClick={() =>
                run(() =>
                  setBlockWeekPublished(
                    traineeId,
                    block.id,
                    weekMenu.programId,
                    weekMenu.status !== "published",
                  ),
                )
              }
            >
              {weekMenu.status === "published"
                ? "החזר לטיוטה"
                : "פרסם את השבוע למתאמן"}
            </Button>

            {active && (
              <>
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">דילואד</p>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="week-pct" className="text-xs">
                      % מהשבוע הקודם
                    </Label>
                    <Input
                      id="week-pct"
                      inputMode="numeric"
                      className="h-9 w-20"
                      value={weekPct}
                      onChange={(e) => setWeekPct(e.target.value)}
                    />
                  </div>
                  {weekMenu.index > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={
                        pending ||
                        weekMenu.started ||
                        (!weekMenu.isDeload && parsePct(weekPct) == null)
                      }
                      onClick={() =>
                        run(() =>
                          setBlockWeekDeload(
                            traineeId,
                            block.id,
                            weekMenu.programId,
                            !weekMenu.isDeload,
                            parsePct(weekPct),
                          ),
                        )
                      }
                    >
                      {weekMenu.isDeload
                        ? "הפוך לשבוע רגיל"
                        : "הפוך את השבוע הזה לדילואד"}
                    </Button>
                  )}
                  {weekMenu.isDeload && weekMenu.index > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={
                        pending || weekMenu.started || parsePct(weekPct) == null
                      }
                      onClick={() =>
                        run(() =>
                          setBlockWeekDeload(
                            traineeId,
                            block.id,
                            weekMenu.programId,
                            true,
                            parsePct(weekPct),
                          ),
                        )
                      }
                    >
                      עדכן את האחוז
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={
                      pending ||
                      block.weeksCount >= MAX_BLOCK_WEEKS ||
                      parsePct(weekPct) == null
                    }
                    onClick={() =>
                      run(() =>
                        insertBlockDeload(
                          traineeId,
                          block.id,
                          weekMenu.index,
                          parsePct(weekPct),
                        ),
                      )
                    }
                  >
                    הוסף שבוע דילואד אחרי השבוע הזה
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    הוספת שבוע דילואד דוחה את שאר הבלוק בשבוע. שבוע שהמתאמן כבר
                    התחיל לא זז ולא משתנה.
                  </p>
                </div>

                <div className="space-y-2 rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">המתאמן פספס את השבוע?</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={pending || weekMenu.started}
                    onClick={() =>
                      run(
                        () => shiftBlock(traineeId, block.id, weekMenu.index),
                        `שבוע ${weekMenu.index} והשבועות שאחריו נדחו בשבוע.`,
                      )
                    }
                  >
                    דחה את שבוע {weekMenu.index} והלאה בשבוע אחד
                  </Button>
                </div>
              </>
            )}

            {weekMenu.started && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Snowflake className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                בשבוע הזה כבר יש ביצוע מתועד, ולכן הוא לא זז, לא הופך לדילואד
                ולא מחושב מחדש.
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
      </Modal>

      {/* ---- the block */}
      <Modal
        open={dialog === "settings"}
        onClose={() => setDialog(null)}
        title="הגדרות הבלוק"
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="block-title">שם</Label>
            <Input
              id="block-title"
              value={settings.title}
              maxLength={120}
              onChange={(e) =>
                setSettings({ ...settings, title: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="block-default-pct">
              משקל בדילואד, ברירת מחדל (% מהשבוע הקודם)
            </Label>
            <Input
              id="block-default-pct"
              inputMode="numeric"
              className="w-24"
              value={settings.defaultDeloadPct}
              onChange={(e) =>
                setSettings({ ...settings, defaultDeloadPct: e.target.value })
              }
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-primary"
              checked={settings.autoPublish}
              onChange={(e) =>
                setSettings({ ...settings, autoPublish: e.target.checked })
              }
            />
            <span>
              פרסם אוטומטית כל שבוע כשהוא מתחיל
              <span className="block text-xs text-muted-foreground">
                בלי הסימון, כל שבוע נשאר טיוטה עד שמפרסמים אותו.
              </span>
            </span>
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              const pct = parsePct(settings.defaultDeloadPct);
              if (pct == null) {
                setError(
                  `אחוז הדילואד הוא בין ${MIN_DELOAD_PCT} ל-${MAX_DELOAD_PCT}`,
                );
                return;
              }
              run(() =>
                updateBlockSettings(traineeId, block.id, {
                  title: settings.title,
                  autoPublish: settings.autoPublish,
                  defaultDeloadPct: pct,
                }),
              );
            }}
          >
            {pending ? "שומר…" : "שמור"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={dialog === "end"}
        onClose={() => setDialog(null)}
        title="סיום הבלוק"
      >
        <div className="space-y-3">
          <p className="text-sm">
            אחרי סיום, היעדים של הבלוק כבר לא מחושבים אוטומטית. מה שבוצע נשאר
            בהיסטוריה כמו שהוא.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-primary"
              checked={removeFuture}
              onChange={(e) => setRemoveFuture(e.target.checked)}
            />
            <span>להסיר את השבועות שעוד לא התחילו</span>
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() => endBlock(traineeId, block.id, removeFuture))
              }
            >
              {pending ? "מסיים…" : "סיים את הבלוק"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialog(null)}
            >
              ביטול
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        title="מחיקת בלוק"
      >
        <div className="space-y-3">
          <p className="text-sm">
            למחוק את &quot;{block.title}&quot;? השבועות שעוד לא בוצע בהם כלום
            יימחקו. שבוע שהמתאמן כבר התאמן בו נשאר כתוכנית שבועית רגילה —
            ההיסטוריה לא נמחקת.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                run(() => deleteBlock(traineeId, block.id), undefined, false)
              }
            >
              {pending ? "מוחק…" : "כן, למחוק"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialog(null)}
            >
              ביטול
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={dialog === "next"}
        onClose={() => setDialog(null)}
        title="הבלוק הבא"
      >
        <NextBlockForm
          traineeId={traineeId}
          blockId={block.id}
          suggestedTitle={block.title.replace(/(\d+)\s*$/, (n) =>
            String(Number(n) + 1),
          )}
          onCancel={() => setDialog(null)}
        />
      </Modal>
    </div>
  );
}
