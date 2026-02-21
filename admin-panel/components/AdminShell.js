import Link from 'next/link';
import { useRouter } from 'next/router';

const NAV = [
    { href: '/app', label: 'Dashboard' },
    { href: '/players', label: 'Players', perm: 'players.read' },
    { href: '/deposit', label: 'Deposit Requests', perm: 'deposit.read' },
    { href: '/withdraw', label: 'Withdraw Requests', perm: 'withdraw.read' },
    { href: '/admins', label: 'Admins', role: 'super_admin' },
    { href: '/settings', label: 'Settings', perm: 'settings.read' },
    { href: '/commands', label: 'Commands' },
];

function canShow(item, admin) {
    if (!item.role) return true;
    if (item.role === 'super_admin') return admin?.role === 'super_admin';
    return true;
}

function hasPerm(admin, perm) {
    if (!perm) return true;
    if (admin?.role === 'super_admin') return true;
    const perms = Array.isArray(admin?.permissions) ? admin.permissions : [];
    return perms.includes(perm);
}

export default function AdminShell({ admin, onLogout, children, title }) {
    const router = useRouter();

    return (
        <div className="min-h-screen bg-bg text-slate-100 flex">
            <aside className="w-64 bg-panel border-r border-border p-4">
                <div className="text-lg font-extrabold tracking-wide">Admin Panel</div>
                <div className="text-xs text-slate-400 mt-1 break-all">{admin?.username || '-'}</div>
                <div className="text-xs text-slate-400">Role: {admin?.role || '-'}</div>

                <nav className="mt-6 flex flex-col gap-1">
                    {NAV.filter((i) => canShow(i, admin) && hasPerm(admin, i.perm)).map((item) => {
                        const active = router.pathname === item.href;
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={
                                    'px-3 py-2 rounded-lg text-sm transition ' +
                                    (active ? 'bg-accent text-white' : 'hover:bg-white/10 text-slate-200')
                                }
                            >
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>

                <button
                    className="mt-6 w-full text-sm px-3 py-2 rounded-lg border border-border hover:bg-white/10"
                    onClick={onLogout}
                >
                    Logout
                </button>

                <div className="mt-6 text-xs text-slate-500">
                    Runs on port 3001
                </div>
            </aside>

            <main className="flex-1 p-6">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-xl font-bold">{title}</h1>
                </div>
                {children}
            </main>
        </div>
    );
}
