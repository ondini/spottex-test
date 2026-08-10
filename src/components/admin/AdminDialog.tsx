"use client";

import { X } from "lucide-react";
import { useEffect, useId } from "react";

export function AdminDialog({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto p-4 sm:p-8">
      <button
        type="button"
        aria-label="Zavřít dialog"
        className="fixed inset-0 bg-slate-950/55 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="flex min-h-full items-start justify-center sm:items-center">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`relative w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 ${wide ? "max-w-4xl" : "max-w-2xl"}`}
        >
          <header className="flex items-start gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-lg font-semibold text-slate-900">
                {title}
              </h2>
              {description && <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid size-9 shrink-0 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Zavřít"
            >
              <X className="size-5" />
            </button>
          </header>
          {children}
        </section>
      </div>
    </div>
  );
}
