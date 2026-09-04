import type { ReactNode } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { BrandMark } from "@/components/brand";
import { APP_NAME } from "@/lib/constants";

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
        <div className="flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="text-sm font-semibold leading-none">{APP_NAME}</p>
            <p className="mt-1 text-xs text-muted-foreground">{title}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {userEmail && (
            <p className="hidden text-xs text-muted-foreground sm:block">
              {userEmail}
            </p>
          )}
          <SignOutButton />
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">{children}</main>
    </div>
  );
}
