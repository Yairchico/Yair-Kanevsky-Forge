import { getCurrentUser } from "@/lib/current-user";
import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function TraineeHomePage() {
  const user = await getCurrentUser();

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
