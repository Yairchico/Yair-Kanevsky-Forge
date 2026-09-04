"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface Trainee {
  id: string;
  full_name: string;
  username: string;
  phone: string | null;
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
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="חיפוש לפי שם או שם משתמש…"
        className="sm:max-w-xs"
      />

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
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
              <Card className="h-full transition-colors hover:bg-muted">
                <CardContent className="p-4">
                  <p className="text-lg font-semibold leading-tight">
                    @{t.username}
                  </p>
                  <p className="text-sm text-muted-foreground">{t.full_name}</p>
                  {t.phone && (
                    <p className="text-sm text-muted-foreground">{t.phone}</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
