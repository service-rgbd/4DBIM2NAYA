import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api/v1`;
export const api = axios.create({ baseURL: API, withCredentials: true });

let refreshing = null;
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const cfg = error.config;
    if (error.response?.status === 401 && !cfg._retry && !cfg.url.includes("/auth/")) {
      cfg._retry = true;
      refreshing = refreshing || api.post("/auth/refresh").finally(() => { refreshing = null; });
      try {
        await refreshing;
        return api(cfg);
      } catch (e) {
        window.dispatchEvent(new Event("auth:expired"));
      }
    }
    return Promise.reject(error);
  }
);

export function errMsg(e) {
  const detail = e?.response?.data?.detail;
  if (detail == null) return e?.message || "Une erreur est survenue. Réessayez.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => (d && typeof d.msg === "string" ? d.msg : JSON.stringify(d))).join(" ");
  if (typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export const get = (url, params) => api.get(url, { params }).then((r) => r.data);
export const post = (url, body) => api.post(url, body).then((r) => r.data);
export const patch = (url, body) => api.patch(url, body).then((r) => r.data);
export const put = (url, body) => api.put(url, body).then((r) => r.data);
export const del = (url, params) => api.delete(url, { params }).then((r) => r.data);
