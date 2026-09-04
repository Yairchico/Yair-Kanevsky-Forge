import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { TraineeEditForm } from "./trainee-edit-form";
import { DeleteTraineeButton } from "./delete-trainee-button";
import { cn } from "@/lib/utils";

export default async function TraineeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: trainee } = await supabase
    .from("profiles")
    .select("id, full_name, username, phone, email, status, created_at")
    .eq("id", id)
    .eq("role", "trainee")
    .single();

  if (!trainee) notFound();

  const { data: programs } = await supabase
    .from("programs")
    .select("id, title, status, updated_at")
    .eq("trainee_id", id)
    .order("created_at", { ascending: false });

  return (
    <AppShell title={trainee.full_name} backHref="/trainer/trainees">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>פרטי מתאמן</CardTitle>
            <CardDescription>עריכה ואיפוס סיסמה</CardDescription>
          </CardHeader>
          <CardContent>
            <TraineeEditForm trainee={trainee} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle>תוכניות אימון</CardTitle>
              <CardDescription>תוכניות שבועיות עבור {trainee.full_name}</CardDescription>
            </div>
            <Link
              href={`/trainer/trainees/${id}/programs/new`}
              className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
            >
              + תוכנית חדשה
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {!programs?.length ? (
              <p className="text-sm text-muted-foreground">עדיין אין תוכניות.</p>
            ) : (
              programs.map((p) => (
                <Link
                  key={p.id}
                  href={`/trainer/trainees/${id}/programs/${p.id}`}
                  className="flex items-center justify-between rounded-md border border-border p-3 text-sm transition-colors hover:bg-muted"
                >
                  <span className="font-medium">{p.title}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      p.status === "published"
                        ? "bg-success/15 text-success"
                        : "bg-warning/20 text-warning-foreground",
                    )}
                  >
                    {p.status === "published" ? "פורסם" : "טיוטה"}
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-destructive">אזור מסוכן</CardTitle>
        </CardHeader>
        <CardContent>
          <DeleteTraineeButton traineeId={id} traineeName={trainee.full_name} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
