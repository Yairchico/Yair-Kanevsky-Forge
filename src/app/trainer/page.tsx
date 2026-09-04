import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function TrainerHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <AppShell title="אזור מאמן" userEmail={user?.email}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/trainer/trainees">
          <Card className="h-full transition-colors hover:bg-muted">
            <CardHeader>
              <CardTitle>מתאמנים</CardTitle>
              <CardDescription>
                רשימת המתאמנים שלך, והוספת מתאמן חדש
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/trainer/exercises">
          <Card className="h-full transition-colors hover:bg-muted">
            <CardHeader>
              <CardTitle>ספריית תרגילים</CardTitle>
              <CardDescription>
                חיפוש תרגילים, והוספת תרגיל מותאם אישית
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </AppShell>
  );
}
