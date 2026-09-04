import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { TraineeList } from "./trainee-list";

export default async function TraineesPage() {
  const supabase = await createClient();

  const { data: trainees } = await supabase
    .from("profiles")
    .select("id, full_name, username, phone, status, created_at")
    .eq("role", "trainee")
    .order("created_at", { ascending: false });

  return (
    <AppShell title="מתאמנים" backHref="/trainer">
      <div className="flex justify-end">
        <Link href="/trainer/trainees/new" className={buttonVariants({})}>
          + מתאמן חדש
        </Link>
      </div>
      <TraineeList trainees={trainees ?? []} />
    </AppShell>
  );
}
