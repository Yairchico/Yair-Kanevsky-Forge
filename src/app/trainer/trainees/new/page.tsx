"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createTrainee, type CreateTraineeState } from "../actions";
import { AppShell } from "@/components/app-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const initialState: CreateTraineeState = {};

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join(
    "",
  );
}

export default function NewTraineePage() {
  const [state, formAction, pending] = useActionState(createTrainee, initialState);
  const [password, setPassword] = useState("");

  return (
    <AppShell title="מתאמן חדש" backHref="/trainer/trainees">
      <div className="mx-auto w-full max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>מתאמן חדש</CardTitle>
            <CardDescription>
              נוצר חשבון התחברות עבור המתאמן. את פרטי ההתחברות (אימייל +
              סיסמה) יש להעביר אליו בנפרד (וואטסאפ / טלפון).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="full_name">שם מלא</Label>
                <Input id="full_name" name="full_name" required />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">אימייל</Label>
                <Input id="email" name="email" type="email" required />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="phone">טלפון (אופציונלי)</Label>
                <Input id="phone" name="phone" type="tel" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">סיסמה זמנית</Label>
                <div className="flex gap-2">
                  <Input
                    id="password"
                    name="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPassword(generatePassword())}
                  >
                    צור סיסמה
                  </Button>
                </div>
              </div>

              {state.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}

              <div className="flex gap-2">
                <Button type="submit" disabled={pending}>
                  {pending ? "יוצר…" : "צור מתאמן"}
                </Button>
                <Link
                  href="/trainer/trainees"
                  className={buttonVariants({ variant: "outline" })}
                >
                  ביטול
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
