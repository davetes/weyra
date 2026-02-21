import { useEffect, useState } from 'react';
import RequireAuth from '../components/RequireAuth';
import AdminShell from '../components/AdminShell';
import Card from '../components/Card';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';
import { saveToken } from '../lib/auth';
import { apiFetch } from '../lib/api';
import {
    IconUsers,
    IconGamepad,
    IconDeposit,
    IconWithdraw,
    IconWallet,
    IconTrendingUp,
    IconClock,
    IconBan,
    IconRefresh,
} from '../components/Icons';
import Button from '../components/Button';

function formatMoney(v) {
    if (v == null) return '0.00';
    const n = Number(v);
    if (Number.isNaN(n)) return String(v);
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(v) {
    if (!v) return '-';
    try {
        const d = new Date(v);
        const now = new Date();
        const diff = now - d;
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_) {
        return '-';
    }
}

function getTransactionBadge(kind) {
    switch (kind) {
        case 'deposit':
            return { variant: 'success', label: 'Deposit' };
        case 'withdraw':
            return { variant: 'danger', label: 'Withdraw' };
        case 'stake':
            return { variant: 'warning', label: 'Stake' };
        case 'win':
            return { variant: 'info', label: 'Win' };
        case 'gift':
            return { variant: 'accent', label: 'Gift' };
        default:
            return { variant: 'default', label: kind || 'Unknown' };
    }
}

export default function DashboardPage() {
    return (
        <RequireAuth>
            {({ token, admin }) => <DashboardInner token={token} admin={admin} />}
        </RequireAuth>
    );
}

function DashboardInner({ token, admin }) {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    async function loadStats() {
        setLoading(true);
        setError('');
        try {
            const res = await apiFetch('/api/admin/stats', { token });
            setStats(res.stats);
        } catch (err) {
            if (err?.status === 401) {
                saveToken(null);
                window.location.href = '/login';
                return;
            }
            setError(err?.message || 'Failed to load stats');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadStats();
        const interval = setInterval(loadStats, 30000);
        return () => clearInterval(interval);
    }, []);

    const pendingCounts = {
        pendingDeposits: stats?.pendingDeposits || 0,
        pendingWithdraws: stats?.pendingWithdraws || 0,
    };

    return (
        <AdminShell
            admin={admin}
            title="Dashboard"
            pendingCounts={pendingCounts}
            onLogout={() => {
                saveToken(null);
                window.location.href = '/login';
            }}
        >
            <div className="space-y-6">
                {error && (
                    <div className="bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger">
                        {error}
                    </div>
                )}

                {/* Welcome header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-100">
                            Welcome back, <span className="text-accent-light">{admin?.username}</span>
                        </h2>
                        <p className="text-sm text-muted mt-0.5">Here&apos;s what&apos;s happening with your platform today.</p>
                    </div>
                    <Button icon={IconRefresh} loading={loading} onClick={loadStats} variant="outline" size="sm">
                        Refresh
                    </Button>
                </div>

                {/* Primary Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard
                        label="Total Players"
                        value={stats?.totalPlayers ?? '-'}
                        sub={`${stats?.todayPlayers ?? 0} joined today`}
                        icon={IconUsers}
                        color="accent"
                    />
                    <StatCard
                        label="Active Games"
                        value={stats?.activeGames ?? '-'}
                        sub={`${stats?.totalGames ?? 0} total games`}
                        icon={IconGamepad}
                        color="success"
                    />
                    <StatCard
                        label="Pending Deposits"
                        value={stats?.pendingDeposits ?? '-'}
                        sub="Awaiting review"
                        icon={IconDeposit}
                        color={stats?.pendingDeposits > 0 ? 'warning' : 'info'}
                    />
                    <StatCard
                        label="Pending Withdrawals"
                        value={stats?.pendingWithdraws ?? '-'}
                        sub="Awaiting approval"
                        icon={IconWithdraw}
                        color={stats?.pendingWithdraws > 0 ? 'warning' : 'info'}
                    />
                </div>

                {/* Financial Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <StatCard
                        label="Total Deposited"
                        value={`${formatMoney(stats?.totalDeposited)} ETB`}
                        sub={`${stats?.depositCount ?? 0} approved deposits`}
                        icon={IconWallet}
                        color="success"
                    />
                    <StatCard
                        label="Total Withdrawn"
                        value={`${formatMoney(stats?.totalWithdrawn)} ETB`}
                        sub={`${stats?.withdrawCount ?? 0} approved withdrawals`}
                        icon={IconTrendingUp}
                        color="danger"
                    />
                    <StatCard
                        label="Banned Players"
                        value={stats?.bannedPlayers ?? '-'}
                        sub={`Out of ${stats?.totalPlayers ?? 0} total`}
                        icon={IconBan}
                        color="danger"
                    />
                </div>

                {/* Recent Transactions */}
                <Card title="Recent Transactions" icon={IconClock}>
                    {!stats?.recentTransactions?.length ? (
                        <div className="text-center py-8 text-muted text-sm">No recent transactions</div>
                    ) : (
                        <div className="overflow-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-xs font-medium text-muted uppercase tracking-wider border-b border-border">
                                        <th className="py-3 pr-3">Type</th>
                                        <th className="pr-3">Player</th>
                                        <th className="pr-3">Amount</th>
                                        <th className="pr-3">Note</th>
                                        <th className="text-right">Time</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stats.recentTransactions.map((t) => {
                                        const badge = getTransactionBadge(t.kind);
                                        const amt = Number(t.amount);
                                        return (
                                            <tr key={t.id} className="border-b border-border/50 transition-colors">
                                                <td className="py-3 pr-3">
                                                    <Badge variant={badge.variant} dot>{badge.label}</Badge>
                                                </td>
                                                <td className="pr-3 text-slate-300">{t.player?.username || `#${t.playerId}`}</td>
                                                <td className={`pr-3 font-medium ${amt >= 0 ? 'text-success' : 'text-danger'}`}>
                                                    {amt >= 0 ? '+' : ''}{formatMoney(t.amount)} ETB
                                                </td>
                                                <td className="pr-3 text-muted max-w-[200px] truncate">{t.note || '-'}</td>
                                                <td className="text-right text-muted whitespace-nowrap">{formatDate(t.createdAt)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>

                {/* Quick Actions */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card title="Players">
                        <p className="text-sm text-muted mb-3">Search, view details, and manage player accounts.</p>
                        <a href="/players" className="text-sm text-accent-light hover:text-accent font-medium transition-colors">
                            Manage Players →
                        </a>
                    </Card>
                    <Card title="Admin Users">
                        <p className="text-sm text-muted mb-3">Create admin accounts and manage permissions.</p>
                        <a href="/admins" className="text-sm text-accent-light hover:text-accent font-medium transition-colors">
                            Manage Admins →
                        </a>
                    </Card>
                    <Card title="App Settings">
                        <p className="text-sm text-muted mb-3">Configure application parameters and values.</p>
                        <a href="/settings" className="text-sm text-accent-light hover:text-accent font-medium transition-colors">
                            View Settings →
                        </a>
                    </Card>
                </div>
            </div>
        </AdminShell>
    );
}
