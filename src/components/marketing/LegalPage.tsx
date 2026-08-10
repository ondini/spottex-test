"use client";

import Link from "next/link";

export type LegalNavigationItem = {
  id: string;
  label: string;
};

type LegalPageProps = {
  title: string;
  description: string;
  children: React.ReactNode;
  eyebrow?: string;
  effectiveDate?: string;
  navigation?: LegalNavigationItem[];
  contactEmail?: string;
};

export function LegalPage({
  title,
  description,
  children,
  eyebrow = "Právní dokumenty",
  effectiveDate,
  navigation = [],
  contactEmail = "info@spottex.cz",
}: LegalPageProps) {
  return (
    <div className="legal-site">
      <header className="legal-topbar">
        <Link href="/" className="legal-brand" aria-label="Spottex – úvodní stránka">
          sp<span>o</span>ttex
        </Link>
        <nav className="legal-topbar-links" aria-label="Navigace právních dokumentů">
          <Link href="/obchodni-podminky">Podmínky</Link>
          <Link href="/ochrana-osobnich-udaju">Soukromí</Link>
          <Link href="/prihlaseni" className="legal-login-link">Přihlásit se</Link>
        </nav>
      </header>

      <main className="legal-main">
        <header className="legal-hero">
          <p className="legal-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="legal-lead">{description}</p>
          {effectiveDate && <p className="legal-effective">Účinné od {effectiveDate}</p>}
        </header>

        <div className={`legal-layout${navigation.length ? " legal-layout--with-navigation" : ""}`}>
          {navigation.length > 0 && (
            <aside className="legal-aside">
              <nav aria-label="Obsah dokumentu">
                <p>Obsah dokumentu</p>
                <ol>
                  {navigation.map((item, index) => (
                    <li key={item.id}>
                      <a href={`#${item.id}`}>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
              <button
                type="button"
                className="legal-cookie-settings"
                onClick={() => window.dispatchEvent(new Event("spottex:open-consent"))}
              >
                Nastavení cookies
              </button>
            </aside>
          )}

          <article className="legal-document">{children}</article>
        </div>
      </main>

      <footer className="legal-footer">
        <div>
          <Link href="/" className="legal-brand" aria-label="Spottex – úvodní stránka">
            sp<span>o</span>ttex
          </Link>
          <p>Chytré řízení energie bez dalšího hardwaru.</p>
        </div>
        <div>
          <p>Právní a provozní dotazy</p>
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </div>
        <div>
          <p>© {new Date().getFullYear()} Spottex Energy, s.r.o.</p>
          <Link href="/">Zpět na hlavní stránku</Link>
        </div>
      </footer>
    </div>
  );
}
