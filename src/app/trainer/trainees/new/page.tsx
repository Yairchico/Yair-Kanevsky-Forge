import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isReadOnlyViewer } from "@/lib/viewer";
import { NewTraineeForm } from "./new-trainee-form";

/**
 * Creating a trainee is a pure mutation with no read-only equivalent —
 * unlike other trainer screens, there's nothing here worth showing a
 * superadmin, so this redirects away entirely rather than rendering a
 * form that would just fail on submit.
 */
export default async function NewTraineePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user && (await isReadOnlyViewer(supabase, user.id))) {
    redirect("/trainer/trainees");
  }

  return <NewTraineeForm />;
}
