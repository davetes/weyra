import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import {
  IconDashboard,
  IconUsers,
  IconGamepad,
  IconDeposit,
  IconWithdraw,
  IconShield,
  IconSettings,
  IconTerminal,
  IconWallet,
  IconTrendingUp,
  IconClock,
  IconLogout,
  IconMenu,
  IconX,
  IconBell,
  IconDot,
} from "./Icons";

const NAV = [
  { href: "/app", label: "Dashboard", icon: IconDashboard },
  { href: "/rooms", label: "Rooms", perm: "settings.read", icon: IconGamepad },
  { href: "/games", label: "Games", perm: "settings.read", icon: IconGamepad },
  { href: "/players", label: "Players", perm: "players.read", icon: IconUsers },
  {
    href: "/transactions",
    label: "Transactions",
    perm: "finance.read",
    icon: IconWallet,
  },
  {
    href: "/finance",
    label: "Finance Summary",
    perm: "finance.read",
    icon: IconTrendingUp,
  },
  { href: "/audit", label: "Audit Logs", perm: "audit.read", icon: IconClock },
  {
    href: "/health",
    label: "Health",
    perm: "settings.read",
    icon: IconTerminal,
  },
  {
    href: "/announce",
    label: "Announcements",
    perm: "announce.send",
    icon: IconTerminal,
  },
  {
    href: "/deposit",
    label: "Deposits",
    perm: "deposit.read",
    icon: IconDeposit,
    badge: "pendingDeposits",
  },
  {
    href: "/withdraw",
    label: "Withdrawals",
    perm: "withdraw.read",
    icon: IconWithdraw,
    badge: "pendingWithdraws",
  },
  {
    href: "/admins",
    label: "Admin Users",
    role: "super_admin",
    icon: IconShield,
  },
  {
    href: "/settings",
    label: "Settings",
    perm: "settings.read",
    icon: IconSettings,
  },
  { href: "/commands", label: "Bot Commands", icon: IconTerminal },
];

function canShow(item, admin) {
  if (!item.role) return true;
  if (item.role === "super_admin") return admin?.role === "super_admin";
  return true;
}

function hasPerm(admin, perm) {
  if (!perm) return true;
  if (admin?.role === "super_admin") return true;
  const perms = Array.isArray(admin?.permissions) ? admin.permissions : [];
  return perms.includes(perm);
}

export default function AdminShell({
  admin,
  onLogout,
  children,
  title,
  pendingCounts = {},
}) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = NAV.filter(
    (i) => canShow(i, admin) && hasPerm(admin, i.perm),
  );

  const roleLabel =
    admin?.role === "super_admin"
      ? "Super Admin"
      : admin?.role === "entertainer"
        ? "Entertainer"
        : "Admin";

  const roleColor =
    admin?.role === "super_admin"
      ? "text-accent-light"
      : admin?.role === "entertainer"
        ? "text-warning"
        : "text-success";

  return (
    <div className="min-h-screen bg-bg text-slate-100 flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-screen w-[260px] bg-panel border-r border-border flex flex-col transition-transform duration-300 shadow-sidebar ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Logo area */}
        <div className="px-5 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center text-white font-bold text-sm shadow-glow">
              W
            </div>
            <div>
              <div className="font-bold text-sm text-slate-100 tracking-wide">
                Weyra Bingo
              </div>
              <div className="text-[10px] text-muted font-medium uppercase tracking-widest">
                Admin Panel
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          <div className="text-[10px] text-muted font-semibold uppercase tracking-widest px-3 mb-2">
            Navigation
          </div>
          {navItems.map((item) => {
            const active = router.pathname === item.href;
            const Icon = item.icon;
            const badgeCount = item.badge ? pendingCounts[item.badge] : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? "bg-accent/15 text-accent-light shadow-sm border border-accent/20"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
                }`}
              >
                <Icon size={18} className={active ? "text-accent-light" : ""} />
                <span className="flex-1">{item.label}</span>
                {badgeCount > 0 && (
                  <span className="bg-danger text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1">
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="px-3 py-4 border-t border-border space-y-3">
          <div className="flex items-center gap-3 px-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent/40 to-accent-hover/40 flex items-center justify-center text-accent-light font-bold text-xs uppercase">
              {(admin?.username || "?")[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-200 truncate">
                {admin?.username || "-"}
              </div>
              <div
                className={`text-[10px] font-semibold uppercase tracking-wider ${roleColor}`}
              >
                <IconDot size={6} className="inline mr-1" />
                {roleLabel}
              </div>
            </div>
          </div>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all border border-transparent hover:border-red-500/20"
            onClick={onLogout}
          >
            <IconLogout size={16} />
            <span>Log out</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-xl border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5"
                onClick={() => setSidebarOpen(true)}
              >
                <IconMenu size={20} />
              </button>
              <div>
                <h1 className="text-lg font-bold text-slate-100">{title}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="relative p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5 transition">
                <IconBell size={18} />
                {(pendingCounts.pendingDeposits > 0 ||
                  pendingCounts.pendingWithdraws > 0) && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-danger rounded-full animate-pulse-slow" />
                )}
              </button>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="p-6 animate-fade-in">{children}</div>
      </main>
    </div>
  );
}
