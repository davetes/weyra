import "../styles/globals.css";

export default function App({ Component, pageProps }) {
  return (
    <div suppressHydrationWarning>
      <Component {...pageProps} />
    </div>
  );
}
