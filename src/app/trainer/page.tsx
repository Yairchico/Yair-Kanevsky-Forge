import Link from "next/link";
import { ArrowLeft, Dumbbell, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";

export default async function TrainerHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { count: traineeCount }, { count: exerciseCount }] =
    await Promise.all([
      user
        ? supabase.from("profiles").select("username").eq("id", user.id).single()
        : Promise.resolve({ data: null }),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "trainee"),
      supabase.from("exercises").select("id", { count: "exact", head: true }),
    ]);

  return (
    <AppShell title="אזור מאמן" username={profile?.username}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/trainer/trainees">
          <Card className="h-full transition-shadow hover:shadow-sm">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Users className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">מתאמנים</p>
                <p className="text-sm text-muted-foreground">
                  {traineeCount ?? 0} מתאמנים · הוספה, עריכה ותוכניות
                </p>
              </div>
              <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>

        <Link href="/trainer/exercises">
          <Card className="h-full transition-shadow hover:shadow-sm">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Dumbbell className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">ספריית תרגילים</p>
                <p className="text-sm text-muted-foreground">
                  {exerciseCount ?? 0} תרגילים · חיפוש והוספת תרגיל
                </p>
              </div>
              <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>
    </AppShell>
  );
}
