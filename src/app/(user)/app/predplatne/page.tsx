import { redirect } from "next/navigation";

export default function LegacySubscriptionPage() {
  redirect("/app/sluzba#stav-sluzby");
}
