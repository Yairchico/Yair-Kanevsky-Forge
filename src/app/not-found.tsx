import Link from "next/link";
import { Brand } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader className="items-center">
          <Brand />
          <CardTitle className="pt-2">הדף לא נמצא</CardTitle>
          <CardDescription>
            יכול להיות שהקישור שגוי, או שהתוכן נמחק.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/" className={cn(buttonVariants(), "w-full")}>
            חזרה לדף הבית
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
