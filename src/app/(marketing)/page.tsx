import App from "@/App";
import { auth } from "@/auth";
import PublicContentSections from "@/components/marketing/PublicContentSections";

export const dynamic = "force-dynamic";

export default async function MarketingHomePage() {
  const session = await auth();
  return <App isAuthenticated={Boolean(session?.user?.id)} publicContent={<PublicContentSections />} />;
}
