"use client";

import { useMemo, useState, useTransition } from "react";
import { Play, Trash2 } from "lucide-react";
import {
  ExerciseListEditor,
  type InitialEditorItem,
} from "@/components/exercise-editor/exercise-list-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CatalogExercise, ExerciseListApi } from "@/lib/exercise-editor-types";
import { StartTemplateModal, type TraineeOption } from "../../start-template-modal";
import {
  addTemplateExercise,
  addTemplateSet,
  deleteTemplate,
  deleteTemplateExercise,
  deleteTemplateSet,
  duplicateTemplateExercise,
  reorderTemplateExercises,
  updateTemplateDetails,
  updateTemplateExercise,
  updateTemplateSet,
} from "../actions";

/**
 * A saved workout, edited with the very same exercise/set editor as the
 * weekly program builder (src/components/exercise-editor) — only "saving"
 * differs, and there are no days, no publishing and no progression here.
 * The name and note save when the field is left.
 */
export function TemplateEditor({
  readOnly,
  template,
  initialItems,
  catalog,
  trainees,
}: {
  readOnly: boolean;
  template: { id: string; title: string; notes: string | null };
  initialItems: InitialEditorItem[];
  catalog: CatalogExercise[];
  trainees: TraineeOption[];
}) {
  const templateId = template.id;
  const api = useMemo<ExerciseListApi>(
    () => ({
      addExercise: (exerciseId) => addTemplateExercise(templateId, exerciseId),
      deleteExercise: (id) => deleteTemplateExercise(id),
      duplicateExercise: (id) => duplicateTemplateExercise(id),
      reorder: (ids) => reorderTemplateExercises(templateId, ids),
      updateFields: (id, fields) => updateTemplateExercise(id, fields),
      addSet: (id) => addTemplateSet(id),
      updateSet: (setId, fields) => updateTemplateSet(setId, fields),
      deleteSet: (setId) => deleteTemplateSet(setId),
    }),
    [templateId],
  );

  const [title, setTitle] = useState(template.title);
  const [notes, setNotes] = useState(template.notes ?? "");
  const [saved, setSaved] = useState({ title: template.title, notes: template.notes ?? "" });
  const [detailsState, setDetailsState] = useState<{ error?: string; savedNow?: boolean }>({});
  const [extraCatalog, setExtraCatalog] = useState<CatalogExercise[]>([]);
  const fullCatalog = extraCatalog.length ? [...catalog, ...extraCatalog] : catalog;

  const [starting, setStarting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function saveDetails() {
    const next = { title: title.trim(), notes: notes.trim() };
    if (next.title === saved.title.trim() && next.notes === saved.notes.trim()) return;
    if (!next.title) {
      setDetailsState({ error: "יש לתת שם לאימון השמור" });
      return;
    }
    void updateTemplateDetails(templateId, { title: next.title, notes: next.notes || null })
      .then((result) => {
        if (result.error) {
          setDetailsState({ error: result.error });
          return;
        }
        setSaved(next);
        setDetailsState({ savedNow: true });
      })
      .catch(() => setDetailsState({ error: "אין חיבור — השינוי לא נשמר" }));
  }

  function handleDelete() {
    setDeleteError(null);
    startTransition(async () => {
      try {
        // Redirects to the list on success.
        const result = await deleteTemplate(templateId);
        if (result?.error) setDeleteError(result.error);
      } catch {
        setDeleteError("אין חיבור — נסו שוב בעוד רגע");
      }
    });
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          {readOnly ? (
            <>
              <h1 className="text-xl font-bold">{template.title}</h1>
              {template.notes && <p className="text-sm whitespace-pre-line">{template.notes}</p>}
            </>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="template-title">שם</Label>
                <Input
                  id="template-title"
                  value={title}
                  maxLength={120}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setDetailsState({});
                  }}
                  onBlur={saveDetails}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="template-notes">
                  הערה <span className="font-normal text-muted-foreground">(אופציונלי)</span>
                </Label>
                <Textarea
                  id="template-notes"
                  value={notes}
                  maxLength={1000}
                  className="min-h-16"
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setDetailsState({});
                  }}
                  onBlur={saveDetails}
                />
              </div>
              {detailsState.error && <p className="text-sm text-destructive">{detailsState.error}</p>}
              {detailsState.savedNow && <p className="text-sm text-success">נשמר ✓</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => setStarting(true)}>
                  <Play className="h-4 w-4" />
                  התחל אימון
                </Button>
                {!confirmingDelete && (
                  <Button type="button" variant="outline" onClick={() => setConfirmingDelete(true)}>
                    <Trash2 className="h-4 w-4" />
                    מחיקה
                  </Button>
                )}
              </div>
              {confirmingDelete && (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-destructive">
                    למחוק את האימון השמור? אימונים שכבר נעשו ממנו נשארים בהיסטוריה.
                  </p>
                  <div className="flex gap-2">
                    <Button type="button" variant="destructive" onClick={handleDelete} disabled={pending}>
                      {pending ? "מוחק…" : "כן, למחוק"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setConfirmingDelete(false)}>
                      ביטול
                    </Button>
                  </div>
                </div>
              )}
              {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
            </>
          )}
        </CardContent>
      </Card>

      <ExerciseListEditor
        listId={`template-${templateId}`}
        api={api}
        initialItems={initialItems}
        catalog={fullCatalog}
        readOnly={readOnly}
        emptyText={
          readOnly ? "אין תרגילים באימון השמור הזה." : "אין עדיין תרגילים. הוסף תרגיל מהרשימה למטה."
        }
        onNewExercise={(exercise) => setExtraCatalog((prev) => [...prev, exercise])}
      />

      {!readOnly && (
        <StartTemplateModal
          key={starting ? "open" : "closed"}
          template={starting ? { id: templateId, title: saved.title } : null}
          trainees={trainees}
          onClose={() => setStarting(false)}
        />
      )}
    </div>
  );
}
