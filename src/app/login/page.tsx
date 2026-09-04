"use client";

import { useActionState, useState } from "react";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
import { signIn, type SignInState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

const initialState: SignInState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, initialState);
  // Controlled so the email the user typed survives a failed submit
  // (the password field is intentionally left to reset on error).
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Image
            src="/logo-full.png"
            alt="Yair Kanevsky Fitness Coach"
            width={700}
            height={663}
            unoptimized
            priority
            className="h-auto w-48"
          />
          <CardDescription className="pt-1">התחברות לאזור האישי</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">אימייל</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">סיסמה</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  className="pe-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {state.error && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "מתחבר…" : "התחבר"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
