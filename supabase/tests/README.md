# SQL tests

What `tsc` and `next build` can't see: whether a Row Level Security policy
really stops the person it should, and whether the training-block
progression computes what it claims. These suites run the real migrations on
a throwaway local Postgres and check both, acting as each kind of user
(trainer, a trainee, another trainee, the read-only viewer).

```bash
PGHOST=/tmp PGPORT=5432 PGUSER=postgres supabase/tests/run.sh        # all
PGHOST=/tmp PGPORT=5432 PGUSER=postgres supabase/tests/run.sh 0017   # one
```

| Suite | Covers |
|---|---|
| `0014_security.sql` | No self-promotion to trainer or read-only viewer; sign-up can't create a second trainer; a trainee writes performance only for their own published program; who-logged-it is decided by the database. |
| `0016_trainer_sessions.sql` | The trainer logging on a trainee's behalf; free sessions and saved workouts (who may read and write them, starting from a template, saving a session as one). |
| `0017_training_blocks.sql` | The progression engine: success / miss / skipped week, kg and percent steps with rounding, double progression, deloads, hand-set targets, started weeks never changing; shifting, inserting a deload, ending, deleting, the next block; and who may call each function. |
| `0018_week_lock.sql` | A trainee can't rewrite or delete history older than last week even with a direct API call; the trainer can; copying a program. |
| `0019_upload_template_convert.sql` | The video bucket: who may upload, watch and delete, and the stored-path rules; a saved workout into a trainee's program (new or existing program, a full day, past weeks, who may); existing weeks into a block (who may, refusals, exercises recognised across weeks, the trainer's numbers kept, added weeks computed). |

`bootstrap.sql` stands in for what a Supabase project provides before the
first migration (the API roles, `auth.users`, `auth.uid()`). `lib.sql` has
the three helpers the suites use: `as_user(id)`, `expect(label, sql, 'DENIED' |
'ROWS:n' | 'OK')` and `eq(label, got, want)`.

When a migration, a policy or a SQL function changes, add the check here
first. This is still a plain Postgres, not the real Supabase project: it
proves the SQL, not the deployment.
