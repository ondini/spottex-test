// Activates the inverter-control service in the free-access mode from a client
// component: one cart, one checkout. In that mode the checkout finalizes the
// payment at once, so the subscription is live when this resolves and the
// caller can go on (turn control on, move to the dashboard) without visiting
// the payment return page.
export async function activateFreeControlService() {
  const cartResponse = await fetch("/api/cart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productCode: "INVERTER_CONTROL", quantity: 1 }),
  });
  const cartPayload = (await cartResponse.json().catch(() => ({}))) as { cart?: { id: string }; error?: string };
  if (!cartResponse.ok || !cartPayload.cart) throw new Error(cartPayload.error || "Aktivaci se nepodařilo připravit.");
  const checkoutResponse = await fetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cartId: cartPayload.cart.id }),
  });
  const checkout = (await checkoutResponse.json().catch(() => ({}))) as { redirectUrl?: string; error?: string };
  if (!checkoutResponse.ok || !checkout.redirectUrl) throw new Error(checkout.error || "Aktivaci se nepodařilo dokončit.");
  return checkout;
}
