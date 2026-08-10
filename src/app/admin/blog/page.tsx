import { ExternalLink } from "lucide-react";
import Link from "next/link";

import BlogManager, { type BlogPostRecord } from "@/components/admin/BlogManager";
import { PageHeader } from "@/components/app-shell/PagePrimitives";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Blog" };
export const dynamic = "force-dynamic";

export default async function AdminBlogPage() {
  await requireAdmin("/admin/blog");
  const posts = await prisma.blogPost.findMany({
    include: { author: { select: { name: true, email: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const initialPosts: BlogPostRecord[] = posts.map((post) => ({
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    content: post.content,
    coverUrl: post.coverUrl,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    published: post.published,
    publishedAt: post.publishedAt?.toISOString() || null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    author: post.author,
  }));

  return (
    <div className="space-y-7">
      <PageHeader
        title="Blog"
        description="Připravujte články, SEO metadata a titulní obrázky. Koncepty můžete kdykoli publikovat nebo znovu skrýt."
        action={
          <Link href="/blog" target="_blank" className="app-button app-button-secondary shrink-0">
            Otevřít blog <ExternalLink className="size-4" />
          </Link>
        }
      />
      <BlogManager initialPosts={initialPosts} />
    </div>
  );
}
