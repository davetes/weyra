export function getStoredToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("admin_token");
}

export function setStoredToken(token) {
  if (typeof window === "undefined") return;
  if (!token) window.localStorage.removeItem("admin_token");
  else window.localStorage.setItem("admin_token", token);
}

export async function apiFetch(path, { token, method, headers, body } = {}) {
  const nextHeaders = {
    "Content-Type": "application/json",
    ...(headers || {}),
  };

  if (token) nextHeaders.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    method: method || (body ? "POST" : "GET"),
    headers: nextHeaders,
    body: body == null ? undefined : JSON.stringify(body),
  });

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }

  if (!res.ok) {
    const msg = data?.error || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}
