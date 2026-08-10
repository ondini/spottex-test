"use client";

import {
  Building2,
  ExternalLink,
  Eye,
  EyeOff,
  Linkedin,
  Mail,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useCallback, useState } from "react";

import { EmptyState, StatusBadge } from "@/components/app-shell/PagePrimitives";
import { AdminDialog } from "@/components/admin/AdminDialog";

export type FounderRecord = {
  id: number;
  name: string;
  title: string | null;
  bio: string | null;
  photoUrl: string | null;
  linkedInUrl: string | null;
  email: string | null;
  published: boolean;
  sortOrder: number;
  updatedAt: string;
};

export type ReferenceProjectRecord = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  url: string | null;
  location: string | null;
  published: boolean;
  sortOrder: number;
  updatedAt: string;
};

type EditorState =
  | { kind: "founder"; item: FounderRecord | null }
  | { kind: "project"; item: ReferenceProjectRecord | null }
  | null;

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

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => null)) as ({ error?: string } & T) | null;
  if (!response.ok) {
    if (response.status === 403) throw new Error("Pro tuto změnu nemáte oprávnění.");
    if (response.status === 400) throw new Error("Zkontrolujte vyplněné údaje.");
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

function FormActions({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
      <button type="button" onClick={onCancel} disabled={busy} className="app-button app-button-secondary">
        Zrušit
      </button>
      <button type="submit" disabled={busy} className="app-button disabled:cursor-wait disabled:opacity-60">
        {busy ? "Ukládám…" : "Uložit"}
      </button>
    </div>
  );
}

function FounderForm({
  founder,
  busy,
  onCancel,
  onSubmit,
}: {
  founder: FounderRecord | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <form action={onSubmit}>
      <div className="grid max-h-[65vh] gap-5 overflow-y-auto p-5 sm:grid-cols-2 sm:p-6">
        <Field label="Jméno" className="sm:col-span-2">
          <input name="name" className="app-input" required minLength={2} maxLength={120} defaultValue={founder?.name || ""} />
        </Field>
        <Field label="Pozice / role">
          <input name="title" className="app-input" maxLength={160} defaultValue={founder?.title || ""} placeholder="Co-founder & CEO" />
        </Field>
        <Field label="Pořadí" hint="nižší je první">
          <input name="sortOrder" className="app-input" type="number" min={0} max={999} defaultValue={founder?.sortOrder ?? 0} />
        </Field>
        <Field label="URL fotografie" className="sm:col-span-2">
          <input name="photoUrl" className="app-input" type="url" defaultValue={founder?.photoUrl || ""} placeholder="https://…" />
        </Field>
        <Field label="LinkedIn">
          <input name="linkedInUrl" className="app-input" type="url" defaultValue={founder?.linkedInUrl || ""} placeholder="https://linkedin.com/in/…" />
        </Field>
        <Field label="Kontaktní e-mail">
          <input name="email" className="app-input" type="email" defaultValue={founder?.email || ""} placeholder="jmeno@spottex.cz" />
        </Field>
        <Field label="Medailonek" className="sm:col-span-2">
          <textarea name="bio" className="app-input min-h-32 resize-y" maxLength={4000} defaultValue={founder?.bio || ""} />
        </Field>
        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 sm:col-span-2">
          <input name="published" type="checkbox" defaultChecked={founder?.published ?? false} className="size-4 accent-brand-600" />
          <span>
            <span className="block text-sm font-medium text-slate-800">Zobrazit na landing page</span>
            <span className="block text-xs text-slate-500">Nepublikovaný profil zůstane uložený pouze v administraci.</span>
          </span>
        </label>
      </div>
      <FormActions busy={busy} onCancel={onCancel} />
    </form>
  );
}

function ProjectForm({
  project,
  busy,
  onCancel,
  onSubmit,
}: {
  project: ReferenceProjectRecord | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <form action={onSubmit}>
      <div className="grid max-h-[65vh] gap-5 overflow-y-auto p-5 sm:grid-cols-2 sm:p-6">
        <Field label="Název projektu">
          <input name="name" className="app-input" required minLength={2} maxLength={160} defaultValue={project?.name || ""} />
        </Field>
        <Field label="Slug" hint="malá písmena a pomlčky">
          <input name="slug" className="app-input" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" defaultValue={project?.slug || ""} placeholder="rodinny-dum-praha" />
        </Field>
        <Field label="Lokalita">
          <input name="location" className="app-input" maxLength={160} defaultValue={project?.location || ""} placeholder="Praha" />
        </Field>
        <Field label="Pořadí" hint="nižší je první">
          <input name="sortOrder" className="app-input" type="number" min={0} max={999} defaultValue={project?.sortOrder ?? 0} />
        </Field>
        <Field label="URL obrázku" className="sm:col-span-2">
          <input name="imageUrl" className="app-input" type="url" defaultValue={project?.imageUrl || ""} placeholder="https://…" />
        </Field>
        <Field label="Odkaz na projekt" className="sm:col-span-2">
          <input name="url" className="app-input" type="url" defaultValue={project?.url || ""} placeholder="https://…" />
        </Field>
        <Field label="Popis" className="sm:col-span-2">
          <textarea name="description" className="app-input min-h-32 resize-y" maxLength={5000} defaultValue={project?.description || ""} />
        </Field>
        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 sm:col-span-2">
          <input name="published" type="checkbox" defaultChecked={project?.published ?? false} className="size-4 accent-brand-600" />
          <span>
            <span className="block text-sm font-medium text-slate-800">Zobrazit v referencích</span>
            <span className="block text-xs text-slate-500">Zveřejní projekt v referenční sekci landing page.</span>
          </span>
        </label>
      </div>
      <FormActions busy={busy} onCancel={onCancel} />
    </form>
  );
}

export default function LandingContentManager({
  initialFounders,
  initialProjects,
}: {
  initialFounders: FounderRecord[];
  initialProjects: ReferenceProjectRecord[];
}) {
  const [activeTab, setActiveTab] = useState<"founders" | "projects">("founders");
  const [founders, setFounders] = useState(initialFounders);
  const [projects, setProjects] = useState(initialProjects);
  const [editor, setEditor] = useState<EditorState>(null);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const closeEditor = useCallback(() => {
    if (!busy) setEditor(null);
  }, [busy]);

  async function reload() {
    const [founderData, projectData] = await Promise.all([
      requestJson<{ founders: FounderRecord[] }>("/api/admin/content/founders", { cache: "no-store" }),
      requestJson<{ projects: ReferenceProjectRecord[] }>("/api/admin/content/projects", { cache: "no-store" }),
    ]);
    setFounders(founderData.founders);
    setProjects(projectData.projects);
  }

  function showSuccess(text: string) {
    setMessage({ tone: "success", text });
    window.setTimeout(() => setMessage(null), 3500);
  }

  async function saveFounder(formData: FormData) {
    const item = editor?.kind === "founder" ? editor.item : null;
    setBusy(true);
    setMessage(null);
    try {
      const payload = {
        name: String(formData.get("name") || "").trim(),
        title: optionalString(formData.get("title")),
        bio: optionalString(formData.get("bio")),
        photoUrl: optionalString(formData.get("photoUrl")),
        linkedInUrl: optionalString(formData.get("linkedInUrl")),
        email: optionalString(formData.get("email")),
        published: formData.get("published") === "on",
        sortOrder: Number(formData.get("sortOrder") || 0),
      };
      await requestJson(item ? `/api/admin/content/founders/${item.id}` : "/api/admin/content/founders", {
        method: item ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await reload();
      setEditor(null);
      showSuccess(item ? "Profil zakladatele byl upraven." : "Profil zakladatele byl vytvořen.");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Uložení se nezdařilo." });
    } finally {
      setBusy(false);
    }
  }

  async function saveProject(formData: FormData) {
    const item = editor?.kind === "project" ? editor.item : null;
    const name = String(formData.get("name") || "").trim();
    const enteredSlug = String(formData.get("slug") || "").trim();
    setBusy(true);
    setMessage(null);
    try {
      const payload = {
        name,
        slug: enteredSlug || slugify(name),
        description: optionalString(formData.get("description")),
        imageUrl: optionalString(formData.get("imageUrl")),
        url: optionalString(formData.get("url")),
        location: optionalString(formData.get("location")),
        published: formData.get("published") === "on",
        sortOrder: Number(formData.get("sortOrder") || 0),
      };
      await requestJson(item ? `/api/admin/content/projects/${item.id}` : "/api/admin/content/projects", {
        method: item ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await reload();
      setEditor(null);
      showSuccess(item ? "Reference byla upravena." : "Reference byla vytvořena.");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Uložení se nezdařilo." });
    } finally {
      setBusy(false);
    }
  }

  async function togglePublished(kind: "founder" | "project", id: number, published: boolean) {
    const key = `${kind}-${id}`;
    setRowBusy(key);
    setMessage(null);
    try {
      const base = kind === "founder" ? "founders" : "projects";
      await requestJson(`/api/admin/content/${base}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published }),
      });
      await reload();
      showSuccess(published ? "Položka je nyní veřejná." : "Položka byla skryta z webu.");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Změna publikace se nezdařila." });
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(kind: "founder" | "project", id: number, name: string) {
    if (!window.confirm(`Opravdu chcete trvale smazat „${name}“?`)) return;
    const key = `${kind}-${id}`;
    setRowBusy(key);
    setMessage(null);
    try {
      const base = kind === "founder" ? "founders" : "projects";
      await requestJson(`/api/admin/content/${base}/${id}`, { method: "DELETE" });
      await reload();
      showSuccess("Položka byla smazána.");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Smazání se nezdařilo." });
    } finally {
      setRowBusy(null);
    }
  }

  const currentCount = activeTab === "founders" ? founders.length : projects.length;

  return (
    <div className="space-y-5">
      {message && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm font-medium ${
            message.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex self-start rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab("founders")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activeTab === "founders" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}
          >
            Zakladatelé <span className="ml-1 opacity-60">{founders.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("projects")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activeTab === "projects" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}
          >
            Reference <span className="ml-1 opacity-60">{projects.length}</span>
          </button>
        </div>
        <button
          type="button"
          onClick={() => setEditor(activeTab === "founders" ? { kind: "founder", item: null } : { kind: "project", item: null })}
          className="app-button"
        >
          <Plus className="size-4" /> {activeTab === "founders" ? "Přidat zakladatele" : "Přidat referenci"}
        </button>
      </div>

      {currentCount === 0 ? (
        <EmptyState
          icon={activeTab === "founders" ? UsersRound : Building2}
          title={activeTab === "founders" ? "Zatím bez zakladatelů" : "Zatím bez referencí"}
          description={activeTab === "founders" ? "Přidejte profily lidí, kteří stojí za Spottexem." : "Přidejte referenční instalace a projekty pro veřejnou landing page."}
          action={
            <button
              type="button"
              onClick={() => setEditor(activeTab === "founders" ? { kind: "founder", item: null } : { kind: "project", item: null })}
              className="app-button"
            >
              <Plus className="size-4" /> Přidat první položku
            </button>
          }
        />
      ) : activeTab === "founders" ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {founders.map((founder) => {
            const isBusy = rowBusy === `founder-${founder.id}`;
            return (
              <article key={founder.id} className="app-card flex min-w-0 flex-col gap-4 p-5 sm:flex-row">
                {founder.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={founder.photoUrl} alt="" className="size-24 shrink-0 rounded-2xl bg-slate-100 object-cover" />
                ) : (
                  <div className="grid size-24 shrink-0 place-items-center rounded-2xl bg-brand-50 text-2xl font-bold text-brand-700">
                    {founder.name.slice(0, 1).toLocaleUpperCase("cs-CZ")}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-slate-900">{founder.name}</h3>
                      <p className="mt-0.5 text-sm text-slate-500">{founder.title || "Role neuvedena"}</p>
                    </div>
                    <StatusBadge tone={founder.published ? "success" : "neutral"}>{founder.published ? "Veřejné" : "Koncept"}</StatusBadge>
                  </div>
                  {founder.bio && <p className="mt-3 line-clamp-2 text-sm leading-5 text-slate-500">{founder.bio}</p>}
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
                    <span>Pořadí {founder.sortOrder}</span>
                    {founder.email && <span className="inline-flex items-center gap-1"><Mail className="size-3" /> {founder.email}</span>}
                    {founder.linkedInUrl && <span className="inline-flex items-center gap-1"><Linkedin className="size-3" /> LinkedIn</span>}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setEditor({ kind: "founder", item: founder })} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                      <Pencil className="size-3.5" /> Upravit
                    </button>
                    <button type="button" disabled={isBusy} onClick={() => togglePublished("founder", founder.id, !founder.published)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                      {founder.published ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} {founder.published ? "Skrýt" : "Publikovat"}
                    </button>
                    <button type="button" disabled={isBusy} onClick={() => remove("founder", founder.id, founder.name)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                      <Trash2 className="size-3.5" /> Smazat
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const isBusy = rowBusy === `project-${project.id}`;
            return (
              <article key={project.id} className="app-card overflow-hidden">
                {project.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={project.imageUrl} alt="" className="h-40 w-full bg-slate-100 object-cover" />
                ) : (
                  <div className="grid h-40 place-items-center bg-gradient-to-br from-brand-50 to-slate-100 text-brand-300"><Building2 className="size-10" /></div>
                )}
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-slate-900">{project.name}</h3>
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400"><MapPin className="size-3" /> {project.location || "Lokalita neuvedena"}</p>
                    </div>
                    <StatusBadge tone={project.published ? "success" : "neutral"}>{project.published ? "Veřejné" : "Koncept"}</StatusBadge>
                  </div>
                  {project.description && <p className="mt-3 line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-slate-500">{project.description}</p>}
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                    <span>Pořadí {project.sortOrder}</span>
                    {project.url && <a href={project.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:text-brand-600">Otevřít <ExternalLink className="size-3" /></a>}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                    <button type="button" onClick={() => setEditor({ kind: "project", item: project })} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                      <Pencil className="size-3.5" /> Upravit
                    </button>
                    <button type="button" disabled={isBusy} onClick={() => togglePublished("project", project.id, !project.published)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                      {project.published ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} {project.published ? "Skrýt" : "Publikovat"}
                    </button>
                    <button type="button" disabled={isBusy} onClick={() => remove("project", project.id, project.name)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <AdminDialog
        open={editor?.kind === "founder"}
        onClose={closeEditor}
        title={editor?.kind === "founder" && editor.item ? "Upravit zakladatele" : "Přidat zakladatele"}
        description="Profil se na webu zobrazí až po zapnutí publikace."
      >
        {editor?.kind === "founder" && (
          <FounderForm founder={editor.item} busy={busy} onCancel={closeEditor} onSubmit={saveFounder} />
        )}
      </AdminDialog>

      <AdminDialog
        open={editor?.kind === "project"}
        onClose={closeEditor}
        title={editor?.kind === "project" && editor.item ? "Upravit referenci" : "Přidat referenci"}
        description="Reference může odkazovat na detail projektu nebo externí prezentaci."
      >
        {editor?.kind === "project" && (
          <ProjectForm project={editor.item} busy={busy} onCancel={closeEditor} onSubmit={saveProject} />
        )}
      </AdminDialog>
    </div>
  );
}
