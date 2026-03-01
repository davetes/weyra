import { useEffect, useMemo, useState } from "react";
import RequireAuth from "../components/RequireAuth";
import AdminShell from "../components/AdminShell";
import Card from "../components/Card";
import Badge from "../components/Badge";
import Button from "../components/Button";
import { Input, Select } from "../components/FormElements";
import { apiFetch } from "../lib/api";
import { saveToken } from "../lib/auth";
import { IconClock, IconRefresh } from "../components/Icons";

function hasPerm(admin, perm) {
  if (admin?.role === "super_admin") return true;
  const perms = Array.isArray(admin?.permissions) ? admin.permissions : [];
  return perms.includes(perm);
}

function formatDateTime(v) {
  if (!v) return "-";
  try {
    const d = new Date(v);
    const date = d.toLocaleDateString("en-GB");
    const time = d.toLocaleTimeString("en-GB", { hour12: false });
    return `${date}, ${time}`;
  } catch (_) {
    return "-";
  }
}

function parseJsonOrText(v) {
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch (_) {
    return v;
  }
}

export default function AuditLogsPage() {
  return (
    <RequireAuth>
      {({ token, admin }) => <AuditInner token={token} admin={admin} />}
    </RequireAuth>
  );
}

function AuditInner({ token, admin }) {
  const canRead = useMemo(() => hasPerm(admin, "audit.read"), [admin]);
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [limit, setLimit] = useState(200);

  const [page, setPage] = useState(1);
  const pageSize = 3;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    if (!canRead) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (entityType) params.set("entityType", entityType);
      if (entityId) params.set("entityId", entityId);
      if (limit) params.set("limit", String(limit));
      const res = await apiFetch(`/api/admin/audit_logs?${params.toString()}`, {
        token,
      });
      setRows(Array.isArray(res.logs) ? res.logs : []);
      setPage(1);
    } catch (err) {
      if (err?.status === 401) {
        saveToken(null);
        window.location.href = "/login";
        return;
      }
      setError(err?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [canRead]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(rows.length / pageSize));
  }, [rows.length]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page]);

  useEffect(() => {
    setPage(1);
  }, [entityType, entityId, limit]);

  const pendingCounts = { pendingDeposits: 0, pendingWithdraws: 0 };

  return (
    <AdminShell
      admin={admin}
      title="Audit Logs"
      pendingCounts={pendingCounts}
      onLogout={() => {
        saveToken(null);
        window.location.href = "/login";
      }}
    >
      {!canRead ? (
        <Card title="No access">
          <div className="text-sm text-muted">
            You do not have permission to view audit logs.
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card title="Filters" icon={IconClock}>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Select
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
              >
                <option value="">All entity types</option>
                <option value="game">game</option>
                <option value="stake_room">stake_room</option>
                <option value="announcement">announcement</option>
                <option value="player">player</option>
                <option value="deposit_request">deposit_request</option>
                <option value="withdraw_request">withdraw_request</option>
              </Select>
              <Input
                placeholder="Entity ID (optional)"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
              />
              <Select
                value={String(limit)}
                onChange={(e) => setLimit(parseInt(e.target.value, 10) || 200)}
              >
                <option value="200">Limit 200</option>
                <option value="500">Limit 500</option>
                <option value="1000">Limit 1000</option>
              </Select>
              <Button variant="secondary" onClick={load} loading={loading}>
                <span className="inline-flex items-center gap-2">
                  <IconRefresh size={16} /> Apply
                </span>
              </Button>
            </div>
          </Card>

          {error && (
            <div className="bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger animate-fade-in">
              {error}
            </div>
          )}

          <Card title="Logs">
            {loading ? (
              <div className="text-sm text-muted">Loading...</div>
            ) : !rows.length ? (
              <div className="text-sm text-muted">No logs found.</div>
            ) : (
              <div className="space-y-3">
                {pageRows.map((l) => {
                  const before = parseJsonOrText(l.before);
                  const after = parseJsonOrText(l.after);
                  return (
                    <div
                      key={l.id}
                      className="border border-border rounded-xl p-4 bg-bg-secondary/20"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm font-semibold">
                          {l.action || "-"}
                        </div>
                        <div className="text-xs text-muted">
                          {formatDateTime(l.createdAt)}
                        </div>
                      </div>

                      <div className="pt-2 text-xs text-muted">
                        <Badge variant="accent">{l.entityType}</Badge>{" "}
                        <span className="text-slate-200">{l.entityId}</span>
                        {l.admin?.username && (
                          <span className="ml-2">by {l.admin.username}</span>
                        )}
                      </div>

                      <div className="pt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <div className="text-[11px] text-muted uppercase tracking-wider mb-1">
                            Before
                          </div>
                          <pre className="text-xs bg-bg border border-border rounded-xl p-3 overflow-auto max-h-48">
                            {before == null
                              ? "-"
                              : typeof before === "string"
                                ? before
                                : JSON.stringify(before, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <div className="text-[11px] text-muted uppercase tracking-wider mb-1">
                            After
                          </div>
                          <pre className="text-xs bg-bg border border-border rounded-xl p-3 overflow-auto max-h-48">
                            {after == null
                              ? "-"
                              : typeof after === "string"
                                ? after
                                : JSON.stringify(after, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <div className="text-xs text-muted mr-2">
                    Page {page} of {totalPages}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </AdminShell>
  );
}
