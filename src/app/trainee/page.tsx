import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/auth-actions";

export default async function TraineeHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">השבוע שלי</h1>
        <form action={signOut}>
          <button type="submit" className="text-sm underline">
            התנתקות
          </button>
        </form>
      </div>
      <p className="text-sm text-black/60 dark:text-white/60">
        מחובר כ-{user?.email}. כאן תופיע התוכנית השבועית שהמאמן פרסם עבורך.
      </p>
    </main>
  );
}
