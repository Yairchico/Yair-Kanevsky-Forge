"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ExerciseStatus {
  id: string;
  name: string;
  muscleGroup: string | null;
  done: boolean;
}

interface DayData {
  id: string;
  dayIndex: number;
  label: string;
  submitted: boolean;
  exercises: ExerciseStatus[];
}

/**
 * Read-only mirror of the trainee's own "השבוע שלי" screen, from the
 * trainer's side. All days' data is fetched once by the server and handed
 * here, so switching the tab is a local state change — no server round
 * trip (the builder's day-tab switching was the slow pattern this avoids
 * repeating).
 */
export function TraineeWeekView({ days }: { days: DayData[] }) {
  const [activeIndex, setActiveIndex] = useState(days[0]?.dayIndex ?? 0);
  const activeDay = days.find((d) => d.dayIndex === activeIndex) ?? days[0];

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setActiveIndex(d.dayIndex)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              d.dayIndex === activeIndex
                ? "bg-primary text-primary-foreground"
                : d.submitted
                  ? "bg-success/15 text-success"
                  : "bg-secondary text-secondary-foreground hover:bg-muted",
            )}
          >
            {d.label}
          </button>
        ))}
      </div>

      {!activeDay || activeDay.exercises.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין אימון מתוכנן ליום הזה.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium",
                activeDay.submitted
                  ? "bg-success/15 text-success"
                  : "bg-secondary text-secondary-foreground",
              )}
            >
              {activeDay.submitted ? "האימון הוגש" : "טרם הוגש"}
            </span>
          </div>

          {activeDay.exercises.map((ex) => (
            <Card key={ex.id}>
              <CardContent className="flex items-center gap-3 p-3">
                <div
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                    ex.done
                      ? "bg-success text-success-foreground"
                      : "border-2 border-border",
                  )}
                >
                  {ex.done && <Check className="h-3.5 w-3.5" />}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{ex.name}</p>
                  {ex.muscleGroup && (
                    <p className="text-xs text-muted-foreground">
                      {ex.muscleGroup}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
