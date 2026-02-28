import { useEffect, useMemo, useState } from "react";
import RequireAuth from "../components/RequireAuth";
import AdminShell from "../components/AdminShell";
import Card from "../components/Card";
import Badge from "../components/Badge";
import Button from "../components/Button";
import { apiFetch } from "../lib/api";
import { saveToken } from "../lib/auth";
import { IconTerminal, IconRefresh } from "../components/Icons";

function hasPerm(admin, perm) {
  if (admin?.role === "super_admin") return true;
  const perms = Array.isArray(admin?.permissions) ? admin.permissions : [];
  return perms.includes(perm);
}

export default function HealthPage() {
  return (
    <RequireAuth>
      {({ token, admin }) => <HealthInner token={token} admin={admin} />}
    </RequireAuth>
  );
}

function HealthInner({ token, admin }) {
  const canRead = useMemo(() => hasPerm(admin, "settings.read"), [admin]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    if (!canRead) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/admin/health", { token });
      setData(res);
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
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [canRead]);

  const driftMs = data?.serverTime != null ? Date.now() - Number(data.serverTime) : null;
  const pendingCounts = { pendingDeposits: 0, pendingWithdraws: 0 };

  return (
    <AdminShell
      admin={admin}
      title="Health"
      pendingCounts={pendingCounts}
      onLogout={() => {
        saveToken(null);
        window.location.href = "/login";
      }}
    >
      {!canRead ? (
        <Card title="No access">
          <div className="text-sm text-muted">
            You do not have permission to view health.
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card title="Status" icon={IconTerminal}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="text-xs text-muted">
                Server time drift: {driftMs == null ? "-" : `${Math.round(driftMs)} ms`}
              </div>
              <Button variant="secondary" onClick={load} loading={loading}>
                <span className="inline-flex items-center gap-2">
                  <IconRefresh size={16} /> Refresh
                </span>
              </Button>
            </div>

            <div className="pt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="border border-border rounded-xl p-4 bg-bg-secondary/20">
                <div className="text-xs text-muted">Database</div>
                <div className="pt-1">
                  {data?.dbOk ? (
                    <Badge variant="success">OK</Badge>
                  ) : (
                    <Badge variant="danger">Down</Badge>
                  )}
                </div>
              </div>
              <div className="border border-border rounded-xl p-4 bg-bg-secondary/20">
                <div className="text-xs text-muted">Redis</div>
                <div className="pt-1">
                  {data?.redisOk ? (
                    <Badge variant="success">OK</Badge>
                  ) : (
                    <Badge variant="danger">Down</Badge>
                  )}
                </div>
              </div>
              <div className="border border-border rounded-xl p-4 bg-bg-secondary/20">
                <div className="text-xs text-muted">Server Time</div>
                <div className="pt-1 text-sm text-slate-200">
                  {data?.serverTime ? new Date(data.serverTime).toLocaleString() : "-"}
                </div>
              </div>
            </div>
          </Card>

          {error && (
            <div className="bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger animate-fade-in">
              {error}
            </div>
          )}
        </div>
      )}
    </AdminShell>
  );
}
