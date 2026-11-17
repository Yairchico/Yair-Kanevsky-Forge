import { redirect } from "next/navigation";
import { getRequestAuth } from "@/lib/viewer";
import { NewExerciseForm } from "./new-exercise-form";

/**
 * Creating an exercise is a pure mutation with no read-only equivalent —
 * redirects a superadmin away entirely rather than rendering a form that
 * would just fail on submit.
 */
export default async function NewExercisePage() {
  const { viewer } = await getRequestAuth();
  if ((await viewer)?.isSuperadmin) {
    redirect("/trainer/exercises");
  }

  return <NewExerciseForm />;
}
