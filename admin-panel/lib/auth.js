import { apiFetch, getStoredToken, setStoredToken } from './api';

export function loadToken() {
    return getStoredToken();
}

export function saveToken(token) {
    setStoredToken(token);
}

export async function fetchMe(token) {
    return apiFetch('/api/admin/me', { token });
}

export async function login(username, password) {
    return apiFetch('/api/admin/login', { method: 'POST', body: { username, password } });
}

export async function bootstrapSuperAdmin(token, username, password) {
    return apiFetch('/api/admin/bootstrap', { method: 'POST', body: { token, username, password } });
}
