import { useEffect, useMemo, useState } from "react";
import RequireAuth from "../components/RequireAuth";
import AdminShell from "../components/AdminShell";
import Card from "../components/Card";
import Button from "../components/Button";
import { Input } from "../components/FormElements";
import { apiFetch } from "../lib/api";
import { saveToken } from "../lib/auth";
import { IconBell } from "../components/Icons";

function hasPerm(admin, perm) {
  if (admin?.role === "super_admin") return true;
  const perms = Array.isArray(admin?.permissions) ? admin.permissions : [];
  return perms.includes(perm);
}

export default function AnnouncePage() {
  return (
    <RequireAuth>
      {({ token, admin }) => <AnnounceInner token={token} admin={admin} />}
    </RequireAuth>
  );
}

function AnnounceInner({ token, admin }) {
  const canSend = useMemo(() => hasPerm(admin, "announce.send"), [admin]);
  const [message, setMessage] = useState("");
  const [caption, setCaption] = useState("");
  const [photo, setPhoto] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [playNow, setPlayNow] = useState(true);
  const [max, setMax] = useState("500");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [imageFile]);

  const pendingCounts = { pendingDeposits: 0, pendingWithdraws: 0 };

  async function send() {
    if (!canSend) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const nMax = parseInt(max, 10) || 500;

      let res = null;
      if (imageFile) {
        const fd = new FormData();
        fd.set("message", message);
        fd.set("caption", caption);
        fd.set("photo", photo);
        fd.set("max", String(nMax));
        fd.set("play_now", playNow ? "1" : "0");
        fd.set("image", imageFile);

        const r = await fetch("/api/admin/announce", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: fd,
        });
        const data = await r.json().catch(() => null);
        if (!r.ok) {
          const msg = data?.error || `Request failed (${r.status})`;
          const e = new Error(msg);
          e.status = r.status;
          throw e;
        }
        res = data;
      } else {
        res = await apiFetch("/api/admin/announce", {
          token,
          method: "POST",
          body: {
            message,
            caption,
            photo,
            max: nMax,
            play_now: playNow,
          },
        });
      }
      setResult(res);
      setMessage("");
      setCaption("");
      setPhoto("");
      setImageFile(null);
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

  return (
    <AdminShell
      admin={admin}
      title="Announcements"
      pendingCounts={pendingCounts}
      onLogout={() => {
        saveToken(null);
        window.location.href = "/login";
      }}
    >
      {!canSend ? (
        <Card title="No access">
          <div className="text-sm text-muted">
            You do not have permission to send announcements.
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card title="Broadcast" icon={IconBell}>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted mb-2">
                  Message (Markdown supported)
                </div>
                <textarea
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Write message to send..."
                  className="w-full bg-bg-secondary border border-border rounded-xl text-sm text-slate-200 placeholder:text-muted transition-colors focus:border-accent/50 px-3 py-2.5"
                />
              </div>
              <Input
                placeholder="Photo URL or Telegram file_id (optional)"
                value={photo}
                onChange={(e) => setPhoto(e.target.value)}
              />
              <div>
                <div className="text-xs text-muted mb-2">
                  Caption for image (optional, multiline)
                </div>
                <textarea
                  rows={3}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Caption for image (optional)"
                  className="w-full bg-bg-secondary border border-border rounded-xl text-sm text-slate-200 placeholder:text-muted transition-colors focus:border-accent/50 px-3 py-2.5"
                />
              </div>
              <div className="text-sm">
                <div className="text-xs text-muted mb-2">
                  Upload image (optional)
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="w-full bg-bg-secondary border border-border rounded-xl text-sm text-slate-200 px-3 py-2.5"
                  onChange={(e) => {
                    const f =
                      e.target.files && e.target.files[0]
                        ? e.target.files[0]
                        : null;
                    setImageFile(f);
                  }}
                />
                {imageFile && (
                  <div className="text-xs text-muted mt-2">
                    Selected: {imageFile.name}
                  </div>
                )}
                {imagePreviewUrl && (
                  <div className="mt-3">
                    <img
                      src={imagePreviewUrl}
                      alt="Preview"
                      className="max-h-56 w-auto rounded-xl border border-border"
                    />
                  </div>
                )}
              </div>
              <Input
                placeholder="Max users (default 500)"
                value={max}
                onChange={(e) => setMax(e.target.value)}
              />

              <div
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors ${
                  playNow
                    ? "bg-accent/10 border-accent/40"
                    : "bg-bg-secondary border-border"
                }`}
                onClick={() => setPlayNow((p) => !p)}
              >
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-blue-500 cursor-pointer"
                  checked={playNow}
                  onChange={(e) => setPlayNow(e.target.checked)}
                />
                <div>
                  <div className="text-sm font-medium text-slate-200">
                    🎮 Add &quot;Play Now&quot; button
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    Attaches an inline button that opens the MiniApp
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <Button variant="primary" onClick={send} loading={loading}>
                  Send
                </Button>
              </div>
            </div>
          </Card>

          {error && (
            <div className="bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger animate-fade-in">
              {error}
            </div>
          )}

          {result && (
            <Card title="Broadcast Result">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="bg-bg-secondary rounded-xl px-4 py-3">
                  <div className="text-2xl font-bold text-blue-400">{(result.sent || 0) + (result.failed || 0)}</div>
                  <div className="text-xs text-muted mt-1">Total Players</div>
                </div>
                <div className="bg-bg-secondary rounded-xl px-4 py-3">
                  <div className="text-2xl font-bold text-green-400">{result.sent || 0}</div>
                  <div className="text-xs text-muted mt-1">Sent ✅</div>
                </div>
                <div className="bg-bg-secondary rounded-xl px-4 py-3">
                  <div className="text-2xl font-bold text-red-400">{result.failed || 0}</div>
                  <div className="text-xs text-muted mt-1">Failed ❌</div>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </AdminShell>
  );
}
