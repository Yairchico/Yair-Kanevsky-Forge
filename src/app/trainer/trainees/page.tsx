import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { getRequestAuth } from "@/lib/viewer";
import { TraineeList } from "./trainee-list";

export default async function TraineesPage() {
  const { supabase, viewer } = await getRequestAuth();

  // Independent of each other — run together instead of one after another.
  const [me, { data: trainees }, { data: completions }] = await Promise.all([
    viewer,
    supabase
      .from("profiles")
      .select("id, full_name, username, phone")
      .eq("role", "trainee")
      .order("created_at", { ascending: false }),
    supabase
      .from("workout_completions")
      .select("trainee_id, completed_at")
      .order("completed_at", { ascending: false }),
  ]);

  const readOnly = me?.isSuperadmin === true;

  // completions is already newest-first, so the first row seen per
  // trainee_id is their most recent submission.
  const lastActivityByTraineeId = new Map<string, string>();
  for (const c of completions ?? []) {
    if (!lastActivityByTraineeId.has(c.trainee_id)) {
      lastActivityByTraineeId.set(c.trainee_id, c.completed_at);
    }
  }

  const traineesData = (trainees ?? []).map((t) => ({
    id: t.id,
    full_name: t.full_name,
    username: t.username,
    phone: t.phone,
    lastActivity: lastActivityByTraineeId.get(t.id) ?? null,
  }));

  return (
    <AppShell title="מתאמנים" backHref="/trainer" readOnly={readOnly}>
      {!readOnly && (
        <div className="flex justify-end">
          <Link href="/trainer/trainees/new" className={buttonVariants({})}>
            + מתאמן חדש
          </Link>
        </div>
      )}
      <TraineeList trainees={traineesData} />
    </AppShell>
  );
}
