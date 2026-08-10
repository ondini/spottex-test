import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer, Nav } from "@/App";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type BlogPostPageProps = {
  params: Promise<{ slug: string }>;
};

const formatDate = (date: Date | null) =>
  date
    ? new Intl.DateTimeFormat("cs-CZ", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Europe/Prague",
      }).format(date)
    : null;

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await prisma.blogPost
    .findFirst({
      where: { slug, published: true },
      select: {
        title: true,
        excerpt: true,
        seoTitle: true,
        seoDescription: true,
        coverUrl: true,
      },
    })
    .catch(() => null);

  if (!post) return { title: "Článek" };

  return {
    title: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt || undefined,
    openGraph: {
      title: post.seoTitle || post.title,
      description: post.seoDescription || post.excerpt || undefined,
      images: post.coverUrl ? [{ url: post.coverUrl }] : undefined,
      type: "article",
    },
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = await prisma.blogPost
    .findFirst({
      where: { slug, published: true },
      include: { author: { select: { name: true } } },
    })
    .catch(() => null);

  if (!post) notFound();

  const contentBlocks = post.content
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <>
      <Nav />
      <main className="marketing-page marketing-page--article">
        <article className="blog-article">
          <Link href="/blog" className="blog-back">
            ← Zpět na blog
          </Link>

          <header className="blog-article-header">
            <div className="blog-meta">
              {formatDate(post.publishedAt)}
              {post.author?.name && <span> · {post.author.name}</span>}
            </div>
            <h1>{post.title}</h1>
            {post.excerpt && <p>{post.excerpt}</p>}
          </header>

          {post.coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.coverUrl} alt={post.title} className="blog-article-cover" />
          )}

          <div className="blog-article-content">
            {contentBlocks.map((block, index) => {
              const heading = block.match(/^(#{1,3})\s+(.+)$/);
              if (heading) {
                return <h2 key={`${index}-${heading[2]}`}>{heading[2]}</h2>;
              }
              return <p key={`${index}-${block.slice(0, 20)}`}>{block}</p>;
            })}
          </div>

          <div className="blog-article-cta">
            <h2>Chcete mít svou fotovoltaiku pod kontrolou?</h2>
            <p>Vyzkoušejte Spottex nebo si s námi nejdřív projděte možnosti na konzultaci.</p>
            <div>
              <Link href="/registrace" className="btn-primary">
                Vytvořit účet
              </Link>
              <Link href="/konzultace" className="btn-consultation">
                Domluvit konzultaci
              </Link>
            </div>
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
