import { NavLink, Outlet } from "react-router-dom";
import type { Overview } from "../../lib/types";
import { useApi } from "../../lib/useApi";
import { ApiError } from "../../lib/api";
import { Button, Card, ErrorBox, Icon, Spinner, cx } from "../../components/ui";

const NAV = [
  { to: "/owner", end: true, icon: "home", label: "Panel" },
  { to: "/owner/subscribers", icon: "users", label: "Obunachilar" },
  { to: "/owner/plans", icon: "tag", label: "Tariflar" },
  { to: "/owner/kassa", icon: "wallet", label: "Kassa" },
];

export type OwnerCtx = { overview: Overview; reload: () => Promise<void> };

/** Sidebar on desktop, bottom tab bar on phones (inside Telegram). */
export default function OwnerLayout() {
  const { data, error, loading, reload } = useApi<Overview>("/api/owner/overview");

  if (loading && !data) return <Spinner />;
  if (error instanceof ApiError && error.status === 403)
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-6 pt-16 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Icon name="plus" size={30} /></div>
        <h1 className="text-xl font-bold">Kanalingizni ulang</h1>
        <p className="text-sm leading-relaxed text-muted">
          Botni kanalingizga admin qiling («Foydalanuvchilarni taklif qilish» va «Bloklash» huquqlari bilan). Shaxsiy kassangiz avtomatik ochiladi.
        </p>
        <Button size="lg" onClick={() => (window as any).Telegram?.WebApp?.close?.()}>Botga qaytish</Button>
      </main>
    );
  if (error || !data) return <div className="p-4"><ErrorBox error={error ?? new Error("Xatolik")} onRetry={reload} /></div>;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-1 border-r border-line bg-surface p-4 md:flex">
        <div className="flex items-center gap-2.5 px-2 pb-6 pt-1">
          <div className="flex size-9 items-center justify-center rounded-xl bg-accent font-bold text-accent-ink">Ob</div>
          <span className="text-lg font-bold tracking-tight">Obuna</span>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}
            className={({ isActive }) => cx("flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium",
              isActive ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised hover:text-ink")}>
            <Icon name={n.icon} />{n.label}
          </NavLink>
        ))}
        <Card className="mt-auto bg-raised p-3 text-xs text-muted">{data.owner.name}</Card>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-8">
          <Outlet context={{ overview: data, reload } satisfies OwnerCtx} />
        </main>
        <nav aria-label="Bo'limlar" className="fixed inset-x-0 bottom-0 grid grid-cols-4 border-t border-line bg-bg/95 px-1 pb-5 pt-1.5 backdrop-blur md:hidden">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cx("flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", isActive ? "text-accent" : "text-muted")}>
              <Icon name={n.icon} size={22} />{n.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
