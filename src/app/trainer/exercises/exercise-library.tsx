"use client";

import { useMemo, useState } from "react";
import { Dumbbell, SearchX } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { MUSCLE_GROUPS } from "@/lib/exercise-constants";
import { cn } from "@/lib/utils";

interface Exercise {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  is_custom: boolean;
}

/**
 * Search + category filtering entirely client-side: the whole (small)
 * exercise catalog is fetched once by the server component and handed
 * here as a prop, so every keystroke and chip click filters an in-memory
 * array — no network round trip, no debounce needed, no server-navigation
 * latency. This replaced a version that filtered via ?q=/?group= URL
 * params (a full server re-render per interaction, which felt slow).
 */
export function ExerciseLibrary({ exercises }: { exercises: Exercise[] }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return exercises.filter((e) => {
      if (group && e.muscle_group !== group) return false;
      if (needle && !e.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [exercises, q, group]);

  return (
    <div className="space-y-4">
      <SearchInput
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="חיפוש תרגיל…"
        className="sm:max-w-xs"
      />

      <div className="flex flex-wrap gap-2">
        {["הכל", ...MUSCLE_GROUPS].map((g) => {
          const isAll = g === "הכל";
          const active = isAll ? !group : group === g;
          return (
            <button
              key={g}
              type="button"
              onClick={() => setGroup(isAll ? null : g)}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-secondary text-secondary-foreground hover:bg-muted",
              )}
            >
              {g}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <SearchX className="h-8 w-8 text-muted-foreground/50" />
            לא נמצאו תרגילים תואמים.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((ex) => (
            <Card key={ex.id} className="transition-shadow hover:shadow-sm">
              <CardContent className="flex items-start gap-3 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Dumbbell className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-medium">{ex.name}</p>
                    {ex.is_custom && (
                      <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs whitespace-nowrap text-secondary-foreground">
                        מותאם
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {[ex.muscle_group, ex.equipment].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
