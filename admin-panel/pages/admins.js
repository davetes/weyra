import { useEffect, useMemo, useState } from 'react';
import RequireAuth from '../components/RequireAuth';
import AdminShell from '../components/AdminShell';
import Card from '../components/Card';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import Button from '../components/Button';
import { Input, Select } from '../components/FormElements';
import { apiFetch } from '../lib/api';
import { saveToken } from '../lib/auth';
import { IconShield, IconEdit, IconTrash, IconPlus, IconCheck } from '../components/Icons';

const PERMS = [
    { id: 'players.read', label: 'View players' },
    { id: 'players.ban', label: 'Ban / Unban players' },
    { id: 'deposit.read', label: 'View deposit requests' },
    { id: 'deposit.decide', label: 'Approve / Reject deposits' },
    { id: 'withdraw.read', label: 'View withdraw requests' },
    { id: 'withdraw.decide', label: 'Approve / Reject withdrawals' },
    { id: 'settings.read', label: 'View settings' },
    { id: 'settings.write', label: 'Edit settings' },
];

export default function AdminsPage() {
    return (
        <RequireAuth>
            {({ token, admin }) => <AdminsInner token={token} admin={admin} />}
        </RequireAuth>
    );
}

function AdminsInner({ token, admin }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [admins, setAdmins] = useState([]);

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('admin');
    const [permissions, setPermissions] = useState(['players.read']);

    const [editing, setEditing] = useState(null);
    const [editPerms, setEditPerms] = useState([]);

    const canManageAdmins = useMemo(() => admin?.role === 'super_admin', [admin]);

    async function load() {
        setLoading(true);
        setError('');
        try {
            const res = await apiFetch('/api/admin/admins', { token });
            setAdmins(res.admins || []);
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

    async function savePermissions() {
        if (!editing) return;
        setLoading(true);
        setError('');
        try {
            await apiFetch(`/api/admin/admins/${editing.id}`, {
                token,
                method: 'PATCH',
                body: { permissions: editPerms },
            });
            setEditing(null);
            setEditPerms([]);
            await load();
        } catch (err) {
            setError(err?.message || 'Failed to update permissions');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, []);

    async function createAdmin() {
        setLoading(true);
        setError('');
        try {
            await apiFetch('/api/admin/admins', {
                token,
                method: 'POST',
                body: { username, password, role, permissions },
            });
            setUsername('');
            setPassword('');
            setRole('admin');
            setPermissions(['players.read']);
            await load();
        } catch (err) {
            setError(err?.message || 'Failed to create');
        } finally {
            setLoading(false);
        }
    }

    async function removeAdmin(a) {
        if (!window.confirm(`Delete admin '${a.username}'?`)) return;
        setLoading(true);
        setError('');
        try {
            await apiFetch(`/api/admin/admins/${a.id}`, { token, method: 'DELETE' });
            await load();
        } catch (err) {
            setError(err?.message || 'Failed to delete');
        } finally {
            setLoading(false);
        }
    }

    return (
        <AdminShell
            admin={admin}
            title="Admin Users"
            onLogout={() => {
                saveToken(null);
                window.location.href = '/login';
            }}
        >
            <div className="space-y-5">
                {/* Edit Permissions Modal */}
                <Modal
                    open={!!editing}
                    onClose={() => {
                        setEditing(null);
                        setEditPerms([]);
                    }}
                    title={`Edit permissions: ${editing?.username}`}
                >
                    {editing && (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                                {PERMS.map((p) => (
                                    <label
                                        key={p.id}
                                        className="flex items-center gap-2.5 p-3 rounded-lg border border-border hover:bg-white/5 cursor-pointer transition"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={editPerms.includes(p.id)}
                                            onChange={(e) => {
                                                const checked = e.target.checked;
                                                setEditPerms((prev) => {
                                                    if (checked) return [...new Set([...prev, p.id])];
                                                    return prev.filter((x) => x !== p.id);
                                                });
                                            }}
                                            className="cursor-pointer"
                                        />
                                        <span className="text-sm text-slate-200">{p.label}</span>
                                    </label>
                                ))}
                            </div>

                            <div className="flex justify-end gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setEditing(null);
                                        setEditPerms([]);
                                    }}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    variant="primary"
                                    icon={IconCheck}
                                    loading={loading}
                                    onClick={savePermissions}
                                >
                                    Save Permissions
                                </Button>
                            </div>
                        </>
                    )}
                </Modal>

                {error && (
                    <div className="bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger">
                        {error}
                    </div>
                )}

                {canManageAdmins ? (
                    <Card title="Create New Admin" icon={IconPlus}>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                            <Input
                                placeholder="Username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                            />
                            <Input
                                type="password"
                                placeholder="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                            <Select value={role} onChange={(e) => setRole(e.target.value)}>
                                <option value="admin">Admin</option>
                                <option value="entertainer">Entertainer</option>
                            </Select>
                        </div>

                        <div className="mb-4">
                            <label className="block text-xs font-medium text-muted mb-2 uppercase tracking-wider">
                                Permissions
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {PERMS.map((p) => (
                                    <label
                                        key={p.id}
                                        className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={permissions.includes(p.id)}
                                            onChange={(e) => {
                                                const checked = e.target.checked;
                                                setPermissions((prev) => {
                                                    if (checked) return [...new Set([...prev, p.id])];
                                                    return prev.filter((x) => x !== p.id);
                                                });
                                            }}
                                            className="cursor-pointer"
                                        />
                                        {p.label}
                                    </label>
                                ))}
                            </div>
                        </div>

                        <Button variant="primary" icon={IconPlus} loading={loading} onClick={createAdmin}>
                            Create Admin
                        </Button>
                    </Card>
                ) : (
                    <Card title="No access">
                        <div className="text-sm text-muted">Only Super Admin can manage admin accounts.</div>
                    </Card>
                )}

                <Card title={`Admin Users (${admins.length})`} icon={IconShield} noPadding>
                    <div className="overflow-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-xs font-medium text-muted uppercase tracking-wider border-b border-border">
                                    <th className="px-5 py-3">ID</th>
                                    <th className="pr-3 py-3">Username</th>
                                    <th className="pr-3 py-3">Role</th>
                                    <th className="pr-3 py-3">Permissions</th>
                                    <th className="pr-3 py-3">Created</th>
                                    <th className="pr-5 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {admins.map((a) => (
                                    <tr key={a.id} className="border-b border-border/40 transition-colors">
                                        <td className="px-5 py-3 text-muted font-mono text-xs">{a.id}</td>
                                        <td className="pr-3 py-3 font-medium text-slate-200">{a.username}</td>
                                        <td className="pr-3 py-3">
                                            <Badge
                                                variant={
                                                    a.role === 'super_admin'
                                                        ? 'accent'
                                                        : a.role === 'entertainer'
                                                        ? 'warning'
                                                        : 'default'
                                                }
                                                dot
                                            >
                                                {a.role === 'super_admin'
                                                    ? 'Super Admin'
                                                    : a.role === 'entertainer'
                                                    ? 'Entertainer'
                                                    : 'Admin'}
                                            </Badge>
                                        </td>
                                        <td className="pr-3 py-3 text-muted text-xs max-w-[300px]">
                                            {Array.isArray(a.permissions) && a.permissions.length > 0
                                                ? a.permissions
                                                      .map((p) => PERMS.find((x) => x.id === p)?.label)
                                                      .filter(Boolean)
                                                      .join(', ') || '-'
                                                : '-'}
                                        </td>
                                        <td className="pr-3 py-3 text-muted text-xs">
                                            {new Date(a.createdAt).toLocaleDateString()}
                                        </td>
                                        <td className="pr-5 py-3">
                                            <div className="flex justify-end gap-1.5">
                                                {admin?.role === 'super_admin' && a.role !== 'super_admin' ? (
                                                    <>
                                                        <Button
                                                            variant="ghost"
                                                            size="xs"
                                                            icon={IconEdit}
                                                            onClick={() => {
                                                                setEditing(a);
                                                                setEditPerms(
                                                                    Array.isArray(a.permissions)
                                                                        ? a.permissions
                                                                        : []
                                                                );
                                                            }}
                                                        >
                                                            Edit
                                                        </Button>
                                                        <Button
                                                            variant="danger"
                                                            size="xs"
                                                            icon={IconTrash}
                                                            onClick={() => removeAdmin(a)}
                                                            loading={loading}
                                                        >
                                                            Delete
                                                        </Button>
                                                    </>
                                                ) : (
                                                    <span className="text-xs text-muted">-</span>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {admins.length === 0 && !loading && (
                                    <tr>
                                        <td colSpan={6} className="text-center py-12 text-muted text-sm">
                                            No admin users found
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </div>
        </AdminShell>
    );
}
