import RequireAuth from '../components/RequireAuth';
import AdminShell from '../components/AdminShell';
import Card from '../components/Card';
import Badge from '../components/Badge';
import Button from '../components/Button';
import { Select } from '../components/FormElements';
import { saveToken } from '../lib/auth';
import { decideDepositRequest, listDepositRequests } from '../lib/requests';
import { useEffect, useMemo, useState } from 'react';
import { IconDeposit, IconRefresh, IconCheck, IconX } from '../components/Icons';

function hasPerm(admin, perm) {
    if (admin?.role === 'super_admin') return true;
    const perms = Array.isArray(admin?.permissions) ? admin.permissions : [];
    return perms.includes(perm);
}

function formatDate(v) {
    if (!v) return '-';
    try {
        return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_) {
        return '-';
    }
}

function promptAmount() {
    const raw = window.prompt('Deposit amount (ETB):', '');
    if (raw == null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

function statusBadge(status) {
    switch (status) {
        case 'pending':
            return { variant: 'warning', label: 'Pending' };
        case 'approved':
            return { variant: 'success', label: 'Approved' };
        case 'rejected':
            return { variant: 'danger', label: 'Rejected' };
        default:
            return { variant: 'default', label: status };
    }
}

export default function DepositRequestsPage() {
    return (
        <RequireAuth>
            {({ token, admin }) => (
                <AdminShell
                    admin={admin}
                    title="Deposit Requests"
                    onLogout={() => {
                        saveToken(null);
                        window.location.href = '/login';
                    }}
                >
                    <DepositInner token={token} admin={admin} />
                </AdminShell>
            )}
        </RequireAuth>
    );
}

function DepositInner({ token, admin }) {
    const canRead = useMemo(() => hasPerm(admin, 'deposit.read'), [admin]);
    const canDecide = useMemo(() => hasPerm(admin, 'deposit.decide'), [admin]);
    const [status, setStatus] = useState('pending');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [rows, setRows] = useState([]);

    async function load() {
        if (!canRead) return;
        setLoading(true);
        setError('');
        try {
            const res = await listDepositRequests(token, { status });
            setRows(res.requests || []);
        } catch (err) {
            if (err?.status === 401) {
                saveToken(null);
                window.location.href = '/login';
                return;
            }
            setError(err?.message || 'Failed');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, [status]);

    async function decide(id, decision) {
        let amount = undefined;
        if (decision === 'approved') {
            amount = promptAmount();
            if (amount == null) {
                setError('Approval requires a valid deposit amount.');
                return;
            }
        }
        const note = window.prompt('Note (optional):', '') || '';
        setLoading(true);
        setError('');
        try {
            await decideDepositRequest(token, id, { decision, note, amount });
            await load();
        } catch (err) {
            setError(err?.message || 'Failed');
        } finally {
            setLoading(false);
        }
    }

    if (!canRead) {
        return (
            <Card title="No access">
                <div className="text-sm text-muted">You do not have permission to view deposit requests.</div>
            </Card>
        );
    }

    return (
        <div className="space-y-5">
            {/* Filters */}
            <Card title="Filters" icon={IconDeposit}>
                <div className="flex items-center gap-3">
                    <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                        <option value="pending">Pending</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                    </Select>
                    <Button variant="outline" size="sm" icon={IconRefresh} loading={loading} onClick={load}>
                        Refresh
                    </Button>
                    <span className="text-xs text-muted ml-auto">Showing latest 500</span>
                </div>
                {error && (
                    <div className="bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger mt-3">
                        {error}
                    </div>
                )}
            </Card>

            {/* Requests Table */}
            <Card title={`Deposit Requests (${rows.length})`} noPadding>
                <div className="overflow-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs font-medium text-muted uppercase tracking-wider border-b border-border">
                                <th className="px-5 py-3">ID</th>
                                <th className="pr-3 py-3">Player</th>
                                <th className="pr-3 py-3">Amount</th>
                                <th className="pr-3 py-3">Telegram ID</th>
                                <th className="pr-3 py-3">Method</th>
                                <th className="pr-3 py-3">Caption</th>
                                <th className="pr-3 py-3">Note</th>
                                <th className="pr-3 py-3">Status</th>
                                <th className="pr-3 py-3">Created</th>
                                <th className="pr-5 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => {
                                const badge = statusBadge(r.status);
                                return (
                                    <tr key={r.id} className="border-b border-border/40 transition-colors">
                                        <td className="px-5 py-3 text-muted font-mono text-xs">{r.id}</td>
                                        <td className="pr-3 py-3 font-medium text-slate-200">{r.player?.username || r.player?.phone || '-'}</td>
                                        <td className="pr-3 py-3 text-slate-300 font-medium">{r.amount != null ? `${r.amount} ETB` : '-'}</td>
                                        <td className="pr-3 py-3 text-slate-400 font-mono text-xs">{r.telegramId || '-'}</td>
                                        <td className="pr-3 py-3 text-slate-300">{r.method || '-'}</td>
                                        <td className="pr-3 py-3 text-muted max-w-[120px] truncate">{(r.caption || '').slice(0, 80) || '-'}</td>
                                        <td className="pr-3 py-3 text-muted max-w-[120px] truncate">{r.decisionNote ? String(r.decisionNote).slice(0, 60) : '-'}</td>
                                        <td className="pr-3 py-3">
                                            <Badge variant={badge.variant} dot>{badge.label}</Badge>
                                        </td>
                                        <td className="pr-3 py-3 text-muted text-xs whitespace-nowrap">{formatDate(r.createdAt)}</td>
                                        <td className="pr-5 py-3">
                                            <div className="flex justify-end gap-1.5">
                                                {!canDecide || r.status !== 'pending' ? (
                                                    <span className="text-xs text-muted">-</span>
                                                ) : (
                                                    <>
                                                        <Button
                                                            variant="success"
                                                            size="xs"
                                                            icon={IconCheck}
                                                            onClick={() => decide(r.id, 'approved')}
                                                            loading={loading}
                                                        >
                                                            Approve
                                                        </Button>
                                                        <Button
                                                            variant="danger"
                                                            size="xs"
                                                            icon={IconX}
                                                            onClick={() => decide(r.id, 'rejected')}
                                                            loading={loading}
                                                        >
                                                            Reject
                                                        </Button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {rows.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={10} className="text-center py-12 text-muted text-sm">No deposit requests found</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
