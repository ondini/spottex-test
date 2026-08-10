import { redirect } from "next/navigation";

export default function LegacyPaymentsPage() {
  redirect("/app/sluzba#platby");
}
