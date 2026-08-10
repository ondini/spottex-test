"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

type PasswordFieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

export function PasswordField({ label, className, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <span className="relative block">
        <input
          {...props}
          type={visible ? "text" : "password"}
          className={`app-input pr-12 ${className || ""}`}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          className="absolute inset-y-0 right-0 grid w-12 place-items-center text-slate-400 transition hover:text-slate-700"
          aria-label={visible ? "Skrýt heslo" : "Zobrazit heslo"}
        >
          {visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      </span>
    </label>
  );
}

