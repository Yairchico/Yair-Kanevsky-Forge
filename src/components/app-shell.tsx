import type { ReactNode } from "react";
import { SignOutButton } from "@/components/sign-out-button";

/** Shared header + content shell for the /trainer and /trainee areas. */
export function AppShell({
  title,
  userEmail,
  children,
}: {
  title: string;
  userEmail?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3 sm:px-6">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          {userEmail && (
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          )}
        </div>
        <SignOutButton />
      </header>
      <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">{children}</main>
    </div>
  );
}
