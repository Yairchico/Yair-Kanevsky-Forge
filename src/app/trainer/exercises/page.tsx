import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { ExerciseLibrary } from "./exercise-library";

export default async function ExercisesPage() {
  const supabase = await createClient();

  const { data: exercises } = await supabase
    .from("exercises")
    .select("id, name, muscle_group, equipment, is_custom")
    .order("name");

  return (
    <AppShell title="ספריית תרגילים" backHref="/trainer">
      <div className="flex justify-end">
        <Link href="/trainer/exercises/new" className={buttonVariants({})}>
          + תרגיל מותאם אישית
        </Link>
      </div>
      <ExerciseLibrary exercises={exercises ?? []} />
    </AppShell>
  );
}
