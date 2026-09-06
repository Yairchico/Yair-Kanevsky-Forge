import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Eye } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { BrandMark } from "@/components/brand";
import { APP_NAME } from "@/lib/constants";

/** Shared header + content shell for the /trainer and /trainee areas. */
export function AppShell({
  title,
  backHref,
  username,
  readOnly,
  children,
}: {
  title: string;
  /** Shows a back button in the header, linking here, when set. */
  backHref?: string;
  /** The signed-in user's own username — never their email. */
  username?: string | null;
  /** True for the read-only superadmin oversight account (migration 0011) — shows a "צפייה בלבד" badge so it's never ambiguous why a button is missing. */
  readOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          {backHref && (
            <Link
              href={backHref}
              aria-label="חזרה"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-xs transition-colors hover:bg-muted active:scale-95"
            >
              {/* Points visually "back" in RTL. */}
              <ArrowRight className="h-6 w-6" />
            </Link>
          )}
          <BrandMark />
          <div>
            <p className="text-sm font-semibold leading-none">{APP_NAME}</p>
            <p className="mt-1 text-xs text-muted-foreground">{title}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {readOnly && (
            <span className="flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
              <Eye className="h-3.5 w-3.5" />
              צפייה בלבד
            </span>
          )}
          {username && (
            <p className="hidden text-sm font-semibold sm:block">@{username}</p>
          )}
          <SignOutButton />
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">{children}</main>
    </div>
  );
}
