"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Catches any unhandled error in a page/Server Action below the root
 * layout and shows a branded, Hebrew message instead of Next's default
 * (English, unstyled) error screen. Doesn't cover an error thrown by the
 * root layout itself — that would need `global-error.tsx` — but the root
 * layout here is static markup with no data fetching, so that's not a
 * realistic failure mode.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Visible in Cloudflare's logs for real diagnosis.
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader className="items-center">
          <Brand />
          <CardTitle className="pt-2">משהו השתבש</CardTitle>
          <CardDescription>
            אירעה שגיאה בלתי צפויה. אפשר לנסות שוב — אם זה חוזר, כדאי לדווח
            על כך.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={() => reset()} className="w-full">
            <RefreshCw className="h-4 w-4" />
            נסה שוב
          </Button>
          {error.digest && (
            <p className="text-xs text-muted-foreground">
              קוד שגיאה: {error.digest}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
