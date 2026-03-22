/**
 * Telegram MiniApp API helper.
 *
 * Wraps fetch() to automatically include initData from window.Telegram.WebApp.
 * This ensures all API requests carry the cryptographic proof that the user
 * is who they say they are through Telegram's initData signature.
 */

/** Get the raw initData string from Telegram WebApp */
export function getInitData() {
  if (typeof window !== "undefined" && window.Telegram?.WebApp?.initData) {
    return window.Telegram.WebApp.initData;
  }
  return "";
}

/** Get user info from Telegram WebApp */
export function getTelegramUser() {
  if (typeof window !== "undefined" && window.Telegram?.WebApp?.initDataUnsafe?.user) {
    return window.Telegram.WebApp.initDataUnsafe.user;
  }
  return null;
}

/** Get the tid (Telegram user ID) from Telegram WebApp */
export function getTid() {
  const user = getTelegramUser();
  return user?.id ? String(user.id) : "";
}

/**
 * Fetch wrapper that adds initData header to all requests.
 * Use this instead of raw fetch() for all API calls.
 */
export async function apiFetch(url, options = {}) {
  const initData = getInitData();
  const headers = {
    ...(options.headers || {}),
  };
  if (initData) {
    headers["X-Telegram-Init-Data"] = initData;
  }
  return fetch(url, { ...options, headers });
}

/**
 * Builds a URL with initData as query parameter (for GET requests
 * where custom headers may not be easy to set, e.g. EventSource).
 */
export function apiUrl(baseUrl) {
  const initData = getInitData();
  if (!initData) return baseUrl;
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}initData=${encodeURIComponent(initData)}`;
}
