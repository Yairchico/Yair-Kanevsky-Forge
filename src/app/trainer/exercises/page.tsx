import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { getRequestAuth } from "@/lib/viewer";
import { ExerciseLibrary } from "./exercise-library";

export default async function ExercisesPage() {
  const { supabase, viewer } = await getRequestAuth();
  const [me, { data: exercises }] = await Promise.all([
    viewer,
    supabase
      .from("exercises")
      .select("id, name, muscle_group, equipment, is_custom, media_url, instructions, video_url, video_storage_path")
      .order("name"),
  ]);
  const readOnly = me?.isSuperadmin === true;

  return (
    <AppShell title="ספריית תרגילים" backHref="/trainer" readOnly={readOnly}>
      {!readOnly && (
        <div className="flex justify-end">
          <Link href="/trainer/exercises/new" className={buttonVariants({})}>
            + תרגיל מותאם אישית
          </Link>
        </div>
      )}
      <ExerciseLibrary exercises={exercises ?? []} readOnly={readOnly} />
    </AppShell>
  );
}
