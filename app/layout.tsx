import type { Metadata } from "next";
import { Alegreya, Alegreya_Sans } from "next/font/google";
import Link from "next/link";
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
        <QueryProvider>
          <header className="border-line border-b">
            <nav
              className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-3"
              aria-label="Principale"
            >
              <Link href="/" className="text-parchment font-serif text-xl tracking-wide">
                Genesis
              </Link>
              <div className="flex gap-4 text-sm">
                <Link href="/worlds" className="text-muted hover:text-parchment">
                  Mondi
                </Link>
                <Link href="/#nuovo-mondo" className="text-ochre hover:text-ochre-strong">
                  Crea un mondo
                </Link>
              </div>
            </nav>
          </header>
          {children}
        </QueryProvider>
      </body>
    </html>
  );
}
