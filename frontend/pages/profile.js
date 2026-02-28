import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import {
  Gamepad2,
  History,
  User,
  Wallet as WalletIcon,
  Volume2,
  Trophy,
  Users,
  TrendingUp,
} from "lucide-react";

export default function ProfilePage() {
  const router = useRouter();

  const tid = useMemo(() => {
    const raw = router.query?.tid;
    return raw != null ? String(raw) : "";
  }, [router.query]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [wallet, setWallet] = useState(0);
  const [gift, setGift] = useState(0);
  const [wins, setWins] = useState(0);
  const [totalInvites, setTotalInvites] = useState(0);
  const [totalEarning, setTotalEarning] = useState(0);
  const [referralLink, setReferralLink] = useState("");
  const [phone, setPhone] = useState("");
  const [notice, setNotice] = useState("");

  const [soundOn, setSoundOn] = useState(true);

  useEffect(() => {
    const saved = window.localStorage.getItem("sound_on");
    if (saved === "0") setSoundOn(false);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("sound_on", soundOn ? "1" : "0");
  }, [soundOn]);

  async function refresh() {
    if (!tid) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/profile?tid=${encodeURIComponent(tid)}`);
      if (!res.ok) {
        setError("Failed to load profile");
        return;
      }
      const data = await res.json();
      const p = data?.profile || {};
      setUsername(String(p.username || ""));
      setWallet(typeof p.wallet === "number" ? p.wallet : 0);
      setGift(typeof p.gift === "number" ? p.gift : 0);
      setWins(typeof p.wins === "number" ? p.wins : 0);
      setTotalInvites(typeof p.totalInvites === "number" ? p.totalInvites : 0);
      setTotalEarning(typeof p.totalEarning === "number" ? p.totalEarning : 0);
      setReferralLink(String(p.referralLink || ""));
      setPhone(String(p.phone || ""));
    } catch (e) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [tid]);

  const displayName = username || "Player";
  const initial = (displayName.trim()[0] || "P").toUpperCase();
  const verified = String(phone || "").trim().length > 0;

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(""), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  async function copyReferralLink() {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setNotice("Referral link copied");
    } catch (_) {
      setNotice("Copy failed");
    }
  }

  return (
    <>
      <Head>
        <title>Profile</title>
      </Head>

      <div className="min-h-[100svh] w-full bg-gradient-to-b from-[#0a0f1a] via-[#0d1321] to-[#0a0f1a] text-white pb-24">
        <div className="px-4 pt-6">
          <div className="flex flex-col items-center">
            <div className="w-14 h-14 rounded-full bg-slate-900/40 border border-white/10 flex items-center justify-center text-xl font-black">
              {initial}
            </div>
            <div className="mt-3 text-2xl font-black">{displayName}</div>
          </div>

          {error && (
            <div className="mt-5 rounded-none border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 font-semibold">
              {error}
            </div>
          )}

          {notice && (
            <div className="mt-5 rounded-none border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 font-semibold">
              {notice}
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-none border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-xs text-white/60">
                <WalletIcon className="w-4 h-4" />
                Main Wallet
              </div>
              <div className="mt-2 text-2xl font-black">
                {Number(wallet || 0).toFixed(0)}
              </div>
            </div>

            <div className="rounded-none border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-xs text-white/60">
                <WalletIcon className="w-4 h-4 text-emerald-300" />
                Play Wallet
              </div>
              <div className="mt-2 text-2xl font-black">
                {Number(gift || 0).toFixed(0)}
              </div>
            </div>

            <div className="rounded-none border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-xs text-white/60">
                <Trophy className="w-4 h-4 text-violet-300" />
                Games Won
              </div>
              <div className="mt-2 text-2xl font-black">{wins || 0}</div>
            </div>

            <div className="rounded-none border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-xs text-white/60">
                <Users className="w-4 h-4 text-orange-300" />
                Total Invite
              </div>
              <div className="mt-2 text-2xl font-black">
                {totalInvites || 0}
              </div>
            </div>

            <div className="rounded-none border border-white/10 bg-white/5 p-4 col-span-2">
              <div className="flex items-center gap-2 text-xs text-white/60">
                <TrendingUp className="w-4 h-4 text-emerald-300" />
                Total Earning
              </div>
              <div className="mt-2 text-2xl font-black">
                {Number(totalEarning || 0).toFixed(0)}
              </div>
            </div>
          </div>

          <div className="mt-7 text-lg font-black">Settings</div>

          <div className="mt-3 rounded-none border border-white/10 bg-white/5 p-4">
            <div className="text-base font-black">Referral Center</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-none border border-white/10 bg-slate-900/40 p-4">
                <div className="text-xs text-white/60 font-semibold">
                  Total Invites
                </div>
                <div className="mt-1 text-2xl font-black">
                  {totalInvites || 0}
                </div>
              </div>
              <div className="rounded-none border border-white/10 bg-slate-900/40 p-4">
                <div className="text-xs text-white/60 font-semibold">
                  Referral Earnings
                </div>
                <div className="mt-1 text-2xl font-black">
                  {Number(totalEarning || 0).toFixed(0)}
                </div>
              </div>
            </div>

            <div className="mt-3 text-xs text-white/60">Your referral link</div>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 min-w-0 h-11 px-3 bg-white/5 border border-white/10 flex items-center text-xs text-white/80 truncate">
                {referralLink ||
                  "Set BOT_USERNAME in server .env to enable referral link"}
              </div>
              <button
                type="button"
                onClick={copyReferralLink}
                disabled={!referralLink}
                className="h-11 px-4 font-black bg-sky-500/15 border border-sky-400/20 text-sky-200 disabled:opacity-50"
              >
                Copy
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-none border border-white/10 bg-white/5 p-4">
            <div className="text-base font-black">Account &amp; Security</div>

            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white/70">
                  Telegram ID
                </div>
                <div className="text-sm font-black text-white/90">
                  {tid || "—"}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white/70">Phone</div>
                <div className="text-sm font-black text-white/90 truncate">
                  {phone || "—"}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white/70">
                  Status
                </div>
                <div
                  className={`h-8 px-3 border text-xs font-bold flex items-center ${
                    verified
                      ? "bg-emerald-500/15 border-emerald-400/25 text-emerald-200"
                      : "bg-amber-500/15 border-amber-400/25 text-amber-200"
                  }`}
                >
                  {verified ? "VERIFIED" : "NOT VERIFIED"}
                </div>
              </div>
            </div>

            {!verified && (
              <div className="mt-3 text-xs text-white/60 leading-relaxed">
                To verify your account, open the Telegram bot and share your
                phone number in registration.
              </div>
            )}
          </div>

          <div className="mt-3 rounded-none border border-white/10 bg-white/5 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                <Volume2 className="w-5 h-5 text-white/70" />
              </div>
              <div className="font-black">Sound</div>
            </div>

            <button
              type="button"
              onClick={() => setSoundOn((p) => !p)}
              className={`w-12 h-7 rounded-full border transition-all relative ${
                soundOn
                  ? "bg-emerald-500/40 border-emerald-400/40"
                  : "bg-white/10 border-white/15"
              }`}
              aria-label="Toggle sound"
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${
                  soundOn ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {loading && (
            <div className="mt-3 text-center text-xs text-white/60">
              Loading...
            </div>
          )}
        </div>

        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(420px,calc(100vw-1.25rem))] z-[9999]">
          <div className="bg-slate-950/70 backdrop-blur border border-white/10 px-3 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() =>
                  router.push(tid ? `/?tid=${encodeURIComponent(tid)}` : "/")
                }
                className="flex flex-col items-center justify-center py-2 rounded-xl text-white/70 hover:bg-white/5"
              >
                <Gamepad2 className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">Game</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    tid
                      ? `/history?tid=${encodeURIComponent(tid)}`
                      : "/history",
                  )
                }
                className="flex flex-col items-center justify-center py-2 rounded-xl text-white/70 hover:bg-white/5"
              >
                <History className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">History</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    tid ? `/wallet?tid=${encodeURIComponent(tid)}` : "/wallet",
                  )
                }
                className="flex flex-col items-center justify-center py-2 rounded-xl text-white/70 hover:bg-white/5"
              >
                <WalletIcon className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">Wallet</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    tid
                      ? `/profile?tid=${encodeURIComponent(tid)}`
                      : "/profile",
                  )
                }
                className="flex flex-col items-center justify-center py-2 rounded-xl bg-sky-500/15 border border-sky-400/20 text-sky-200"
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
