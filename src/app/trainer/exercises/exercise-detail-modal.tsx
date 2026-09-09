"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Dumbbell, ImageOff, ImagePlus, Pencil } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { MUSCLE_GROUPS } from "@/lib/exercise-constants";
import { getExerciseImage } from "@/lib/exercise-image";
import {
  updateExerciseDetails,
  updateExerciseImage,
  type UpdateExerciseDetailsState,
  type UpdateExerciseImageState,
} from "./actions";

interface Exercise {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  is_custom: boolean;
  media_url: string | null;
}

const initialDetailsState: UpdateExerciseDetailsState = {};
const initialImageState: UpdateExerciseImageState = {};

/**
 * The exercise-detail popup, opened by clicking a card in the exercise
 * library grid: name/muscle-group/equipment on one side (read-only until
 * "עריכה" is clicked — see updateExerciseDetails), the exercise's image
 * shown at a real size on the other, with its own independent
 * add/replace/delete controls (updateExerciseImage). `readOnly` (the
 * superadmin oversight account, src/lib/viewer.ts) hides every mutation
 * control and leaves just the read-only detail view — same pattern as
 * everywhere else in the trainer area, see CLAUDE.md's "Superadmin"
 * section.
 */
export function ExerciseDetailModal({
  exercise,
  readOnly = false,
  onClose,
}: {
  exercise: Exercise;
  readOnly?: boolean;
  onClose: () => void;
}) {
  // ---- name / muscle group / equipment ----
  const [editingFields, setEditingFields] = useState(false);
  const detailsAction = updateExerciseDetails.bind(null, exercise.id);
  const [detailsState, detailsFormAction, detailsPending] = useActionState(
    detailsAction,
    initialDetailsState,
  );
  const [prevDetailsState, setPrevDetailsState] = useState(detailsState);
  if (detailsState !== prevDetailsState) {
    setPrevDetailsState(detailsState);
    if (detailsState.success && editingFields) setEditingFields(false);
  }

  // ---- image ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | undefined>();

  const imageAction = updateExerciseImage.bind(null, exercise.id);
  const [imageState, imageFormAction, imagePending] = useActionState(imageAction, initialImageState);
  const [prevImageState, setPrevImageState] = useState(imageState);
  if (imageState !== prevImageState) {
    setPrevImageState(imageState);
    if (imageState.success) clearPendingFile();
  }

  function clearPendingFile() {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
  }

  function handleDeleteImage() {
    startDeleteTransition(async () => {
      // Empty FormData: no "image_file" — resolveMediaUrl resolves that to
      // { mediaUrl: null }, i.e. clears the image.
      const result = await updateExerciseImage(exercise.id, initialImageState, new FormData());
      if (result.error) {
        setDeleteError(result.error);
        setConfirmingDelete(false);
      }
    });
  }

  const displaySrc = previewUrl ?? getExerciseImage(exercise);

  return (
    <Modal open onClose={onClose} title={exercise.name} className="max-w-lg">
      <div className="flex flex-col-reverse gap-5 sm:flex-row">
        <div className="min-w-0 flex-1 space-y-3">
          {editingFields ? (
            <form action={detailsFormAction} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="edit-exercise-name">שם התרגיל</Label>
                <Input id="edit-exercise-name" name="name" defaultValue={exercise.name} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-exercise-muscle">קבוצת שרירים</Label>
                <Select
                  id="edit-exercise-muscle"
                  name="muscle_group"
                  defaultValue={exercise.muscle_group ?? ""}
                >
                  <option value="">—</option>
                  {MUSCLE_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-exercise-equipment">ציוד</Label>
                <Input
                  id="edit-exercise-equipment"
                  name="equipment"
                  defaultValue={exercise.equipment ?? ""}
                />
              </div>
              {detailsState.error && (
                <p className="text-sm text-destructive">{detailsState.error}</p>
              )}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={detailsPending}>
                  {detailsPending ? "שומר…" : "שמור"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setEditingFields(false)}
                >
                  ביטול
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="space-y-1">
                <p className="flex items-center gap-2 text-lg font-semibold">
                  {exercise.name}
                  {exercise.is_custom && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-normal whitespace-nowrap text-secondary-foreground">
                      מותאם
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {[exercise.muscle_group, exercise.equipment].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
              {!readOnly && (
                <Button type="button" size="sm" variant="outline" onClick={() => setEditingFields(true)}>
                  <Pencil className="h-3.5 w-3.5" />
                  עריכה
                </Button>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-center gap-2 sm:w-44">
          <div className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-xl bg-primary/10">
            {displaySrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- media_url can be any external host
              <img src={displaySrc} alt={exercise.name} className="h-full w-full object-cover" />
            ) : (
              <Dumbbell className="h-1/3 w-1/3 text-primary" />
            )}
          </div>

          {!readOnly && (
            <form action={imageFormAction} className="w-full">
              <input
                ref={fileInputRef}
                type="file"
                name="image_file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />

              {previewUrl ? (
                <div className="flex gap-1.5">
                  <Button type="submit" size="sm" className="flex-1" disabled={imagePending}>
                    {imagePending ? "מעלה…" : "העלה"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={clearPendingFile}>
                    בטל
                  </Button>
                </div>
              ) : confirmingDelete ? (
                <div className="flex items-center justify-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">למחוק את התמונה?</span>
                  <button
                    type="button"
                    onClick={handleDeleteImage}
                    disabled={deletePending}
                    className="font-medium text-destructive hover:underline"
                  >
                    {deletePending ? "מוחק…" : "כן"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="text-muted-foreground hover:underline"
                  >
                    לא
                  </button>
                </div>
              ) : displaySrc ? (
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    החלף תמונה
                  </Button>
                  {/* Deleting only makes sense when this exercise actually
                      has its own media_url set — a base exercise showing
                      its seed-matched default photo (src/lib/exercise-image.ts)
                      has nothing to clear, since that default isn't stored
                      on the row at all. */}
                  {exercise.media_url && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label="מחק תמונה"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      <ImageOff className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  הוסף תמונה
                </Button>
              )}

              {imageState.error && <p className="mt-1.5 text-xs text-destructive">{imageState.error}</p>}
              {deleteError && <p className="mt-1.5 text-xs text-destructive">{deleteError}</p>}
            </form>
          )}
        </div>
      </div>
    </Modal>
  );
}
