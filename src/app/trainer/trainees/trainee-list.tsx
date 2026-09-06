"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Phone, UserRoundSearch } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { formatShortDateTime } from "@/lib/format";

interface Trainee {
  id: string;
  full_name: string;
  username: string;
  phone: string | null;
  lastActivity: string | null;
}

function initials(name: string) {
  return name.trim().slice(0, 2);
}

/**
 * Local filtering — fetched once, filtered in-browser, no network round
 * trip. Cards are deliberately generous, not dense: this is one trainer's
 * own roster (realistically a couple dozen trainees, never hundreds — see
 * PLAN.md §0 on why this app doesn't scale to a multi-tenant model), so
 * there's no reason to optimize for cramming more per screen over making
 * each one comfortable to read and tap.
 */
export function TraineeList({ trainees }: { trainees: Trainee[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return trainees;
    return trainees.filter(
      (t) =>
        t.full_name.toLowerCase().includes(needle) ||
        t.username.toLowerCase().includes(needle),
    );
  }, [trainees, q]);

  return (
    <div className="space-y-4">
      <SearchInput
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="חיפוש לפי שם או שם משתמש…"
        className="sm:max-w-xs"
      />

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <UserRoundSearch className="h-8 w-8 text-muted-foreground/50" />
            {q ? (
              <>לא נמצאו מתאמנים עבור &quot;{q}&quot;.</>
            ) : (
              <>עדיין אין מתאמנים.</>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t) => (
            <Link key={t.id} href={`/trainer/trainees/${t.id}`}>
              <Card className="h-full transition-shadow hover:shadow-sm">
                <CardContent className="flex items-center gap-4 p-5">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
                    {initials(t.full_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-semibold leading-tight">
                      {t.full_name}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      @{t.username}
                    </p>
                    {t.phone && (
                      <p className="mt-1 flex items-center gap-1 truncate text-sm text-muted-foreground">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        {t.phone}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t.lastActivity ? (
                        <>פעילות אחרונה: {formatShortDateTime(t.lastActivity)}</>
                      ) : (
                        "טרם הגיש אימון"
                      )}
                    </p>
                  </div>
                  <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
