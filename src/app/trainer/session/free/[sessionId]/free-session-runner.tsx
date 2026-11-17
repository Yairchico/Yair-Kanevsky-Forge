"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Replace, Trash2 } from "lucide-react";
import { AddExercisePicker } from "@/components/exercise-editor/add-exercise-picker";
import { SessionFrame } from "@/components/session/session-frame";
import {
  SessionExercisePanel,
  type SessionExerciseData,
} from "@/components/session/session-exercise-panel";
import { Toast, useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CatalogExercise } from "@/lib/exercise-editor-types";
import { formatTime, countExercises, countSets } from "@/lib/format";
import { useSetEntry, type SetEntryApi } from "@/lib/use-set-entry";
import { clearWorkoutDraft, draftKeys } from "@/lib/workout-draft";
import {
  addFreeSessionExercise,
  finishFreeSession,
  logFreeSet,
  removeFreeSessionExercise,
  replaceFreeSessionExercise,
  unlogFreeSet,
  updateFreeSessionLabel,
} from "../actions";

/** The free session's Server Actions behind the shared set-entry state machine. */
const FREE_SET_API: SetEntryApi = { log: logFreeSet, unlog: unlogFreeSet };

type TemplateChoice = "none" | "update" | "new";

/**
 * The live screen of a free session: exercises are picked from the library
 * as the session goes ("+ תרגיל"), or were copied in from a saved workout;
 * each set is saved the moment it's confirmed. "סיים אימון" then asks who it
 * belongs to (optional) and whether to keep it as a saved workout.
 *
 * The exercise list is the server's (the page's props, refreshed by every
 * action) plus whatever this screen has just added/replaced/removed and the
 * server hasn't echoed back yet — so set logging always reconciles against
 * a fresh server copy, the same as on the other set-entry screens.
 */
export function FreeSessionRunner({
  sessionId,
  startedAt,
  initialLabel,
  initialGeneralNote,
  assignedTraineeId,
  traineeName,
  trainees,
  template,
  initialExercises,
  catalog,
}: {
  sessionId: string;
  startedAt: string;
  initialLabel: string;
  initialGeneralNote: string;
  assignedTraineeId: string | null;
  traineeName: string | null;
  trainees: { id: string; name: string }[];
  /** The saved workout this session was started from, if it still exists. */
  template: { id: string; title: string } | null;
  initialExercises: SessionExerciseData[];
  catalog: CatalogExercise[];
}) {
  const router = useRouter();
  const toast = useToast();
  const storageKey = draftKeys.freeSession(sessionId);

  // ---- the exercise list: server copy + local changes not echoed back yet
  const [added, setAdded] = useState<SessionExerciseData[]>([]);
  const [replaced, setReplaced] = useState<Record<string, SessionExerciseData>>({});
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const serverIds = new Set(initialExercises.map((ex) => ex.id));
  const exercises = [
    ...initialExercises.map((ex) => {
      const local = replaced[ex.id];
      return local && local.exerciseId !== ex.exerciseId ? local : ex;
    }),
    ...added.filter((ex) => !serverIds.has(ex.id)),
  ].filter((ex) => !removed.has(ex.id));

  const [extraCatalog, setExtraCatalog] = useState<CatalogExercise[]>([]);
  const fullCatalog = extraCatalog.length ? [...catalog, ...extraCatalog] : catalog;

  const [activeId, setActiveId] = useState<string | null>(() => {
    const firstOpen = initialExercises.find(
      (ex) => ex.plannedSets.length === 0 || ex.loggedSets.length < ex.plannedSets.length,
    );
    return (firstOpen ?? initialExercises[initialExercises.length - 1])?.id ?? null;
  });
  const foundIndex = exercises.findIndex((ex) => ex.id === activeId);
  const activeIndex = foundIndex === -1 ? Math.max(0, exercises.length - 1) : foundIndex;
  const active = exercises[activeIndex];

  /** null = closed; otherwise which row is being replaced (null id = adding a new one). */
  const [picker, setPicker] = useState<{ replaceId: string | null } | null>(() =>
    initialExercises.length === 0 ? { replaceId: null } : null,
  );
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [listPending, startListTransition] = useTransition();
  const [removing, setRemoving] = useState<SessionExerciseData | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [label, setLabel] = useState(initialLabel);
  const [savedLabel, setSavedLabel] = useState(initialLabel);
  const [labelError, setLabelError] = useState<string | null>(null);

  const entry = useSetEntry({
    storageKey,
    exercises,
    api: FREE_SET_API,
    openEnded: true,
    onToast: toast.show,
  });

  // ---- finishing
  const [finishing, setFinishing] = useState<{ minutes: number } | null>(null);
  const [assignTo, setAssignTo] = useState(assignedTraineeId ?? "");
  const [templateChoice, setTemplateChoice] = useState<TemplateChoice>("none");
  const [templateTitle, setTemplateTitle] = useState("");
  const [generalNote, setGeneralNote] = useState(initialGeneralNote);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [finishPending, startFinishTransition] = useTransition();

  let setsLogged = 0;
  let setsPlanned = 0;
  let exercisesPerformed = 0;
  for (const ex of exercises) {
    const count = entry.loggedCountFor(ex);
    setsLogged += count;
    if (count > 0) exercisesPerformed += 1;
    setsPlanned += ex.plannedSets.length;
  }

  // ---- exercise list actions

  function handlePick(exerciseId: string, newExercise?: CatalogExercise) {
    if (listPending || !picker) return;
    if (newExercise) setExtraCatalog((prev) => [...prev, newExercise]);
    const replaceId = picker.replaceId;
    setPickerError(null);
    startListTransition(async () => {
      try {
        const result = replaceId
          ? await replaceFreeSessionExercise(replaceId, exerciseId)
          : await addFreeSessionExercise(sessionId, exerciseId);
        if (result.error || !result.exercise) {
          setPickerError(result.error ?? "שגיאה בהוספת התרגיל");
          return;
        }
        const exercise = result.exercise;
        if (replaceId) {
          entry.forgetExercise(replaceId);
          setReplaced((prev) => ({ ...prev, [replaceId]: exercise }));
        } else {
          setAdded((prev) => [...prev, exercise]);
        }
        setActiveId(exercise.id);
        setPicker(null);
      } catch {
        setPickerError("אין חיבור — נסו שוב בעוד רגע");
      }
    });
  }

  function requestRemove(exercise: SessionExerciseData) {
    setRemoveError(null);
    setRemoving(exercise);
  }

  function handleRemove() {
    const exercise = removing;
    if (!exercise || listPending) return;
    startListTransition(async () => {
      try {
        const result = await removeFreeSessionExercise(exercise.id, { discardLoggedSets: true });
        if (result.error) {
          setRemoveError(result.error);
          return;
        }
        entry.forgetExercise(exercise.id);
        setRemoved((prev) => new Set(prev).add(exercise.id));
        setRemoving(null);
      } catch {
        setRemoveError("אין חיבור — נסו שוב בעוד רגע");
      }
    });
  }

  function saveLabel() {
    const next = label.trim();
    if (next === savedLabel.trim()) return;
    setLabelError(null);
    void updateFreeSessionLabel(sessionId, next)
      .then((result) => {
        if (result.error) setLabelError(result.error);
        else setSavedLabel(result.guestLabel ?? "");
      })
      .catch(() => setLabelError("אין חיבור — השם לא נשמר"));
  }

  // ---- finish

  function openFinish() {
    setFinishError(null);
    setFinishing({ minutes: Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 60000)) });
  }

  function handleFinish() {
    setFinishError(null);
    startFinishTransition(async () => {
      const stillPending = await entry.flushPending();
      if (stillPending > 0) {
        setFinishError("יש סטים שעדיין לא נשמרו (אין חיבור). נסו שוב כשהחיבור יחזור.");
        return;
      }
      if (templateChoice === "new" && !templateTitle.trim()) {
        setFinishError("יש לתת שם לאימון השמור");
        return;
      }
      try {
        const result = await finishFreeSession(sessionId, {
          notes: entry.getNotes().map((n) => ({ sessionExerciseId: n.exerciseId, notes: n.notes })),
          generalNote: generalNote.trim() || null,
          traineeId: assignTo || null,
          saveAsTemplateTitle: templateChoice === "new" ? templateTitle.trim() : null,
          updateTemplate: templateChoice === "update",
        });
        if (result.error) {
          setFinishError(result.error);
          return;
        }
        // Finished: the page now renders this session's summary instead of
        // this screen (a session with nothing performed was discarded, and
        // the action redirected to the picker instead of returning).
        clearWorkoutDraft(storageKey);
        const url = `/trainer/session/free/${sessionId}`;
        router.replace(result.templateFailed ? `${url}?template=failed` : url);
      } catch {
        setFinishError("אין חיבור — נסו שוב בעוד רגע");
      }
    });
  }

  const title = traineeName ?? (savedLabel.trim() || "אימון חופשי");
  const subtitle = [
    "אימון חופשי",
    traineeName ? null : "ללא מתאמן",
    `התחיל ${formatTime(startedAt)}`,
    template ? `מתוך "${template.title}"` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const activeLoggedCount = active ? entry.loggedCountFor(active) : 0;
  const removingLoggedCount = removing ? entry.loggedCountFor(removing) : 0;

  return (
    <>
      <SessionFrame
        backHref="/trainer/session"
        title={title}
        subtitle={subtitle}
        chips={exercises.map((ex) => {
          const count = entry.loggedCountFor(ex);
          return {
            id: ex.id,
            label: ex.name,
            done: ex.plannedSets.length > 0 ? count >= ex.plannedSets.length : count > 0,
          };
        })}
        activeIndex={activeIndex}
        onSelect={(index) => setActiveId(exercises[index]?.id ?? null)}
        onAddExercise={() => {
          setPickerError(null);
          setPicker({ replaceId: null });
        }}
        setsLogged={setsLogged}
        setsTotal={setsPlanned > 0 ? Math.max(setsPlanned, setsLogged) : null}
        pendingCount={entry.pendingCount}
        onRetryPending={() => void entry.flushPending()}
        onFinish={openFinish}
      >
        <div className="space-y-1">
          <Label htmlFor="free-session-label" className="text-sm">
            שם או כינוי <span className="font-normal text-muted-foreground">(אופציונלי)</span>
          </Label>
          <Input
            id="free-session-label"
            value={label}
            maxLength={80}
            placeholder="לדוגמה: אורח, אימון ניסיון"
            onChange={(e) => setLabel(e.target.value)}
            onBlur={saveLabel}
          />
          {labelError && <p className="text-sm text-destructive">{labelError}</p>}
        </div>

        {active ? (
          <SessionExercisePanel
            key={`${active.id}:${active.exerciseId}`}
            exercise={active}
            entry={entry}
            actions={
              <>
                {activeLoggedCount === 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPickerError(null);
                      setPicker({ replaceId: active.id });
                    }}
                  >
                    <Replace className="h-4 w-4" />
                    החלף
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`הסר את ${active.name} מהאימון`}
                  onClick={() => requestRemove(active)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            }
          />
        ) : (
          <div className="space-y-3 rounded-md border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">
              עדיין אין תרגילים באימון. בחרו תרגיל מהספרייה כדי להתחיל.
            </p>
            <Button type="button" onClick={() => setPicker({ replaceId: null })}>
              הוספת תרגיל
            </Button>
          </div>
        )}
      </SessionFrame>

      <Modal
        open={picker != null}
        onClose={() => setPicker(null)}
        title={picker?.replaceId ? "החלפת תרגיל" : "הוספת תרגיל לאימון"}
      >
        <div className={listPending ? "pointer-events-none opacity-60" : undefined}>
          <AddExercisePicker plain exercises={fullCatalog} onAdd={handlePick} />
        </div>
        {listPending && <p className="pt-2 text-sm text-muted-foreground">מוסיף…</p>}
        {pickerError && <p className="pt-2 text-sm text-destructive">{pickerError}</p>}
      </Modal>

      <Modal open={removing != null} onClose={() => setRemoving(null)} title="הסרת תרגיל מהאימון">
        <div className="space-y-3">
          <p className="text-sm">
            להסיר את &quot;{removing?.name}&quot; מהאימון?
            {removingLoggedCount > 0 && (
              <span className="font-medium text-destructive">
                {" "}
                {removingLoggedCount === 1 ? "סט אחד שכבר נרשם בו יימחק." : `${removingLoggedCount} סטים שכבר נרשמו בו יימחקו.`}
              </span>
            )}
          </p>
          {removeError && <p className="text-sm text-destructive">{removeError}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="destructive" onClick={handleRemove} disabled={listPending}>
              {listPending ? "מסיר…" : "כן, להסיר"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setRemoving(null)}>
              ביטול
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={finishing != null} onClose={() => setFinishing(null)} title="סיום אימון חופשי">
        {setsLogged === 0 ? (
          <div className="space-y-3">
            <p className="text-sm">לא נרשם אף סט באימון הזה, ולכן הוא לא יישמר.</p>
            {finishError && <p className="text-sm text-destructive">{finishError}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="destructive" onClick={handleFinish} disabled={finishPending}>
                {finishPending ? "סוגר…" : "סגור בלי לשמור"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setFinishing(null)}>
                חזרה לאימון
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {countExercises(exercisesPerformed)} · {countSets(setsLogged)}
              {finishing && finishing.minutes > 0 && finishing.minutes <= 360 ? ` · ${finishing.minutes} דק׳` : ""}
            </p>

            <div className="space-y-1">
              <Label htmlFor="free-session-assign">
                לשייך למתאמן? <span className="font-normal text-muted-foreground">(אופציונלי)</span>
              </Label>
              <Select id="free-session-assign" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                <option value="">לא לשייך, לשמור כאימון חופשי</option>
                {trainees.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                שיוך מוסיף את האימון להיסטוריה של המתאמן, אבל לא לתוכנית השבועית שלו ולא לקפיצות של בלוק.
              </p>
            </div>

            <div className="space-y-2">
              {template && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-primary"
                    checked={templateChoice === "update"}
                    onChange={(e) => setTemplateChoice(e.target.checked ? "update" : "none")}
                  />
                  <span>
                    עדכן את האימון השמור &quot;{template.title}&quot; לפי מה שבוצע היום
                    <span className="block text-xs text-muted-foreground">
                      הסטים שבוצעו יחליפו את היעדים של אותם תרגילים. תרגילים שלא בוצעו נשארים כמו שהם.
                    </span>
                  </span>
                </label>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={templateChoice === "new"}
                  onChange={(e) => setTemplateChoice(e.target.checked ? "new" : "none")}
                />
                <span>
                  שמור גם כאימון שמור {template ? "חדש " : ""}(תבנית לשימוש חוזר)
                  <span className="block text-xs text-muted-foreground">
                    התרגילים והסטים שבוצעו יישמרו כיעדים. אפשר לערוך אחר כך ב&quot;אימונים שמורים&quot;.
                  </span>
                </span>
              </label>
              {templateChoice === "new" && (
                <Input
                  aria-label="שם האימון השמור"
                  value={templateTitle}
                  maxLength={120}
                  placeholder="שם האימון השמור"
                  onChange={(e) => setTemplateTitle(e.target.value)}
                />
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="free-session-note">הערה כללית</Label>
              <Textarea
                id="free-session-note"
                value={generalNote}
                maxLength={2000}
                onChange={(e) => setGeneralNote(e.target.value)}
                className="min-h-16"
              />
            </div>

            {finishError && <p className="text-sm text-destructive">{finishError}</p>}

            <Button type="button" size="lg" className="w-full" onClick={handleFinish} disabled={finishPending}>
              {finishPending ? "שומר…" : "שמור וסיים"}
            </Button>
          </div>
        )}
      </Modal>

      <Toast message={toast.message} />
    </>
  );
}
