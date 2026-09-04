import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MUSCLE_GROUPS } from "@/lib/exercise-constants";
import { cn } from "@/lib/utils";

export default async function ExercisesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; group?: string }>;
}) {
  const { q, group } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("exercises")
    .select("id, name, muscle_group, equipment, is_custom")
    .order("name");

  if (q) query = query.ilike("name", `%${q}%`);
  if (group) query = query.eq("muscle_group", group);

  const { data: exercises } = await query;

  return (
    <AppShell title="ספריית תרגילים" backHref="/trainer">
      <div className="flex flex-wrap gap-2">
        {["הכל", ...MUSCLE_GROUPS].map((g) => {
          const isAll = g === "הכל";
          const active = isAll ? !group : group === g;
          const params = new URLSearchParams();
          if (q) params.set("q", q);
          if (!isAll) params.set("group", g);
          const href = `/trainer/exercises${params.size ? `?${params}` : ""}`;

          return (
            <Link
              key={g}
              href={href}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-muted",
              )}
            >
              {g}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <form className="flex-1 sm:max-w-xs">
          <input type="hidden" name="group" value={group ?? ""} />
          <Input name="q" defaultValue={q ?? ""} placeholder="חיפוש תרגיל…" />
        </form>
        <Link href="/trainer/exercises/new" className={buttonVariants({})}>
          + תרגיל מותאם אישית
        </Link>
      </div>

      {!exercises?.length ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {q || group ? "לא נמצאו תרגילים תואמים." : "אין תרגילים בספרייה."}
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
