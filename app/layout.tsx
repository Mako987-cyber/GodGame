import type { Metadata } from "next";
import { Alegreya, Alegreya_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { QueryProvider } from "@/components/providers/query-provider";
import "./globals.css";

const serif = Alegreya({ subsets: ["latin"], variable: "--font-alegreya", display: "swap" });
const sans = Alegreya_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-alegreya-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Genesis", template: "%s — Genesis" },
  description: "Simulazione procedurale di civiltà umane dalla preistoria.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it" className={`${serif.variable} ${sans.variable}`}>
      <body className="min-h-dvh">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
