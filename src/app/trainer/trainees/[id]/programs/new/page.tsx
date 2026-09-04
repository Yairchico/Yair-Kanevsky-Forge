import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewProgramForm } from "./new-program-form";

export default async function NewProgramPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: trainee } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", id)
    .eq("role", "trainee")
    .single();

  if (!trainee) notFound();

  return <NewProgramForm traineeId={trainee.id} traineeName={trainee.full_name} />;
}
