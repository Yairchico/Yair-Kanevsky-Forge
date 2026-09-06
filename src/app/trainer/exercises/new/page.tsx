import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isReadOnlyViewer } from "@/lib/viewer";
import { NewExerciseForm } from "./new-exercise-form";

/**
 * Creating an exercise is a pure mutation with no read-only equivalent —
 * redirects a superadmin away entirely rather than rendering a form that
 * would just fail on submit.
 */
export default async function NewExercisePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user && (await isReadOnlyViewer(supabase, user.id))) {
    redirect("/trainer/exercises");
  }

  return <NewExerciseForm />;
}
