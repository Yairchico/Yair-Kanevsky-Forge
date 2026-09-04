import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardContent,
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
      <Card>
        <CardHeader>
          <CardTitle>ברוך הבא</CardTitle>
          <CardDescription>
            כאן יופיעו בהמשך רשימת המתאמנים, ספריית התרגילים ובניית התוכניות.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          השלב הבא: ניהול מתאמנים + ספריית תרגילים.
        </CardContent>
      </Card>
    </AppShell>
  );
}
