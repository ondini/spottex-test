"use client";

import { BookOpenText, ExternalLink, Eye, EyeOff, FilePenLine, Pencil, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { EmptyState, StatusBadge } from "@/components/app-shell/PagePrimitives";
import { AdminDialog } from "@/components/admin/AdminDialog";

export type BlogPostRecord = {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  coverUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  author: { name: string | null; email: string } | null;
};

function optionalString(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "—";
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => null)) as ({ error?: string } & T) | null;
  if (!response.ok) {
    if (response.status === 403) throw new Error("Pro tuto změnu nemáte oprávnění.");
    if (response.status === 400) throw new Error("Zkontrolujte obsah článku a formát slugu.");
    throw new Error(data?.error || "Změnu se nepodařilo uložit.");
  }
  return data as T;
}

function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {hint && <span className="ml-2 text-xs font-normal text-slate-400">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

function PostForm({
  post,
  busy,
  onCancel,
  onSubmit,
}: {
  post: BlogPostRecord | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <form action={onSubmit}>
      <div className="grid max-h-[70vh] gap-5 overflow-y-auto p-5 sm:grid-cols-2 sm:p-6">
        <Field label="Název článku" className="sm:col-span-2">
          <input name="title" className="app-input" required minLength={3} maxLength={220} defaultValue={post?.title || ""} placeholder="Jak využít záporné ceny elektřiny" />
        </Field>
        <Field label="Slug" hint="prázdný vytvoříme z názvu">
          <input name="slug" className="app-input" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" defaultValue={post?.slug || ""} placeholder="jak-vyuzit-zaporne-ceny" />
        </Field>
        <Field label="URL titulního obrázku">
          <input name="coverUrl" className="app-input" type="url" defaultValue={post?.coverUrl || ""} placeholder="https://…" />
        </Field>
        <Field label="Perex" hint="max. 800 znaků" className="sm:col-span-2">
          <textarea name="excerpt" className="app-input min-h-24 resize-y" maxLength={800} defaultValue={post?.excerpt || ""} placeholder="Krátké shrnutí pro výpis článků a vyhledávače." />
        </Field>
        <Field label="Obsah" hint="odstavce oddělte prázdným řádkem, nadpis začněte ##" className="sm:col-span-2">
          <textarea name="content" className="app-input min-h-[22rem] resize-y font-mono text-sm leading-6" required maxLength={100000} defaultValue={post?.content || ""} placeholder={"Úvodní odstavec…\n\n## První kapitola\n\nText kapitoly…"} />
        </Field>

        <div className="sm:col-span-2">
          <div className="mb-3 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-100" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">SEO nastavení</span>
            <div className="h-px flex-1 bg-slate-100" />
          </div>
        </div>
        <Field label="SEO title" hint="pokud se liší od názvu">
          <input name="seoTitle" className="app-input" maxLength={220} defaultValue={post?.seoTitle || ""} />
        </Field>
        <Field label="SEO description" hint="max. 500 znaků">
          <textarea name="seoDescription" className="app-input min-h-20 resize-y" maxLength={500} defaultValue={post?.seoDescription || ""} />
        </Field>

        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 sm:col-span-2">
          <input name="published" type="checkbox" defaultChecked={post?.published ?? false} className="size-4 accent-brand-600" />
          <span>
            <span className="block text-sm font-medium text-slate-800">Publikovat článek</span>
            <span className="block text-xs text-slate-500">Při první publikaci se automaticky uloží datum zveřejnění.</span>
          </span>
        </label>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
        <button type="button" onClick={onCancel} disabled={busy} className="app-button app-button-secondary">Zrušit</button>
        <button type="submit" disabled={busy} className="app-button disabled:cursor-wait disabled:opacity-60">{busy ? "Ukládám…" : "Uložit článek"}</button>
      </div>
    </form>
  );
}

export default function BlogManager({ initialPosts }: { initialPosts: BlogPostRecord[] }) {
  const [posts, setPosts] = useState(initialPosts);
  const [editor, setEditor] = useState<{ post: BlogPostRecord | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const closeEditor = useCallback(() => {
    if (!busy) setEditor(null);
  }, [busy]);

  const filteredPosts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("cs-CZ");
    if (!normalized) return posts;
    return posts.filter((post) => `${post.title} ${post.slug} ${post.excerpt || ""}`.toLocaleLowerCase("cs-CZ").includes(normalized));
  }, [posts, query]);

  async function reload() {
    const data = await requestJson<{ posts: BlogPostRecord[] }>("/api/admin/blog", { cache: "no-store" });
    setPosts(data.posts);
  }

  function showSuccess(text: string) {
    setMessage({ tone: "success", text });
    window.setTimeout(() => setMessage(null), 3500);
  }

  async function save(formData: FormData) {
    const post = editor?.post || null;
    const title = String(formData.get("title") || "").trim();
    const enteredSlug = String(formData.get("slug") || "").trim();
    setBusy(true);
    setMessage(null);
    try {
      const payload = {
        title,
        slug: enteredSlug || slugify(title),
        excerpt: optionalString(formData.get("excerpt")),
        content: String(formData.get("content") || "").trim(),
        coverUrl: optionalString(formData.get("coverUrl")),
        seoTitle: optionalString(formData.get("seoTitle")),
        seoDescription: optionalString(formData.get("seoDescription")),
        published: formData.get("published") === "on",
      };
      await requestJson(post ? `/api/admin/blog/${post.id}` : "/api/admin/blog", {
        method: post ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await reload();
      setEditor(null);
      showSuccess(post ? "Článek byl upraven." : "Článek byl vytvořen.");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Uložení se nezdařilo." });
    } finally {
      setBusy(false);
    }
  }

  async function togglePublished(post: BlogPostRecord) {
    setRowBusy(post.id);
    setMessage(null);
    try {
      await requestJson(`/api/admin/blog/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published: !post.published }),
      });
      await reload();
      showSuccess(post.published ? "Článek byl stažen z webu." : "Článek je nyní publikovaný.");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Změna publikace se nezdařila." });
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(post: BlogPostRecord) {
    if (!window.confirm(`Opravdu chcete trvale smazat článek „${post.title}“?`)) return;
    setRowBusy(post.id);
    setMessage(null);
    try {
      await requestJson(`/api/admin/blog/${post.id}`, { method: "DELETE" });
      await reload();
      showSuccess("Článek byl smazán.");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Smazání se nezdařilo." });
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {message && (
        <div role="status" className={`rounded-xl border px-4 py-3 text-sm font-medium ${message.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {message.text}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative w-full sm:max-w-md">
          <span className="sr-only">Hledat články</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="app-input pl-9" placeholder="Hledat podle názvu, slugu nebo perexu…" />
        </label>
        <button type="button" onClick={() => setEditor({ post: null })} className="app-button shrink-0"><Plus className="size-4" /> Nový článek</button>
      </div>

      {posts.length === 0 ? (
        <EmptyState
          icon={BookOpenText}
          title="Blog je zatím prázdný"
          description="Vytvořte první článek. Můžete jej uložit jako koncept a publikovat později."
          action={<button type="button" onClick={() => setEditor({ post: null })} className="app-button"><Plus className="size-4" /> Vytvořit první článek</button>}
        />
      ) : filteredPosts.length === 0 ? (
        <div className="app-card flex min-h-52 flex-col items-center justify-center p-8 text-center">
          <Search className="size-8 text-slate-300" />
          <h3 className="mt-3 font-semibold text-slate-800">Žádný odpovídající článek</h3>
          <button type="button" onClick={() => setQuery("")} className="mt-2 text-sm font-semibold text-brand-700">Zrušit hledání</button>
        </div>
      ) : (
        <div className="app-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[850px] w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Článek</th>
                  <th className="px-5 py-3">Autor</th>
                  <th className="px-5 py-3">Aktualizováno</th>
                  <th className="px-5 py-3">Stav</th>
                  <th className="px-5 py-3 text-right">Akce</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPosts.map((post) => {
                  const isBusy = rowBusy === post.id;
                  return (
                    <tr key={post.id} className="align-top hover:bg-slate-50/60">
                      <td className="max-w-lg px-5 py-4">
                        <div className="flex items-start gap-3">
                          {post.coverUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={post.coverUrl} alt="" className="hidden size-14 shrink-0 rounded-xl bg-slate-100 object-cover sm:block" />
                          ) : (
                            <span className="hidden size-14 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 sm:grid"><FilePenLine className="size-5" /></span>
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900">{post.title}</p>
                            <p className="mt-1 truncate font-mono text-xs text-slate-400">/blog/{post.slug}</p>
                            {post.excerpt && <p className="mt-1 line-clamp-1 text-xs text-slate-500">{post.excerpt}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-slate-500">{post.author?.name || post.author?.email || "—"}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-slate-500">{formatDate(post.updatedAt)}</td>
                      <td className="px-5 py-4"><StatusBadge tone={post.published ? "success" : "neutral"}>{post.published ? "Publikováno" : "Koncept"}</StatusBadge>{post.publishedAt && <p className="mt-1.5 whitespace-nowrap text-[11px] text-slate-400">{formatDate(post.publishedAt)}</p>}</td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-1">
                          {post.published && <Link href={`/blog/${post.slug}`} target="_blank" className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Otevřít článek"><ExternalLink className="size-4" /></Link>}
                          <button type="button" onClick={() => setEditor({ post })} className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Upravit"><Pencil className="size-4" /></button>
                          <button type="button" disabled={isBusy} onClick={() => togglePublished(post)} className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50" title={post.published ? "Stáhnout z webu" : "Publikovat"}>{post.published ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
                          <button type="button" disabled={isBusy} onClick={() => remove(post)} className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50" title="Smazat"><Trash2 className="size-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AdminDialog
        open={editor !== null}
        onClose={closeEditor}
        title={editor?.post ? "Upravit článek" : "Nový článek"}
        description="Článek můžete uložit jako koncept a publikovat až po dokončení."
        wide
      >
        {editor && <PostForm post={editor.post} busy={busy} onCancel={closeEditor} onSubmit={save} />}
      </AdminDialog>
    </div>
  );
}
