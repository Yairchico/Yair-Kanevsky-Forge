/**
 * The image to show for an exercise: `exercises.media_url` (set via file
 * upload or a pasted URL — the exercise library's image editor, or at
 * creation time) always wins. Failing that, each of the ~58 base seed
 * exercises (supabase/seed.sql) has its own real photo, downloaded from
 * the public-domain `free-exercise-db` dataset, at
 * public/exercises/exercise-<slug>.jpg — an exact lookup by name, no
 * guessing.
 *
 * Anything else (a trainer's custom exercise) gets no image at all unless
 * one is explicitly set — a guessed placeholder was tried and rejected as
 * "not what I meant."
 */

// The base seed exercises — each has its own photo. Keep in sync with
// supabase/seed.sql; a base exercise added there without a matching
// download here just falls back to no image, which is a harmless default.
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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The image src to render for an exercise, or null for "no image." */
export function getExerciseImage(exercise: {
  name: string;
  muscle_group: string | null;
  media_url?: string | null;
}): string | null {
  if (exercise.media_url) return exercise.media_url;
  if (SEED_EXERCISE_NAMES.has(exercise.name)) {
    return `/exercises/exercise-${slugify(exercise.name)}.jpg`;
  }
  return null;
}
