"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { UserRoundSearch } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";

interface Trainee {
  id: string;
  full_name: string;
  username: string;
  phone: string | null;
}

function initials(name: string) {
  return name.trim().slice(0, 2);
}

/** Local filtering — fetched once, filtered in-browser, no network round trip. */
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (
            <Link key={t.id} href={`/trainer/trainees/${t.id}`}>
              <Card className="h-full transition-shadow hover:shadow-sm">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {initials(t.full_name)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold leading-tight">
                      @{t.username}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {t.full_name}
                    </p>
                    {t.phone && (
                      <p className="truncate text-sm text-muted-foreground">
                        {t.phone}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
