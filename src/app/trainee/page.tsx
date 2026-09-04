import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function TraineeHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <AppShell title="השבוע שלי" userEmail={user?.email}>
      <Card>
        <CardHeader>
          <CardTitle>עדיין אין תוכנית מפורסמת</CardTitle>
          <CardDescription>
            כשהמאמן יפרסם עבורך תוכנית שבועית, היא תופיע כאן.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          מחובר/ת בהצלחה ✓
        </CardContent>
      </Card>
    </AppShell>
  );
}
