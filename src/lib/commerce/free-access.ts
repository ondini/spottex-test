export function freeAccessEnabled() {
  return (
    process.env.FREE_ACCESS_MODE === "true" ||
    (process.env.PAYMENT_PROVIDER || "").toUpperCase() === "FREE"
  );
}
