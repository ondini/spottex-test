import type { Metadata } from "next";
import Link from "next/link";
import { Footer, Nav } from "@/App";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Blog",
  description: "Novinky a praktické tipy ze světa fotovoltaiky, spotových cen a chytrého řízení energie.",
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

export default async function BlogPage() {
  const posts = await prisma.blogPost
    .findMany({
      where: { published: true },
      include: { author: { select: { name: true } } },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: 60,
    })
    .catch(() => []);

  return (
    <>
      <Nav />
      <main className="marketing-page">
        <header className="marketing-page-hero">
          <div className="badge">
            <span className="badge-dot" />
            Spottex blog
          </div>
          <h1>Chytřejší cesta k vlastní energii</h1>
          <p>
            Praktické tipy, zkušenosti a novinky ze světa fotovoltaiky, spotových cen
            a automatického řízení energie.
          </p>
        </header>

        {posts.length === 0 ? (
          <div className="blog-empty">
            <h2>První články připravujeme</h2>
            <p>Brzy tu najdete praktické návody a pohled do zákulisí Spottexu.</p>
            <Link href="/" className="btn-primary">
              Zpět na úvod
            </Link>
          </div>
        ) : (
          <div className="blog-grid">
            {posts.map((post) => (
              <Link href={`/blog/${post.slug}`} className="blog-card" key={post.id}>
                {post.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.coverUrl} alt="" className="blog-card-image" />
                ) : (
                  <div className="blog-card-image blog-card-image--placeholder" aria-hidden="true">
                    <span className="badge-dot" />
                  </div>
                )}
                <div className="blog-card-copy">
                  <div className="blog-meta">
                    {formatDate(post.publishedAt)}
                    {post.author?.name && <span> · {post.author.name}</span>}
                  </div>
                  <h2>{post.title}</h2>
                  {post.excerpt && <p>{post.excerpt}</p>}
                  <span className="blog-card-link">Číst článek →</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
