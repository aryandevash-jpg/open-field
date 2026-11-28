"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// Unread count is polled; there is no realtime channel in the MVP.
const POLL_MS = 30_000;

export function Nav() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = () =>
      api<{ unread: number }>("GET", "/notifications?limit=1")
        .then((data) => !cancelled && setUnread(data.unread))
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user, pathname]);

  if (!user) return null;

  const links = [
    { href: "/", label: "Home" },
    { href: "/reports", label: user.isPlatformAdmin ? "Review queue" : "My reports" },
    { href: "/organizations", label: "Organizations" },
    { href: "/events", label: "Events" },
    ...(user.isPlatformAdmin ? [{ href: "/categories", label: "Categories" }] : []),
  ];
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold text-emerald-800">
          OpenField
        </Link>
        <nav className={`${open ? "flex" : "hidden"} absolute left-0 right-0 top-14 z-[1000] flex-col gap-1 border-b border-slate-200 bg-white p-3 md:static md:flex md:flex-row md:border-0 md:p-0`}>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className={`rounded-md px-3 py-1.5 text-sm ${isActive(link.href) ? "bg-emerald-50 font-medium text-emerald-800" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {link.label}
            </Link>
          ))}
          {/* Header buttons that are hidden on small screens live in the menu instead. */}
          <Link href="/reports/new" onClick={() => setOpen(false)} className="rounded-md px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-slate-100 sm:hidden">
            Report an issue
          </Link>
          <button
            onClick={() => {
              setOpen(false);
              logout();
              router.push("/login");
            }}
            className="rounded-md px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-100 md:hidden"
          >
            Sign out
          </button>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/reports/new" className="hidden rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 sm:inline-block">
            Report an issue
          </Link>
          <Link href="/notifications" className="relative rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100" aria-label="Notifications">
            🔔
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>
            )}
          </Link>
          <button
            onClick={() => {
              logout();
              router.push("/login");
            }}
            className="hidden rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 md:inline-block"
            title={user.email}
          >
            Sign out
          </button>
          <button className="rounded-md px-2 py-1.5 text-slate-600 hover:bg-slate-100 md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
            ☰
          </button>
        </div>
      </div>
    </header>
  );
}
