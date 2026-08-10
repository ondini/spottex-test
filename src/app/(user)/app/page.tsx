import { redirect } from "next/navigation";

export default function UserAppIndexPage() {
  redirect("/app/dashboard");
}

