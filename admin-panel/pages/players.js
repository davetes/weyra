import { useEffect, useMemo, useState } from "react";
import RequireAuth from "../components/RequireAuth";
import AdminShell from "../components/AdminShell";
import Card from "../components/Card";
import Modal from "../components/Modal";
import Badge from "../components/Badge";
import Button from "../components/Button";
import { SearchInput } from "../components/FormElements";
import { apiFetch } from "../lib/api";
import { saveToken } from "../lib/auth";
import {
  IconUsers,
  IconSearch,
  IconRefresh,
  IconBan,
  IconCheck,
  IconEye,
} from "../components/Icons";

function hasPerm(admin, perm) {
  if (admin?.role === "super_admin") return true;
  const perms = Array.isArray(admin?.permissions) ? admin.permissions : [];
  return perms.includes(perm);
}

function formatDate(v) {
  if (!v) return "-";
  try {
    return new Date(v).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch (_) {
    return "-";
  }
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

function formatMoney(v) {
  if (v == null) return "-";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function initialsOf(name) {
  const s = String(name || "").trim();
  if (!s) return "U";
  const parts = s.split(/\s+/).filter(Boolean);
  const a = (parts[0] || "").slice(0, 1);
  const b = (parts[1] || "").slice(0, 1);
  const out = (a + b).toUpperCase();
  return out || "U";
}

function saveLastPlayerId(id) {
  try {
    window.localStorage.setItem("admin_last_player_id", String(id));
  } catch (_) {}
}

function loadLastPlayerId() {
  try {
    const v = window.localStorage.getItem("admin_last_player_id");
    const n = parseInt(v || "", 10);
    return n || null;
  } catch (_) {
    return null;
  }
}

export default function PlayersPage() {
  return (
    <RequireAuth>
      {" "}
      {({ token, admin }) => <PlayersInner token={token} admin={admin} />}
    </RequireAuth>
  );
}

function PlayersInner({ token, admin }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [players, setPlayers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [actionError, setActionError] = useState("");
  const [txOpen, setTxOpen] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState("");
  const [txRows, setTxRows] = useState([]);
  const [txReferralTotal, setTxReferralTotal] = useState(0);
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjKind, setAdjKind] = useState("add");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjNote, setAdjNote] = useState("");
  const [adjSubmitting, setAdjSubmitting] = useState(false);
  const [adjError, setAdjError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    setActionError("");
    try {
      const res = await apiFetch(
        `/api/admin/players?q=${encodeURIComponent(q)}`,
        { token },
      );
      const nextPlayers = res.players || [];
      setPlayers(nextPlayers);

      const lastId = loadLastPlayerId();
      if (lastId && !selected) {
        const found = nextPlayers.find((p) => p.id === lastId);
        if (found) setSelected(found);
      }
    } catch (err) {
      if (err && err.status === 401) {
        saveToken(null);
        window.location.href = "/login";
        return;
      }
      setError(err && err.message ? err.message : "Failed to load players");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const canRead = useMemo(() => hasPerm(admin, "players.read"), [admin]);
  const canModerate = useMemo(() => hasPerm(admin, "players.ban"), [admin]);

  function openAdjustCash(p) {
    if (!p) return;
    setAdjError("");
    setAdjKind("add");
    setAdjAmount("");
    setAdjNote("");
    setAdjOpen(true);
  }

  async function submitAdjustCash() {
    if (!selected) return;
    setAdjSubmitting(true);
    setAdjError("");
    setActionError("");
    try {
      const raw = String(adjAmount || "").trim();
      const n = Number(raw);
      if (!raw || Number.isNaN(n) || !Number.isFinite(n) || n <= 0) {
        setAdjError("Enter a valid amount.");
        return;
      }

      const signed = adjKind === "sub" ? -Math.abs(n) : Math.abs(n);

      await apiFetch(`/api/admin/players/${selected.id}/wallet`, {
        token,
        method: "PATCH",
        body: { delta: String(signed), note: adjNote },
      });

      setAdjOpen(false);
      await load();
    } catch (err) {
      setAdjError(err?.message || "Failed");
    } finally {
      setAdjSubmitting(false);
    }
  }

  async function ban(p) {
    setActionError("");
    try {
      const reason =
        window.prompt("Ban reason (optional):", p?.banReason || "") || "";
      await apiFetch(`/api/admin/players/${p.id}/ban`, {
        token,
        method: "PATCH",
        body: { reason },
      });
      await load();
      setSelected(null);
    } catch (err) {
      setActionError(err?.message || "Failed");
    }
  }

  async function unban(p) {
    setActionError("");
    try {
      await apiFetch(`/api/admin/players/${p.id}/unban`, {
        token,
        method: "PATCH",
      });
      await load();
      setSelected(null);
    } catch (err) {
      setActionError(err?.message || "Failed");
    }
  }

  async function openTransactions(p) {
    if (!p) return;
    setTxOpen(true);
    setTxLoading(true);
    setTxError("");
    setTxRows([]);
    setTxReferralTotal(0);

    try {
      const res = await apiFetch(
        `/api/admin/players/${p.id}/transactions?limit=200`,
        { token },
      );
      setTxRows(res.transactions || []);
      setTxReferralTotal(
        res.referralTotal != null ? Number(res.referralTotal) : 0,
      );
    } catch (err) {
      setTxError(err?.message || "Failed to load transactions");
    } finally {
      setTxLoading(false);
    }
  }

  function handleSearch(e) {
    e.preventDefault();
    load();
  }

  return (
    <AdminShell
      admin={admin}
      title="Players"
      onLogout={() => {
        saveToken(null);
        window.location.href = "/login";
      }}
    >
      <div className="space-y-5">
        {" "}
        {/* Adjust Cash Modal */}{" "}
        <Modal
          open={adjOpen}
          onClose={() => {
            if (adjSubmitting) return;
            setAdjOpen(false);
            setAdjError("");
            setAdjAmount("");
            setAdjNote("");
            setAdjKind("add");
          }}
          title="Adjust User Balance"
          maxWidth="max-w-xl"
          zIndex="z-[70]"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-success/20 text-success flex items-center justify-center font-semibold text-lg">
                {" "}
                {initialsOf(
                  selected?.username || selected?.phone || "User",
                )}{" "}
              </div>{" "}
              <div className="flex-1">
                <div className="text-lg font-semibold text-slate-100 leading-tight">
                  {" "}
                  {selected?.username || "Player"}{" "}
                </div>{" "}
                <div className="text-sm text-muted leading-tight">
                  {" "}
                  {selected?.phone || "-"}{" "}
                </div>{" "}
                <div className="text-xs text-muted mt-1">
                  {" "}
                  ID: {selected?.telegramId || "-"}{" "}
                </div>{" "}
              </div>{" "}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <div className="text-slate-300">
                {" "}
                Points:{" "}
                <span className="font-semibold text-slate-100">
                  {" "}
                  {formatMoney(selected?.gift)}{" "}
                </span>
              </div>
              <div className="text-slate-300">
                {" "}
                Cash:{" "}
                <span className="font-semibold text-slate-100">
                  {" "}
                  {formatMoney(selected?.wallet)}
                  ETB{" "}
                </span>
              </div>
              <div className="text-slate-300">
                {" "}
                Wins:{" "}
                <span className="font-semibold text-slate-100">
                  {" "}
                  {selected?.wins ?? 0}{" "}
                </span>
              </div>
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-100 mb-2">
                {" "}
                Adjustment Type{" "}
              </div>{" "}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className={`h-12 rounded-xl border text-sm font-semibold transition ${adjKind === "add" ? "bg-success text-white border-success" : "bg-bg-secondary text-slate-200 border-border hover:bg-bg-secondary/70"}`}
                  onClick={() => setAdjKind("add")}
                  disabled={adjSubmitting}
                >
                  Add Cash{" "}
                </button>{" "}
                <button
                  type="button"
                  className={`h-12 rounded-xl border text-sm font-semibold transition ${adjKind === "sub" ? "bg-danger text-white border-danger" : "bg-bg-secondary text-slate-200 border-border hover:bg-bg-secondary/70"}`}
                  onClick={() => setAdjKind("sub")}
                  disabled={adjSubmitting}
                >
                  Subtract Cash{" "}
                </button>{" "}
              </div>{" "}
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-100 mb-2">
                {" "}
                Amount(ETB){" "}
              </div>{" "}
              <input
                value={adjAmount}
                onChange={(e) => setAdjAmount(e.target.value)}
                placeholder="Enter ETB amount (e.g., 1.50)..."
                className="w-full h-12 px-4 rounded-xl bg-bg-secondary border border-border text-slate-100 placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
                disabled={adjSubmitting}
                inputMode="decimal"
              />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-100 mb-2">
                {" "}
                Remark(reason for adjustment){" "}
              </div>{" "}
              <textarea
                value={adjNote}
                onChange={(e) => setAdjNote(e.target.value)}
                placeholder="e.g., Manual adjustment, Compensation, Refund..."
                className="w-full min-h-[110px] px-4 py-3 rounded-xl bg-bg-secondary border border-border text-slate-100 placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
                disabled={adjSubmitting}
              />{" "}
            </div>
            {adjError && (
              <div className="bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger">
                {" "}
                {adjError}{" "}
              </div>
            )}
            <div className="space-y-3 pt-2">
              <Button
                variant={adjKind === "sub" ? "danger" : "success"}
                size="lg"
                className="w-full"
                loading={adjSubmitting}
                disabled={!canModerate || adjSubmitting}
                onClick={submitAdjustCash}
              >
                {adjKind === "sub" ? "Subtract Cash" : "Add Cash"}{" "}
              </Button>{" "}
              <Button
                variant="outline"
                size="lg"
                className="w-full"
                disabled={adjSubmitting}
                onClick={() => setAdjOpen(false)}
              >
                Cancel{" "}
              </Button>{" "}
            </div>{" "}
          </div>{" "}
        </Modal>
        {/* Transaction History Modal */}{" "}
        <Modal
          open={txOpen}
          onClose={() => {
            setTxOpen(false);
            setTxError("");
            setTxRows([]);
            setTxReferralTotal(0);
          }}
          title={`Transaction History (User ID: ${selected?.telegramId || "-"})`}
          maxWidth="max-w-5xl"
          zIndex="z-[60]"
        >
          <div className="space-y-4">
            <div className="bg-bg-secondary border border-border rounded-xl p-4">
              <div className="text-xs text-muted">
                {" "}
                Total Referral Earnings{" "}
              </div>{" "}
              <div className="text-2xl font-semibold text-slate-100 mt-1">
                {" "}
                {formatMoney(txReferralTotal)}
                ETB{" "}
              </div>{" "}
            </div>
            {txError && (
              <div className="bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger">
                {" "}
                {txError}{" "}
              </div>
            )}
            <div className="overflow-auto border border-border rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-muted uppercase tracking-wider border-b border-border bg-bg-secondary/40">
                    <th className="px-5 py-3"> Date </th>{" "}
                    <th className="pr-3 py-3"> Type </th>{" "}
                    <th className="pr-3 py-3"> Description </th>{" "}
                    <th className="pr-3 py-3"> Amount </th>{" "}
                    <th className="pr-3 py-3"> Balance Before </th>{" "}
                    <th className="pr-5 py-3"> Balance After </th>{" "}
                  </tr>{" "}
                </thead>{" "}
                <tbody>
                  {" "}
                  {txLoading ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="text-center py-10 text-muted text-sm"
                      >
                        {" "}
                        Loading...{" "}
                      </td>{" "}
                    </tr>
                  ) : txRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="text-center py-10 text-muted text-sm"
                      >
                        {" "}
                        No transactions{" "}
                      </td>{" "}
                    </tr>
                  ) : (
                    txRows.map((t) => {
                      const amt = Number(t.amount || 0);
                      const amtText = `${amt >= 0 ? "+" : ""}${formatMoney(amt)} ETB`;
                      const amtClass =
                        amt >= 0 ? "text-success" : "text-danger";
                      return (
                        <tr key={t.id} className="border-b border-border/40">
                          <td className="px-5 py-3 text-muted whitespace-nowrap">
                            {" "}
                            {formatDateTime(t.createdAt)}{" "}
                          </td>{" "}
                          <td className="pr-3 py-3 text-slate-200 whitespace-nowrap">
                            {" "}
                            {t.kind || "-"}{" "}
                          </td>{" "}
                          <td className="pr-3 py-3 text-muted max-w-[420px] truncate">
                            {" "}
                            {t.note || "-"}{" "}
                          </td>{" "}
                          <td
                            className={`pr-3 py-3 font-medium whitespace-nowrap ${amtClass}`}
                          >
                            {" "}
                            {amtText}{" "}
                          </td>{" "}
                          <td className="pr-3 py-3 text-slate-300 whitespace-nowrap">
                            {" "}
                            {formatMoney(t.balanceBefore)}
                            ETB{" "}
                          </td>{" "}
                          <td className="pr-5 py-3 text-slate-300 whitespace-nowrap">
                            {" "}
                            {formatMoney(t.balanceAfter)}
                            ETB{" "}
                          </td>{" "}
                        </tr>
                      );
                    })
                  )}{" "}
                </tbody>{" "}
              </table>{" "}
            </div>{" "}
          </div>{" "}
        </Modal>
        {/* Player Detail Modal */}{" "}
        <Modal
          open={!!selected}
          onClose={() => setSelected(null)}
          title="User Actions"
          maxWidth="max-w-xl"
        >
          {" "}
          {selected && (
            <>
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-full bg-success/20 text-success flex items-center justify-center font-semibold text-lg">
                  {" "}
                  {initialsOf(
                    selected.username || selected.phone || "User",
                  )}{" "}
                </div>{" "}
                <div className="flex-1">
                  <div className="text-lg font-semibold text-slate-100 leading-tight">
                    {" "}
                    {selected.username || "Player"}{" "}
                  </div>{" "}
                  <div className="text-sm text-muted leading-tight">
                    {" "}
                    {selected.phone || "-"}{" "}
                  </div>{" "}
                  <div className="text-xs text-muted mt-1">
                    {" "}
                    ID: {selected.telegramId || "-"}{" "}
                  </div>{" "}
                </div>{" "}
              </div>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <div className="text-slate-300">
                  {" "}
                  Points:{" "}
                  <span className="font-semibold text-slate-100">
                    {" "}
                    {formatMoney(selected.gift)}{" "}
                  </span>
                </div>
                <div className="text-slate-300">
                  {" "}
                  Cash:{" "}
                  <span className="font-semibold text-slate-100">
                    {" "}
                    {formatMoney(selected.wallet)}
                    ETB{" "}
                  </span>
                </div>
                <div className="text-slate-300">
                  {" "}
                  Wins:{" "}
                  <span className="font-semibold text-slate-100">
                    {" "}
                    {selected.wins ?? 0}{" "}
                  </span>
                </div>
              </div>
              <div className="mt-2 text-xs text-muted">
                {" "}
                Joined: {formatDate(selected.createdAt)}{" "}
              </div>
              <div className="mt-4">
                {" "}
                {selected.bannedAt ? (
                  <div>
                    <Badge variant="danger" dot>
                      {" "}
                      Banned{" "}
                    </Badge>{" "}
                    {selected.banReason && (
                      <div className="text-xs text-muted mt-1">
                        {" "}
                        Reason: {selected.banReason}{" "}
                      </div>
                    )}{" "}
                  </div>
                ) : (
                  <Badge variant="success" dot>
                    {" "}
                    Active{" "}
                  </Badge>
                )}{" "}
              </div>
              {actionError && (
                <div className="bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger mt-4">
                  {" "}
                  {actionError}{" "}
                </div>
              )}
              <div className="mt-6 space-y-3">
                <Button
                  variant="success"
                  size="lg"
                  className="w-full"
                  disabled={!canModerate}
                  loading={loading}
                  onClick={() => openAdjustCash(selected)}
                >
                  Adjust Cash Balance{" "}
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  onClick={() => openTransactions(selected)}
                >
                  View Transaction History{" "}
                </Button>
                {!canModerate ? (
                  <div className="text-center text-xs text-muted">
                    {" "}
                    No moderation access{" "}
                  </div>
                ) : selected.bannedAt ? (
                  <Button
                    variant="success"
                    size="lg"
                    className="w-full"
                    icon={IconCheck}
                    loading={loading}
                    onClick={() => unban(selected)}
                  >
                    Unban{" "}
                  </Button>
                ) : (
                  <Button
                    variant="danger"
                    size="lg"
                    className="w-full"
                    icon={IconBan}
                    loading={loading}
                    onClick={() => ban(selected)}
                  >
                    Ban{" "}
                  </Button>
                )}{" "}
              </div>{" "}
            </>
          )}{" "}
        </Modal>
        {/* Search */}{" "}
        <Card title="Search Players" icon={IconSearch}>
          <form onSubmit={handleSearch} className="flex gap-3">
            <div className="flex-1">
              <SearchInput
                placeholder="Search by username, phone, or Telegram ID..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />{" "}
            </div>{" "}
            <Button
              variant="primary"
              type="submit"
              icon={IconSearch}
              loading={loading}
            >
              Search{" "}
            </Button>{" "}
            <Button
              variant="outline"
              icon={IconRefresh}
              onClick={load}
              loading={loading}
            >
              Refresh{" "}
            </Button>{" "}
          </form>{" "}
          {error && (
            <div className="bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger mt-3">
              {" "}
              {error}{" "}
            </div>
          )}{" "}
        </Card>
        {/* Players Table */}{" "}
        {!canRead ? (
          <Card title="No access">
            <div className="text-sm text-muted">
              {" "}
              You do not have permission to view players.{" "}
            </div>{" "}
          </Card>
        ) : (
          <Card
            title={`Players (${players.length})`}
            icon={IconUsers}
            noPadding
          >
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-muted uppercase tracking-wider border-b border-border">
                    <th className="px-5 py-3"> ID </th>{" "}
                    <th className="pr-3 py-3"> Username </th>{" "}
                    <th className="pr-3 py-3"> Phone </th>{" "}
                    <th className="pr-3 py-3"> Wallet </th>{" "}
                    <th className="pr-3 py-3"> Gift </th>{" "}
                    <th className="pr-3 py-3"> Wins </th>{" "}
                    <th className="pr-3 py-3"> Status </th>{" "}
                    <th className="pr-3 py-3"> Joined </th>{" "}
                    <th className="pr-5 py-3 text-right"> Actions </th>{" "}
                  </tr>{" "}
                </thead>{" "}
                <tbody>
                  {" "}
                  {players.map((p) => {
                    const banned = !!p.bannedAt;
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-border/40 transition-colors"
                      >
                        <td className="px-5 py-3 text-muted font-mono text-xs">
                          {" "}
                          {p.id}{" "}
                        </td>{" "}
                        <td className="pr-3 py-3 font-medium text-slate-200">
                          {" "}
                          {p.username || "-"}{" "}
                        </td>{" "}
                        <td className="pr-3 py-3 text-slate-400 font-mono text-xs">
                          {" "}
                          {p.phone || "-"}{" "}
                        </td>{" "}
                        <td className="pr-3 py-3 text-slate-300">
                          {" "}
                          {formatMoney(p.wallet)}{" "}
                        </td>{" "}
                        <td className="pr-3 py-3 text-slate-300">
                          {" "}
                          {formatMoney(p.gift)}{" "}
                        </td>{" "}
                        <td className="pr-3 py-3 text-slate-300">
                          {" "}
                          {p.wins ?? 0}{" "}
                        </td>{" "}
                        <td className="pr-3 py-3">
                          {" "}
                          {banned ? (
                            <Badge variant="danger" dot>
                              {" "}
                              Banned{" "}
                            </Badge>
                          ) : (
                            <Badge variant="success" dot>
                              {" "}
                              Active{" "}
                            </Badge>
                          )}{" "}
                        </td>{" "}
                        <td className="pr-3 py-3 text-muted text-xs">
                          {" "}
                          {formatDate(p.createdAt)}{" "}
                        </td>{" "}
                        <td className="pr-5 py-3">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="xs"
                              icon={IconEye}
                              onClick={() => {
                                setSelected(p);
                                saveLastPlayerId(p.id);
                              }}
                            >
                              View{" "}
                            </Button>{" "}
                          </div>{" "}
                        </td>{" "}
                      </tr>
                    );
                  })}{" "}
                  {players.length === 0 && !loading && (
                    <tr>
                      <td
                        colSpan={9}
                        className="text-center py-12 text-muted text-sm"
                      >
                        {" "}
                        No players found{" "}
                      </td>{" "}
                    </tr>
                  )}{" "}
                </tbody>{" "}
              </table>{" "}
            </div>{" "}
          </Card>
        )}{" "}
      </div>{" "}
    </AdminShell>
  );
}
