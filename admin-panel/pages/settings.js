import { useEffect, useMemo, useState } from "react";
import RequireAuth from "../components/RequireAuth";
import AdminShell from "../components/AdminShell";
import Card from "../components/Card";
import Button from "../components/Button";
import { Input } from "../components/FormElements";
import { apiFetch } from "../lib/api";
import { saveToken } from "../lib/auth";
import {
  IconSettings,
  IconPlus,
  IconCheck,
  IconTrash,
} from "../components/Icons";

function hasPerm(admin, perm) {
  if (admin?.role === "super_admin") return true;
  const perms = Array.isArray(admin?.permissions) ? admin.permissions : [];
  return perms.includes(perm);
}

export default function SettingsPage() {
  return (
    <RequireAuth>
      {({ token, admin }) => <SettingsInner token={token} admin={admin} />}
    </RequireAuth>
  );
}

function SettingsInner({ token, admin }) {
  const canRead = useMemo(() => hasPerm(admin, "settings.read"), [admin]);
  const canEdit = useMemo(() => hasPerm(admin, "settings.write"), [admin]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState([]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/admin/settings", { token });
      setSettings(res.settings || []);
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
    if (canRead) load();
  }, []);

  async function save() {
    setLoading(true);
    setError("");
    try {
      const payload = settings.map((s) => ({ key: s.key, value: s.value }));
      const res = await apiFetch("/api/admin/settings", {
        token,
        method: "PUT",
        body: { settings: payload },
      });
      setSettings(res.settings || []);
    } catch (err) {
      setError(err?.message || "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  function addSetting() {
    setSettings((prev) => [...prev, { key: "", value: "" }]);
  }

  function removeSetting(index) {
    setSettings((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <AdminShell
      admin={admin}
      title="Settings"
      onLogout={() => {
        saveToken(null);
        window.location.href = "/login";
      }}
    >
      <div className="space-y-5">
        {!canRead ? (
          <Card title="No access">
            <div className="text-sm text-muted">
              You do not have permission to view settings.
            </div>
          </Card>
        ) : (
          <Card title="App Settings" icon={IconSettings} noPadding>
            <div className="p-5 border-b border-border flex items-center justify-between">
              <p className="text-sm text-muted">
                Key / value configuration pairs for the application
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  icon={IconPlus}
                  disabled={!canEdit || loading}
                  onClick={addSetting}
                >
                  Add
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={IconCheck}
                  disabled={!canEdit || loading}
                  loading={loading}
                  onClick={save}
                >
                  Save All
                </Button>
              </div>
            </div>

            {error && (
              <div className="bg-danger-muted border-b border-danger/20 px-5 py-3 text-sm text-danger">
                {error}
              </div>
            )}

            <div className="p-5 space-y-3 max-h-[600px] overflow-y-auto">
              {settings.length === 0 ? (
                <div className="text-center py-8 text-muted text-sm">
                  No settings configured
                </div>
              ) : (
                settings.map((s, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-3 items-end"
                  >
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1.5 uppercase tracking-wider">
                        Key
                      </label>
                      <Input
                        value={s.key}
                        disabled={!canEdit}
                        onChange={(e) => {
                          const next = [...settings];
                          next[i] = { ...next[i], key: e.target.value };
                          setSettings(next);
                        }}
                        placeholder="e.g., max_players"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1.5 uppercase tracking-wider">
                        Value
                      </label>
                      <Input
                        value={s.value}
                        disabled={!canEdit}
                        onChange={(e) => {
                          const next = [...settings];
                          next[i] = { ...next[i], value: e.target.value };
                          setSettings(next);
                        }}
                        placeholder="e.g., 1000"
                      />
                    </div>
                    {canEdit && (
                      <Button
                        variant="danger"
                        size="sm"
                        icon={IconTrash}
                        onClick={() => removeSetting(i)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
