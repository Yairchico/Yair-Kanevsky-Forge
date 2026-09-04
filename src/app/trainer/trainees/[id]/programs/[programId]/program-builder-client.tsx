"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PublishToggle } from "./publish-toggle";
import { DayBuilder } from "./day-builder";
import type { WorkoutExerciseFields } from "./actions";

interface DayData {
  id: string;
  dayIndex: number;
  label: string;
  workoutId: string | null;
  items: {
    id: string;
    exerciseName: string;
    muscleGroup: string | null;
    fields: WorkoutExerciseFields;
  }[];
}

interface CatalogExercise {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
}

/**
 * All 7 days' data is fetched once by the server and handed here, so
 * switching the active day tab is a local state change — no server round
 * trip, no re-render of the whole page. That used to be the slow part of
 * the builder (a Link with ?day=N triggering a full server navigation for
 * something as routine as looking at a different day).
 */
export function ProgramBuilderClient({
  traineeId,
  programId,
  traineeName,
  initialIsPublished,
  days,
  catalog,
}: {
  traineeId: string;
  programId: string;
  traineeName: string;
  initialIsPublished: boolean;
  days: DayData[];
  catalog: CatalogExercise[];
}) {
  const [isPublished, setIsPublished] = useState(initialIsPublished);
  const [activeDayIndex, setActiveDayIndex] = useState(days[0]?.dayIndex ?? 0);
  const activeDay = days.find((d) => d.dayIndex === activeDayIndex) ?? days[0];

  function handleEdited() {
    if (isPublished) setIsPublished(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium",
              isPublished
                ? "bg-success/15 text-success"
                : "bg-warning/20 text-warning-foreground",
            )}
          >
            {isPublished ? "פורסם" : "טיוטה"}
          </span>
          <span className="text-sm text-muted-foreground">
            תוכנית עבור {traineeName}
          </span>
        </div>
        <PublishToggle
          traineeId={traineeId}
          programId={programId}
          isPublished={isPublished}
          onChange={setIsPublished}
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setActiveDayIndex(d.dayIndex)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              d.dayIndex === activeDayIndex
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-muted",
            )}
          >
            {d.label}
          </button>
        ))}
      </div>

      {activeDay && (
        <DayBuilder
          key={activeDay.id}
          traineeId={traineeId}
          programId={programId}
          programDayId={activeDay.id}
          initialItems={activeDay.items}
          catalog={catalog}
          onEdited={handleEdited}
        />
      )}
    </div>
  );
}
