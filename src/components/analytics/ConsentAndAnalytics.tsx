"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { analyticsSessionId, setClientConsent, trackEvent } from "@/lib/client-analytics";

type Consent = { analytics: boolean; marketing: boolean };

export default function ConsentAndAnalytics({
  children,
  initialConsent,
  metaPixelId,
}: {
  children: React.ReactNode;
  initialConsent: Consent | null;
  metaPixelId?: string | null;
}) {
  const pathname = usePathname();
  const [consent, setConsent] = useState<Consent | null>(initialConsent);
  const [editing, setEditing] = useState(false);
  const [pixelReady, setPixelReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogOpen = consent === null || editing;

  // This module-level gate is updated before child components render, so a
  // pre-consent child effect cannot create an analytics identifier or call Meta.
  setClientConsent(consent);

  useEffect(() => {
    if (!consent?.analytics) return;
    void trackEvent("PAGE_VIEW", pathname);
  }, [consent?.analytics, pathname]);

  useEffect(() => {
    if (consent?.marketing && metaPixelId && pixelReady && typeof window.fbq === "function") window.fbq("track", "PageView");
  }, [consent?.marketing, metaPixelId, pathname, pixelReady]);

  useEffect(() => {
    const openSettings = () => {
      setError(null);
      setEditing(true);
    };
    window.addEventListener("spottex:open-consent", openSettings);
    return () => window.removeEventListener("spottex:open-consent", openSettings);
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [dialogOpen]);

  async function save(next: Consent) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/analytics/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: analyticsSessionId(), analytics: next.analytics, marketing: next.marketing, version: "2026-07" }) });
      if (!response.ok) throw new Error("CONSENT_SAVE_FAILED");
      if (consent?.marketing && !next.marketing && typeof window.fbq === "function") window.fbq("consent", "revoke");
      if (!consent?.marketing && next.marketing && typeof window.fbq === "function") window.fbq("consent", "grant");
      setConsent(next);
      setEditing(false);
    } catch {
      setError("Volbu se nepodařilo bezpečně uložit. Zkuste to prosím znovu.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {children}
      {dialogOpen && (
        <div
          data-testid="consent-banner"
          className="spottex-consent-overlay"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="consent-title"
            aria-describedby="consent-description"
            className="spottex-consent-dialog"
          >
            <div className="spottex-consent-accent" />
            {editing && consent !== null && (
              <button
                type="button"
                aria-label="Zavřít nastavení soukromí"
                disabled={saving}
                onClick={() => {
                  setError(null);
                  setEditing(false);
                }}
                className="spottex-consent-close"
              >
                ×
              </button>
            )}

            <div className="spottex-consent-content">
              <div className="spottex-consent-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 3 5 6v5c0 4.8 2.9 8.2 7 10 4.1-1.8 7-5.2 7-10V6l-7-3Z" />
                  <path d="m9.5 12 1.7 1.7 3.6-4" />
                </svg>
              </div>
              <p className="spottex-consent-eyebrow">Vaše soukromí</p>
              <h2 id="consent-title" className="spottex-consent-title">
                Pomozte nám vyladit Spottex pro vás
              </h2>
              <p id="consent-description" className="spottex-consent-description">
                Aby vám web a aplikace fungovaly co nejlépe, používáme vedle nezbytných
                cookies také analytiku a personalizaci obsahu. Vaše volba nám pomůže Spottex dál zlepšovat.
              </p>

              {error && (
                <p role="alert" className="spottex-consent-error">
                  {error}
                </p>
              )}

              <div className="spottex-consent-actions">
                <button
                  type="button"
                  disabled={saving}
                  className="spottex-consent-button spottex-consent-button--primary"
                  onClick={() => save({ analytics: true, marketing: true })}
                >
                  {saving ? "Ukládám volbu…" : "Souhlasím a pokračovat"}
                </button>
                <div className="spottex-consent-secondary-actions">
                  <button
                    type="button"
                    disabled={saving}
                    className="spottex-consent-button spottex-consent-button--secondary"
                    onClick={() => save({ analytics: false, marketing: false })}
                  >
                    Pouze nezbytné
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    className="spottex-consent-button spottex-consent-button--secondary"
                    onClick={() => save({ analytics: true, marketing: false })}
                  >
                    Analytika bez marketingu
                  </button>
                </div>
              </div>

              <p className="spottex-consent-footnote">
                Volbu můžete později změnit v patičce webu. Podrobnosti najdete v{" "}
                <Link href="/ochrana-osobnich-udaju" className="spottex-consent-link">
                  ochraně osobních údajů
                </Link>.
              </p>
            </div>
          </section>
        </div>
      )}
      {consent?.marketing && metaPixelId ? <>
        <Script id="meta-pixel" strategy="afterInteractive" onReady={() => setPixelReady(true)}>{`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(metaPixelId)});`}</Script>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <noscript><img height="1" width="1" style={{ display: "none" }} src={`https://www.facebook.com/tr?id=${encodeURIComponent(metaPixelId)}&ev=PageView&noscript=1`} alt="" /></noscript>
      </> : null}
    </>
  );
}
