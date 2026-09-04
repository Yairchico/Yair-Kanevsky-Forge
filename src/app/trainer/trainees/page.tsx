import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default async function TraineesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("profiles")
    .select("id, full_name, email, phone, status, created_at")
    .eq("role", "trainee")
    .order("created_at", { ascending: false });

  if (q) query = query.ilike("full_name", `%${q}%`);

  const { data: trainees } = await query;

  return (
    <AppShell title="מתאמנים" backHref="/trainer">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <form className="flex-1 sm:max-w-xs">
          <Input name="q" defaultValue={q ?? ""} placeholder="חיפוש לפי שם…" />
        </form>
        <Link href="/trainer/trainees/new" className={buttonVariants({})}>
          + מתאמן חדש
        </Link>
      </div>

      {!trainees?.length ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {q ? (
              <>לא נמצאו מתאמנים עבור &quot;{q}&quot;.</>
            ) : (
              <>
                עדיין אין מתאמנים.{" "}
                <Link
                  href="/trainer/trainees/new"
                  className="text-primary underline underline-offset-4"
                >
                  הוסף מתאמן ראשון
                </Link>
                .
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {trainees.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-4">
                <p className="font-medium">{t.full_name}</p>
                {t.email && (
                  <p className="text-sm text-muted-foreground">{t.email}</p>
                )}
                {t.phone && (
                  <p className="text-sm text-muted-foreground">{t.phone}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
