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
        <title>weyra Bingo</title>
      </Head>
      <div className="flex items-center justify-center h-screen text-muted text-sm font-medium">
        Redirecting...
      </div>
    </>
  );
}
