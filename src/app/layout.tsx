import type { Metadata } from "next";
import { Rubik } from "next/font/google";
import "./globals.css";

// Rubik has solid Hebrew glyph coverage and a friendly, modern feel —
// unlike Geist (Latin-only), which was the create-next-app default.
const rubik = Rubik({
  subsets: ["hebrew", "latin"],
  variable: "--font-rubik",
});

export const metadata: Metadata = {
  title: "אפליקציית אימונים",
  description: "אפליקציית אימונים למאמן ולמתאמנים שלו",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className={`${rubik.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
