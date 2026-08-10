"use client";

import { useEffect } from "react";

import { trackEvent } from "@/lib/client-analytics";

export function PaymentResultTracker({ paymentId, amountMinor, currency }: { paymentId: string; amountMinor: number; currency: string }) {
  useEffect(() => {
    const key = `spottex_payment_tracked:${paymentId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    const type = amountMinor === 0 ? "TRIAL_ACTIVATED" : "PAYMENT_COMPLETED";
    void trackEvent(type, "/platba/navrat", { value: amountMinor / 100, currency, paymentId, eventId: `spottex-payment-${paymentId}` });
  }, [amountMinor, currency, paymentId]);
  return null;
}
