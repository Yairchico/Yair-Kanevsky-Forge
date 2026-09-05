/**
 * Every exercise gets a picture. There's no real photo library for this
 * app's own exercises, so the base ~58 seed exercises (supabase/seed.sql)
 * each get a matching real photo downloaded from free-exercise-db
 * (public domain / Unlicense — https://github.com/yuhonas/free-exercise-db,
 * see public/exercises/) — an exact lookup by name, no guessing needed.
 * Anything else (a custom exercise the trainer adds) falls back to one
 * representative photo per movement pattern, picked from keywords in the
 * name and, failing that, the muscle group.
 *
 * A trainer can override any single exercise's image via
 * `exercises.media_url` (see the exercise library's edit action) — that
 * always wins over both of the above.
 */

// The base seed exercises (supabase/seed.sql) — each has its own photo at
// public/exercises/exercise-<slug>.jpg. Keep this in sync with the seed:
// adding a base exercise there without a matching download here just means
// it falls back to its category photo, which is a harmless default.
const SEED_EXERCISE_NAMES = new Set([
  "Bench Press",
  "Incline Bench Press",
  "Decline Bench Press",
  "Dumbbell Bench Press",
  "Dumbbell Fly",
  "Cable Fly",
  "Dips",
  "Push-Up",
  "Barbell Row",
  "Dumbbell Row",
  "Pull-Up",
  "Chin-Up",
  "Lat Pulldown",
  "Seated Cable Row",
  "Machine Row",
  "Back Extension",
  "Back Squat",
  "Front Squat",
  "Deadlift",
  "Romanian Deadlift",
  "Leg Press",
  "Leg Extension",
  "Lying Leg Curl",
  "Lunge",
  "Bulgarian Split Squat",
  "Calf Raise",
  "Overhead Press",
  "Dumbbell Shoulder Press",
  "Lateral Raise",
  "Front Raise",
  "Reverse Fly",
  "Face Pull",
  "Shrug",
  "Barbell Curl",
  "Dumbbell Curl",
  "Hammer Curl",
  "Incline Dumbbell Curl",
  "Cable Curl",
  "Triceps Pushdown",
  "Overhead Triceps Extension",
  "Skull Crusher",
  "Bench Dips",
  "Rope Pushdown",
  "Crunch",
  "Plank",
  "Hanging Leg Raise",
  "Ab Wheel Rollout",
  "Russian Twist",
  "Cable Crunch",
  "Kettlebell Swing",
  "Clean and Press",
  "Burpee",
  "Battle Ropes",
  "Box Jump",
  "Treadmill",
  "Stationary Bike",
  "Rowing Machine",
  "Stair Climber",
]);

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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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
  if (exercise.media_url) return exercise.media_url;
  if (SEED_EXERCISE_NAMES.has(exercise.name)) {
    return `/exercises/exercise-${slugify(exercise.name)}.jpg`;
  }
  return `/exercises/category-${guessPose(exercise.name, exercise.muscle_group)}.jpg`;
}
