import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { useEffect, useState } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({
  variant = "primary", size = "md", className, ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "soft" | "ghost" | "outline"; size?: "md" | "lg" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98]",
        size === "lg" ? "h-13 px-5 text-base" : "h-11 px-4 text-sm",
        variant === "primary" && "bg-accent text-accent-ink hover:brightness-110",
        variant === "soft" && "bg-raised text-ink hover:brightness-110",
        variant === "ghost" && "text-accent hover:bg-raised",
        variant === "outline" && "border border-line text-ink hover:bg-raised",
        className,
      )}
    />
  );
}

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cx("rounded-2xl bg-surface", className)}>{children}</div>
);

export const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">{children}</h2>
);

export function Badge({ tone = "neutral", children }: { tone?: "ok" | "warn" | "neutral"; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex rounded-md px-2 py-0.5 text-xs font-semibold",
        tone === "ok" && "bg-accent-soft text-accent",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "neutral" && "bg-raised text-muted",
      )}
    >
      {children}
    </span>
  );
}

const PALETTE = ["#2dd4bf", "#60a5fa", "#a78bfa", "#fb923c", "#f472b6", "#facc15"];
export function Avatar({ name, size = 44, seed = 0, src }: { name: string; size?: number; seed?: number; src?: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken)
    return <img src={src} alt="" aria-hidden="true" onError={() => setBroken(true)} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-[#04201c]"
      style={{ width: size, height: size, background: PALETTE[seed % PALETTE.length], fontSize: size * 0.36 }}
    >
      {ini || "?"}
    </div>
  );
}

export function Field({ label, hint, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 rounded-xl bg-surface px-4 py-3 text-xs text-muted focus-within:ring-2 focus-within:ring-accent">
      {label}
      <input {...p} className="bg-transparent text-[17px] text-ink outline-none placeholder:text-muted/60" />
      {hint && <span className="text-[11px]">{hint}</span>}
    </label>
  );
}

export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-surface px-4 text-left"
    >
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-[15px]">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
      <span className={cx("flex h-7.5 w-12.5 items-center rounded-full p-0.5 transition", on ? "justify-end bg-accent" : "justify-start bg-line")}>
        <span className="size-6.5 rounded-full bg-white shadow" />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-surface p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("h-10 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-semibold", value === o.value ? "bg-raised text-ink" : "text-muted")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const Spinner = () => (
  <div className="flex justify-center py-16" role="status" aria-label="Yuklanmoqda">
    <div className="size-8 animate-spin rounded-full border-2 border-line border-t-accent" />
  </div>
);

export function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 p-6 text-center">
      <p className="text-sm text-muted">{error.message}</p>
      {onRetry && <Button variant="soft" onClick={onRetry}>Qayta urinish</Button>}
    </Card>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  // The page behind must not scroll while the sheet is open, or the touch goes to the wrong layer.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-3xl bg-bg sm:rounded-3xl"
      >
        <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button aria-label="Yopish" onClick={onClose} className="flex size-11 items-center justify-center rounded-full hover:bg-raised">
            <Icon name="x" />
          </button>
        </div>
        {/* The body scrolls on its own, so every field is reachable on short phones and with the keyboard open. */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-5 [&>*]:shrink-0 pb-[max(2rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}

const PATHS: Record<string, string> = {
  x: "M6 6l12 12M18 6L6 18",
  check: "M5 12l5 5L20 7",
  lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z",
  card: "M3 6h18v13H3zM3 10h18",
  home: "M3 12l9-8 9 8M5 10v10h14V10",
  users: "M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5-5-5.5",
  tag: "M3 12V3h9l9 9-9 9zM7.5 7.5h.01",
  wallet: "M3 7h15a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-4v4M17 14h.01",
  copy: "M9 9h12v12H9zM5 15V3h12",
  plus: "M12 5v14M5 12h14",
  chevron: "M9 6l6 6-6 6",
  refresh: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  arrowUp: "M12 19V5M5 12l7-7 7 7",
  arrowDown: "M12 5v14M5 12l7 7 7-7",
};
export function Icon({ name, size = 20, className }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "up" | "down" }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xl font-bold tracking-tight sm:text-2xl">{value}</span>
      {note && <span className={cx("text-xs", tone === "up" ? "text-accent" : tone === "down" ? "text-warn" : "text-muted")}>{note}</span>}
    </Card>
  );
}

export function BarChart({ data }: { data: { label: string; value: number; display: string }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex h-48 items-end gap-2 sm:gap-4" role="img" aria-label={data.map((d) => `${d.label}: ${d.display}`).join(", ")}>
      {data.map((d, i) => (
        <div key={d.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
          <span className="text-[11px] text-muted">{d.display}</span>
          <div
            className={cx("w-full max-w-14 rounded-t-lg transition-all", i === data.length - 1 ? "bg-accent" : "bg-accent-soft")}
            style={{ height: `${Math.max(3, (d.value / max) * 82)}%` }}
          />
          <span className="text-[11px] text-muted">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export { cx };
