"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Dumbbell, ImageOff, ImagePlus, Pencil, Pin, Play, Upload } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ExerciseVideo } from "@/components/exercise-video";
import { MUSCLE_GROUPS } from "@/lib/exercise-constants";
import { getExerciseImage } from "@/lib/exercise-image";
import { cn } from "@/lib/utils";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { MAX_VIDEO_BYTES, VIDEO_BUCKET, VIDEO_UPLOAD_TYPES, playableVideoUrl } from "@/lib/video";
import {
  confirmVideoUpload,
  createVideoUpload,
  discardVideoUpload,
  updateExerciseDetails,
  updateExerciseImage,
  updateExerciseVideo,
  type UpdateExerciseDetailsState,
  type UpdateExerciseImageState,
  type UpdateExerciseVideoState,
} from "./actions";

interface Exercise {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  is_custom: boolean;
  media_url: string | null;
  instructions: string | null;
  video_url: string | null;
  video_storage_path: string | null;
}

const initialDetailsState: UpdateExerciseDetailsState = {};
const initialImageState: UpdateExerciseImageState = {};
const initialVideoState: UpdateExerciseVideoState = {};

type VideoTab = "link" | "upload";

/** iOS sometimes hands over a .mov with no type; go by the extension then. */
function videoTypeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : ext === "mp4" ? "video/mp4" : "";
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * The exercise's demo video: a link (YouTube, Vimeo or a direct file; see
 * src/lib/video.ts) or a file uploaded from the phone (migration 0019).
 * Uploading goes from the browser straight to Storage with a one-time URL
 * the server hands out (createVideoUpload) — a 50MB file can't go through a
 * Server Action — and the server then attaches it (confirmVideoUpload).
 * Either kind replaces the other; "הסר" clears whichever there is.
 */
function VideoSection({ exercise, readOnly }: { exercise: Exercise; readOnly: boolean }) {
  const action = updateExerciseVideo.bind(null, exercise.id);
  const [state, formAction, pending] = useActionState(action, initialVideoState);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<VideoTab>("upload");
  const [removePending, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | undefined>();
  const [upload, setUpload] = useState<{ name: string; size: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const playable = playableVideoUrl(exercise);
  const uploaded = Boolean(exercise.video_storage_path);

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success && editing) setEditing(false);
  }

  function handleRemove() {
    startRemove(async () => {
      // An empty "video_url" clears the link and any uploaded file.
      const result = await updateExerciseVideo(exercise.id, initialVideoState, new FormData());
      setRemoveError(result.error);
    });
  }

  async function handleFile(file: File) {
    setUploadError(null);
    const type = videoTypeOf(file);
    if (!VIDEO_UPLOAD_TYPES[type]) {
      setUploadError("אפשר להעלות סרטון מסוג MP4, MOV או WebM");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setUploadError(`הסרטון גדול מדי (${formatMb(file.size)}, עד 50MB). נסו סרטון קצר יותר, 15–30 שניות.`);
      return;
    }
    setUpload({ name: file.name, size: file.size });
    let path: string | null = null;
    try {
      const ticket = await createVideoUpload(exercise.id, { type, size: file.size });
      if ("error" in ticket) {
        setUploadError(ticket.error);
        return;
      }
      path = ticket.path;
      const { error } = await createBrowserClient()
        .storage.from(VIDEO_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: type });
      if (error) {
        setUploadError("ההעלאה נכשלה. בדקו את החיבור ונסו שוב.");
        return;
      }
      const result = await confirmVideoUpload(exercise.id, ticket.path);
      if (result.error) {
        setUploadError(result.error);
        void discardVideoUpload(exercise.id, ticket.path);
        return;
      }
      path = null;
      setEditing(false);
    } catch {
      setUploadError("ההעלאה נכשלה. בדקו את החיבור ונסו שוב.");
      if (path) void discardVideoUpload(exercise.id, path).catch(() => {});
    } finally {
      setUpload(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  if (readOnly && !playable) return null;

  const tabClass = (active: boolean) =>
    cn(
      "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
      active ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Play className="h-3.5 w-3.5" />
        סרטון הדגמה
      </p>

      {playable && !editing && (
        <>
          {/* Keyed by the source so a replaced video doesn't keep the old player mounted. */}
          <ExerciseVideo key={playable} url={playable} title={exercise.name} />
          {uploaded && <p className="text-xs text-muted-foreground">סרטון שהועלה מהמכשיר</p>}
          {!readOnly && (
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" />
                החלף סרטון
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleRemove}
                disabled={removePending}
                className="text-destructive"
              >
                {removePending ? "מסיר…" : "הסר סרטון"}
              </Button>
            </div>
          )}
          {removeError && <p className="text-xs text-destructive">{removeError}</p>}
        </>
      )}

      {!readOnly && (!playable || editing) && (
        <div className="space-y-2">
          <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "upload"} className={tabClass(tab === "upload")} onClick={() => setTab("upload")}>
              העלאה מהמכשיר
            </button>
            <button type="button" role="tab" aria-selected={tab === "link"} className={tabClass(tab === "link")} onClick={() => setTab("link")}>
              קישור
            </button>
          </div>

          {tab === "upload" ? (
            <div className="space-y-2">
              <input
                ref={fileInput}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                aria-label="קובץ סרטון"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={upload !== null}
                onClick={() => fileInput.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                {upload ? "מעלה…" : "בחירת סרטון"}
              </Button>
              {upload && (
                <p className="text-xs text-muted-foreground">
                  מעלה את {upload.name} ({formatMb(upload.size)}). זה יכול לקחת כמה רגעים — אל תסגרו את החלון.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                MP4, MOV או WebM, עד 50MB. סרטון קצר (15–30 שניות) עולה מהר יותר וחוסך למתאמנים גלישה.
              </p>
              {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            </div>
          ) : (
            <form action={formAction} className="space-y-2">
              <Input
                name="video_url"
                dir="ltr"
                inputMode="url"
                placeholder="https://youtu.be/…"
                defaultValue={exercise.video_url ?? ""}
                aria-label="קישור לסרטון"
              />
              <p className="text-xs text-muted-foreground">
                YouTube (גם Shorts וסרטון &quot;לא רשום&quot;), Vimeo, או קישור ישיר לקובץ mp4. המתאמן רואה
                את הסרטון כשהוא מבצע את התרגיל.
              </p>
              {state.error && <p className="text-xs text-destructive">{state.error}</p>}
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "שומר…" : "שמור קישור"}
              </Button>
            </form>
          )}

          {editing && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={upload !== null}>
              ביטול
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

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
      <div className="flex flex-col-reverse gap-5 pb-4 sm:flex-row">
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
              <div className="space-y-1">
                <Label htmlFor="edit-exercise-note">הערה קבועה</Label>
                <Textarea
                  id="edit-exercise-note"
                  name="instructions"
                  defaultValue={exercise.instructions ?? ""}
                  maxLength={1000}
                  placeholder="דגשים לביצוע — יופיעו בכל תוכנית שהתרגיל נמצא בה"
                  className="min-h-20"
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
              <div className="space-y-1 rounded-lg bg-muted/60 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Pin className="h-3 w-3" />
                  הערה קבועה
                </p>
                {exercise.instructions ? (
                  <p className="text-sm leading-relaxed whitespace-pre-line">{exercise.instructions}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    אין עדיין. הערה קבועה מופיעה בכל תוכנית שהתרגיל נמצא בה, אצל כל המתאמנים.
                  </p>
                )}
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
          {/* Tapping the image itself is a second, more direct way to edit
              an image that already exists (default or uploaded) — on top
              of the "החלף תמונה" button below, which stays the one clear
              entry point when there's no image yet. Disabled mid-action
              (a file is already staged, or the delete confirm is showing)
              so it can't be mistaken for a way to dismiss those. */}
          <div
            role={!readOnly && displaySrc && !previewUrl && !confirmingDelete ? "button" : undefined}
            tabIndex={!readOnly && displaySrc && !previewUrl && !confirmingDelete ? 0 : undefined}
            onClick={
              !readOnly && displaySrc && !previewUrl && !confirmingDelete
                ? () => fileInputRef.current?.click()
                : undefined
            }
            onKeyDown={
              !readOnly && displaySrc && !previewUrl && !confirmingDelete
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }
                : undefined
            }
            className={cn(
              "relative flex h-40 w-40 items-center justify-center overflow-hidden rounded-xl bg-primary/10",
              !readOnly && displaySrc && !previewUrl && !confirmingDelete && "cursor-pointer",
            )}
          >
            {displaySrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- media_url can be any external host
              <img src={displaySrc} alt={exercise.name} className="h-full w-full object-cover" />
            ) : (
              <Dumbbell className="h-1/3 w-1/3 text-primary" />
            )}
            {!readOnly && displaySrc && !previewUrl && !confirmingDelete && (
              <span
                aria-hidden="true"
                className="absolute bottom-1.5 end-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"
              >
                <Pencil className="h-3.5 w-3.5" />
              </span>
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

      <VideoSection exercise={exercise} readOnly={readOnly} />
    </Modal>
  );
}
