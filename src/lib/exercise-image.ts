/**
 * Every exercise gets a picture — since there's no real photo/video
 * library, this picks a generic pictogram (a stick-figure silhouette,
 * public/exercise-illustrations/*.svg) of someone in roughly the right
 * pose, based on keywords in the exercise's name and falling back to its
 * muscle group. A trainer can override any single exercise with a real
 * image via `exercises.media_url` (see the exercise library's edit
 * action) — that always wins over the guessed pose.
 */

type Pose =
  | "squat"
  | "deadlift"
  | "push"
  | "pull"
  | "overhead-press"
  | "lateral-raise"
  | "curl"
  | "triceps"
  | "core"
  | "full-body"
  | "cardio"
  | "generic";

// Order matters: checked top to bottom, first match wins. Cardio machines
// and "leg curl" are checked before the generic /row/ and /curl/ rules
// they'd otherwise collide with ("Rowing Machine", "Lying Leg Curl").
const NAME_RULES: { test: RegExp; pose: Pose }[] = [
  { test: /treadmill|stationary bike|rowing machine|stair climber|\brunning\b/i, pose: "cardio" },
  { test: /squat/i, pose: "squat" },
  { test: /deadlift|back extension/i, pose: "deadlift" },
  { test: /leg curl|leg extension|leg press|calf raise|lunge|split squat/i, pose: "squat" },
  { test: /plank|crunch|ab wheel|russian twist|hanging leg raise/i, pose: "core" },
  { test: /pull-?up|chin-?up|pulldown/i, pose: "pull" },
  { test: /\brow\b|face pull|reverse fly/i, pose: "pull" },
  { test: /bench|\bfly\b|dips?\b|push-?up/i, pose: "push" },
  { test: /overhead press|shoulder press|push press|clean and press/i, pose: "overhead-press" },
  { test: /lateral raise|front raise|shrug/i, pose: "lateral-raise" },
  { test: /\bcurl\b/i, pose: "curl" },
  { test: /triceps|skull crusher|pushdown/i, pose: "triceps" },
  { test: /kettlebell|burpee|battle rope|box jump/i, pose: "full-body" },
];

const MUSCLE_GROUP_FALLBACK: Record<string, Pose> = {
  "חזה": "push",
  "גב": "pull",
  "רגליים": "squat",
  "כתפיים": "overhead-press",
  "יד קדמית": "curl",
  "יד אחורית": "triceps",
  "בטן / core": "core",
  "גוף מלא": "full-body",
  "אירובי": "cardio",
};

function guessPose(name: string, muscleGroup: string | null): Pose {
  for (const rule of NAME_RULES) {
    if (rule.test.test(name)) return rule.pose;
  }
  return (muscleGroup && MUSCLE_GROUP_FALLBACK[muscleGroup]) || "generic";
}

/** The image src to actually render for an exercise. */
export function getExerciseImage(exercise: {
  name: string;
  muscle_group: string | null;
  media_url?: string | null;
}): string {
  return exercise.media_url || `/exercise-illustrations/${guessPose(exercise.name, exercise.muscle_group)}.svg`;
}
