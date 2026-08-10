import { ExternalLink } from "lucide-react";
import Link from "next/link";

import LandingContentManager, {
  type FounderRecord,
  type ReferenceProjectRecord,
} from "@/components/admin/LandingContentManager";
import { PageHeader } from "@/components/app-shell/PagePrimitives";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Landing page" };
export const dynamic = "force-dynamic";

export default async function AdminLandingPage() {
  await requireAdmin("/admin/landing");
  const [founders, projects] = await Promise.all([
    prisma.founder.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.referenceProject.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
  ]);

  const initialFounders: FounderRecord[] = founders.map((founder) => ({
    id: founder.id,
    name: founder.name,
    title: founder.title,
    bio: founder.bio,
    photoUrl: founder.photoUrl,
    linkedInUrl: founder.linkedInUrl,
    email: founder.email,
    published: founder.published,
    sortOrder: founder.sortOrder,
    updatedAt: founder.updatedAt.toISOString(),
  }));
  const initialProjects: ReferenceProjectRecord[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    imageUrl: project.imageUrl,
    url: project.url,
    location: project.location,
    published: project.published,
    sortOrder: project.sortOrder,
    updatedAt: project.updatedAt.toISOString(),
  }));

  return (
    <div className="space-y-7">
      <PageHeader
        title="Obsah landing page"
        description="Spravujte zakladatele a referenční projekty. Na veřejném webu se zobrazují pouze publikované položky v nastaveném pořadí."
        action={
          <Link href="/" target="_blank" className="app-button app-button-secondary shrink-0">
            Otevřít veřejný web <ExternalLink className="size-4" />
          </Link>
        }
      />
      <LandingContentManager initialFounders={initialFounders} initialProjects={initialProjects} />
    </div>
  );
}
