"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Client-side sign out. Deliberately not a Server Action: calling
 * supabase.auth.signOut() directly from the browser client is simpler and
 * avoids Server Action edge cases on the Cloudflare/OpenNext runtime.
 */
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSignOut} disabled={pending}>
      {pending ? "מתנתק…" : "התנתקות"}
    </Button>
  );
}
