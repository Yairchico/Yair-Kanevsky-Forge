import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
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
          <CardDescription className="pt-1">בחירת סיסמה חדשה</CardDescription>
        </CardHeader>
        <CardContent>
          <ResetPasswordForm />
        </CardContent>
      </Card>
    </main>
  );
}
