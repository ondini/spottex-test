"use client";

const SESSION_KEY = "spottex_analytics_session";
let analyticsConsent = false;
let marketingConsent = false;

declare global {
  interface Window { fbq?: (...args: unknown[]) => void }
}

const pixelEvents: Record<string, string> = {
  SIGNUP_COMPLETED: "CompleteRegistration",
  CONSULTATION_BOOKED: "Lead",
  CHECKOUT_STARTED: "InitiateCheckout",
  TRIAL_ACTIVATED: "StartTrial",
  PAYMENT_COMPLETED: "Purchase",
};

export function setClientConsent(consent: { analytics: boolean; marketing: boolean } | null) {
  analyticsConsent = consent?.analytics === true;
  marketingConsent = consent?.marketing === true;
}

export function analyticsSessionId() {
  let value = sessionStorage.getItem(SESSION_KEY);
  if (!value) {
    value = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, value);
  }
  return value;
}

export function trackEvent(type: string, path?: string, properties: Record<string, string | number | boolean | null> = {}) {
  const pixelEvent = pixelEvents[type];
  if (marketingConsent && pixelEvent && typeof window.fbq === "function") {
    const { eventId, paymentId: _paymentId, ...pixelProperties } = properties;
    void _paymentId;
    window.fbq("track", pixelEvent, pixelProperties, typeof eventId === "string" ? { eventID: eventId } : undefined);
  }
  if (!analyticsConsent) return Promise.resolve(undefined);
  return fetch("/api/analytics/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, path, sessionId: analyticsSessionId(), properties }),
    keepalive: true,
  }).catch(() => undefined);
}
