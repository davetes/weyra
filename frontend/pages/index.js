import { useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stake = params.get("stake") || "10";
    const tid = params.get("tid") || "";
    router.replace(`/play?stake=${stake}${tid ? `&tid=${tid}` : ""}`);
  }, []);
  return (
    <>
      <Head>
        <title>LuckyBet Bingo</title>
      </Head>
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl gradient-accent flex items-center justify-center text-3xl font-black text-white shadow-glow-green">
            B
          </div>
          <div className="absolute inset-0 rounded-2xl gradient-accent opacity-40 animate-ringPulse" />
        </div>
        <div className="flex gap-1.5 mt-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-accent animate-pulse3"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
        <p className="text-muted text-sm font-medium">Loading game...</p>
      </div>
    </>
  );
}
