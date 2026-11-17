import { cn } from "@/lib/utils";
import {
  SET_TYPE_LABEL,
  formatLoggedSet,
  formatSetTarget,
  isSetTargetMet,
  type LoggedSet,
  type PlannedSet,
} from "@/lib/sets";

/**
 * Planned vs. performed, one row per set (planned sets first, then any
 * extras that were added). Used wherever a finished workout is read back:
 * the trainer's workout detail, a free session's summary, the trainee's
 * history.
 *
 *  - `targets`: only the plan — for an exercise logged before sets were
 *    split, whose single old value is shown separately, so its sets don't
 *    each read "לא בוצע".
 *  - `performed`: only what was done — for a free session with nothing
 *    planned, where a column of "—" targets would just be noise.
 */
export function SetsTable({
  planned,
  logged,
  mode = "both",
}: {
  planned: PlannedSet[];
  logged: LoggedSet[];
  mode?: "both" | "targets" | "performed";
}) {
  const plannedByIndex = new Map(planned.map((s) => [s.setIndex, s]));
  const loggedByIndex = new Map(logged.map((s) => [s.setIndex, s]));
  const indexes = [...new Set([...plannedByIndex.keys(), ...loggedByIndex.keys()])].sort((a, b) => a - b);
  if (indexes.length === 0) return null;
  const showTarget = mode !== "performed";
  const showPerformed = mode !== "targets";

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[11px] text-muted-foreground">
          <th className="w-8 pb-0.5 text-center font-normal">סט</th>
          {showTarget && <th className="pb-0.5 text-start font-normal">יעד</th>}
          {showPerformed && <th className="pb-0.5 text-start font-normal">בפועל</th>}
          {showTarget && showPerformed && <th className="w-14 pb-0.5" />}
        </tr>
      </thead>
      <tbody>
        {indexes.map((index) => {
          const target = plannedByIndex.get(index);
          const log = loggedByIndex.get(index);
          const met = log ? isSetTargetMet(target, log) : false;
          return (
            <tr key={index} className="border-t border-border">
              <td className="py-1 text-center text-xs font-bold text-muted-foreground">{index}</td>
              {showTarget && (
                <td className="py-1">
                  <span dir="ltr">{target ? formatSetTarget(target) : "—"}</span>
                  {target?.setType === "warmup" && (
                    <span className="ms-1 text-[11px] text-muted-foreground">({SET_TYPE_LABEL.warmup})</span>
                  )}
                  {!target && <span className="ms-1 text-[11px] text-muted-foreground">(סט נוסף)</span>}
                </td>
              )}
              {showPerformed && (
                <td className="py-1 font-medium">
                  {log ? <span dir="ltr">{formatLoggedSet(log)}</span> : <span className="text-muted-foreground">—</span>}
                  {log?.rpe != null && <span className="ms-1 text-[11px] text-muted-foreground">RPE {log.rpe}</span>}
                </td>
              )}
              {showTarget && showPerformed && (
                <td
                  className={cn(
                    "py-1 text-xs",
                    !log ? "text-muted-foreground" : met ? "text-success" : "text-warning-foreground",
                  )}
                >
                  {!log ? "לא בוצע" : met ? "✓" : "פחות מהיעד"}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
