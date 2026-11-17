import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import { APP_NAME } from "@/lib/constants";
import "./globals.css";

// Heebo: full Hebrew glyph coverage, part of the crimson dark theme
// (it replaced Rubik, which replaced create-next-app's Latin-only Geist).
const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  variable: "--font-heebo",
});

export const viewport: Viewport = {
  themeColor: "#121212",
  colorScheme: "dark",
};

export const metadata: Metadata = {
  title: APP_NAME,
  description: "אפליקציית אימונים למאמן ולמתאמנים שלו",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
