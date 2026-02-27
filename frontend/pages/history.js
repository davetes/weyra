import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Gamepad2, History as HistoryIcon, User, Wallet as WalletIcon } from "lucide-react";

function formatDateTime(d) {
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "-";
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const yyyy = dt.getFullYear();
    const hh = String(dt.getHours()).padStart(2, "0");
    const min = String(dt.getMinutes()).padStart(2, "0");
    const ss = String(dt.getSeconds()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy}, ${hh}:${min}:${ss}`;
  } catch (_) {
    return "-";
  }
}

export default function HistoryPage() {
  const router = useRouter();
  const tid = useMemo(() => {
    const raw = router.query?.tid;
    return raw != null ? String(raw) : "";
  }, [router.query]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [totalGames, setTotalGames] = useState(0);
  const [games, setGames] = useState([]);

  async function refresh() {
    if (!tid) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/history?tid=${encodeURIComponent(tid)}`);
      if (!res.ok) {
        setError("Failed to load history");
        return;
      }
      const data = await res.json();
      setTotalGames(Number(data.totalGames || 0));
      setGames(Array.isArray(data.games) ? data.games : []);
    } catch (e) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [tid]);

  return (
    <>
      <Head>
        <title>Game History</title>
      </Head>

      <div className="min-h-[100svh] w-full bg-gradient-to-b from-[#0a0f1a] via-[#0d1321] to-[#0a0f1a] text-white pb-24">
        <div className="px-4 pt-6">
          <div className="text-3xl font-black tracking-tight">Game History</div>

          <div className="mt-5 rounded-none border border-white/10 bg-white/5 px-5 py-4">
            <div className="text-white/60 text-sm font-semibold">Total Games</div>
            <div className="mt-2 text-4xl font-black">{totalGames}</div>
          </div>

          <div className="mt-7 text-xl font-black">Recent Games</div>

          {error && (
            <div className="mt-4 rounded-none border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 font-semibold">
              {error}
            </div>
          )}

          {loading && (
            <div className="mt-4 text-center text-xs text-white/60">Loading...</div>
          )}

          <div className="mt-4 space-y-4">
            {games.length === 0 && !loading ? (
              <div className="rounded-none border border-white/10 bg-white/5 px-5 py-6 text-white/70 text-sm">
                No games yet.
              </div>
            ) : (
              games.map((g) => {
                const lost = String(g.result) === "lost";
                return (
                  <div
                    key={String(g.gameId)}
                    className="rounded-none border border-white/10 bg-slate-950/25 px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div
                          className={`w-11 h-11 rounded-full border border-white/10 flex-none ${
                            lost ? "bg-rose-500/15" : "bg-emerald-500/15"
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="font-black text-lg truncate">
                            Game {g.gameId}
                          </div>
                          <div className="mt-1 text-white/60 text-sm">
                            {formatDateTime(g.createdAt)}
                          </div>
                        </div>
                      </div>

                      <div
                        className={`h-7 px-3 rounded-xl text-xs font-black border flex items-center flex-none ${
                          lost
                            ? "bg-rose-500/10 border-rose-500/25 text-rose-300"
                            : "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
                        }`}
                      >
                        {lost ? "Lost" : "Won"}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                      <div>
                        <div className="text-white/60 text-xs font-semibold">Stake:</div>
                        <div className="mt-1 font-black">{g.stake}</div>
                      </div>
                      <div>
                        <div className="text-white/60 text-xs font-semibold">Cards</div>
                        <div className="mt-1 font-black">{g.cards}</div>
                      </div>
                      <div>
                        <div className="text-white/60 text-xs font-semibold">Prize:</div>
                        <div className="mt-1 font-black">{Math.round(Number(g.prize || 0))}</div>
                      </div>
                      <div>
                        <div className="text-white/60 text-xs font-semibold">Winners:</div>
                        <div className="mt-1 font-black">{g.winners}</div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(420px,calc(100vw-1.25rem))] z-[9999]">
          <div className="bg-slate-950/70 backdrop-blur border border-white/10 px-3 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => router.push(tid ? `/?tid=${encodeURIComponent(tid)}` : "/")}
                className="flex flex-col items-center justify-center py-2 rounded-xl text-white/70 hover:bg-white/5"
              >
                <Gamepad2 className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">Game</div>
              </button>

              <button
                type="button"
                onClick={() => router.push(tid ? `/history?tid=${encodeURIComponent(tid)}` : "/history")}
                className="flex flex-col items-center justify-center py-2 rounded-xl bg-sky-500/15 border border-sky-400/20 text-sky-200"
              >
                <HistoryIcon className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">History</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(tid ? `/wallet?tid=${encodeURIComponent(tid)}` : "/wallet")
                }
                className="flex flex-col items-center justify-center py-2 rounded-xl text-white/70 hover:bg-white/5"
              >
                <WalletIcon className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">Wallet</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(tid ? `/profile?tid=${encodeURIComponent(tid)}` : "/profile")
                }
                className="flex flex-col items-center justify-center py-2 rounded-xl text-white/70 hover:bg-white/5"
              >
                <User className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">Profile</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
