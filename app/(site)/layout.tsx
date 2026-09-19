import Link from "next/link";
import type { ReactNode } from "react";

/** Pages with the site header (home, world list). The world screen has its own full-screen HUD. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
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
    </>
  );
}
