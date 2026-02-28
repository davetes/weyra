import { useEffect, useMemo, useState } from "react";
import RequireAuth from "../components/RequireAuth";
import AdminShell from "../components/AdminShell";
import Card from "../components/Card";
import Badge from "../components/Badge";
import Button from "../components/Button";
import { apiFetch } from "../lib/api";
import { saveToken } from "../lib/auth";
import { IconRefresh } from "../components/Icons";

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

function formatMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "0s";
  return `${Math.round(n / 100) / 10}s`;
}

function RoomRow({ room, onPause, onResume, onRestart, busy }) {
  const stake = room.stake;
  const game = room.game;

  const started = !!game?.startedAt;
  const paused = !!room.pause?.paused;

  return (
    <Card title={`${stake} ETB Room`}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="text-sm">
            <span className="text-muted">Game ID:</span>{" "}
            <span className="font-semibold">{game?.id ?? "-"}</span>
          </div>
          <div className="text-sm">
            <span className="text-muted">Status:</span>{" "}
            {started ? (
              <Badge variant="success">Started</Badge>
            ) : (
              <Badge variant="warning">Waiting</Badge>
            )}{" "}
            {paused && started && <Badge variant="danger">Paused</Badge>}
          </div>
          <div className="text-sm">
            <span className="text-muted">Players / Cards:</span>{" "}
            <span className="font-semibold">
              {room.selections?.players ?? 0} / {room.selections?.cards ?? 0}
            </span>
          </div>
          <div className="text-sm">
            <span className="text-muted">Last Call:</span>{" "}
            <span className="font-semibold">{room.lastCall ?? "-"}</span>
          </div>
          <div className="text-sm">
            <span className="text-muted">Winner:</span>{" "}
            <span className="font-semibold">
              {room.winner?.winner ? String(room.winner.winner) : "-"}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm">
            <span className="text-muted">Countdown:</span>{" "}
            <span className="font-semibold">{formatDateTime(game?.countdownStartedAt)}</span>
          </div>
          <div className="text-sm">
            <span className="text-muted">Started At:</span>{" "}
            <span className="font-semibold">{formatDateTime(game?.startedAt)}</span>
          </div>
          <div className="text-sm">
            <span className="text-muted">Paused Time:</span>{" "}
            <span className="font-semibold">{formatMs(room.pause?.pauseMs || 0)}</span>
          </div>

          <div className="pt-2 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!started || paused || busy}
              onClick={() => onPause(stake)}
            >
              Pause
            </Button>
            <Button
              variant="secondary"
              disabled={!started || !paused || busy}
              onClick={() => onResume(stake)}
            >
              Resume
            </Button>
            <Button
              variant="danger"
              disabled={!game?.id || busy}
              onClick={() => onRestart(stake)}
            >
              Restart
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function RoomsPage() {
  return (
    <RequireAuth>
      {({ token, admin }) => <RoomsInner token={token} admin={admin} />}
    </RequireAuth>
  );
}

function RoomsInner({ token, admin }) {
  const canRead = useMemo(() => hasPerm(admin, "settings.read"), [admin]);
  const canWrite = useMemo(() => hasPerm(admin, "settings.write"), [admin]);

  const [rooms, setRooms] = useState([]);
  const [serverTime, setServerTime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyStake, setBusyStake] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    if (!canRead) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/admin/rooms", { token });
      setRooms(Array.isArray(res.rooms) ? res.rooms : []);
      setServerTime(res.serverTime || null);
    } catch (err) {
      if (err?.status === 401) {
        saveToken(null);
        window.location.href = "/login";
        return;
      }
      setError(err?.message || "Failed to load rooms");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [canRead]);

  const pendingCounts = {
    pendingDeposits: 0,
    pendingWithdraws: 0,
  };

  async function act(stake, action) {
    if (!canWrite) {
      setError("You do not have permission to control rooms.");
      return;
    }
    setBusyStake(stake);
    setError("");
    try {
      if (action === "pause") {
        await apiFetch(`/api/admin/rooms/${stake}/pause`, { token, method: "POST" });
      } else if (action === "resume") {
        await apiFetch(`/api/admin/rooms/${stake}/resume`, { token, method: "POST" });
      } else if (action === "restart") {
        const ok = window.confirm(
          `Restart stake room ${stake}? This will end the current game and create a new game.`,
        );
        if (!ok) return;
        await apiFetch(`/api/admin/rooms/${stake}/restart`, { token, method: "POST" });
      }
      await load();
    } catch (err) {
      setError(err?.message || "Action failed");
    } finally {
      setBusyStake(null);
    }
  }

  const driftMs = serverTime != null ? Date.now() - Number(serverTime) : null;

  return (
    <AdminShell
      admin={admin}
      title="Rooms"
      pendingCounts={pendingCounts}
      onLogout={() => {
        saveToken(null);
        window.location.href = "/login";
      }}
    >
      {!canRead ? (
        <Card title="No access">
          <div className="text-sm text-muted">
            You do not have permission to view rooms.
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-muted">
              Server time drift: {driftMs == null ? "-" : `${Math.round(driftMs)} ms`}
            </div>
            <Button variant="secondary" onClick={load} loading={loading}>
              <span className="inline-flex items-center gap-2">
                <IconRefresh size={16} /> Refresh
              </span>
            </Button>
          </div>

          {error && (
            <div className="bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger animate-fade-in">
              {error}
            </div>
          )}

          {rooms.map((room) => (
            <RoomRow
              key={room.stake}
              room={room}
              busy={busyStake === room.stake}
              onPause={(s) => act(s, "pause")}
              onResume={(s) => act(s, "resume")}
              onRestart={(s) => act(s, "restart")}
            />
          ))}
        </div>
      )}
    </AdminShell>
  );
}
