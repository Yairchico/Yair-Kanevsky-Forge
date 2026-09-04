import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default async function ExercisesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("exercises")
    .select("id, name, muscle_group, equipment, is_custom")
    .order("name");

  if (q) query = query.ilike("name", `%${q}%`);

  const { data: exercises } = await query;

  return (
    <AppShell title="ספריית תרגילים">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <form className="flex-1 sm:max-w-xs">
          <Input name="q" defaultValue={q ?? ""} placeholder="חיפוש תרגיל…" />
        </form>
        <Link href="/trainer/exercises/new" className={buttonVariants({})}>
          + תרגיל מותאם אישית
        </Link>
      </div>

      {!exercises?.length ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {q ? <>לא נמצאו תרגילים עבור &quot;{q}&quot;.</> : "אין תרגילים בספרייה."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {exercises.map((ex) => (
            <Card key={ex.id}>
              <CardContent className="flex items-start justify-between gap-2 p-4">
                <div>
                  <p className="font-medium">{ex.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {[ex.muscle_group, ex.equipment].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {ex.is_custom && (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs whitespace-nowrap text-secondary-foreground">
                    מותאם
                  </span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
