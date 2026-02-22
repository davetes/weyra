import { apiFetch } from "./api";

export async function listDepositRequests(token, { status } = {}) {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch(`/api/admin/deposit_requests${q}`, { token });
}

export async function decideDepositRequest(
  token,
  id,
  { decision, note, amount } = {},
) {
  return apiFetch(`/api/admin/deposit_requests/${id}/decide`, {
    token,
    method: "PATCH",
    body: { decision, note: note || "", amount },
  });
}

export async function listWithdrawRequests(token, { status } = {}) {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch(`/api/admin/withdraw_requests${q}`, { token });
}

export async function decideWithdrawRequest(
  token,
  id,
  { decision, note } = {},
) {
  return apiFetch(`/api/admin/withdraw_requests/${id}/decide`, {
    token,
    method: "PATCH",
    body: { decision, note: note || "" },
  });
}
