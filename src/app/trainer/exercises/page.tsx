import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { isReadOnlyViewer } from "@/lib/viewer";
import { ExerciseLibrary } from "./exercise-library";

export default async function ExercisesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const readOnly = user ? await isReadOnlyViewer(supabase, user.id) : false;

  const { data: exercises } = await supabase
    .from("exercises")
    .select("id, name, muscle_group, equipment, is_custom, media_url")
    .order("name");

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
