import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/app-shell/PagePrimitives";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Můj profil" };

export default async function ProfilePage() {
  const session = await requireUser("/app/profil");
  const profile = await prisma.user.findUnique({
    where: { id: Number(session.user.id) },
    select: {
      email: true, name: true, phone: true, street: true, city: true, postalCode: true,
      country: true, companyName: true, companyIdNumber: true, vatId: true, createdAt: true,
    },
  });
  if (!profile) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title="Můj profil" description="Upravte kontaktní, adresní a fakturační údaje svého účtu." />
      <ProfileForm profile={{ ...profile, createdAt: profile.createdAt.toISOString() }} />
    </div>
  );
}

