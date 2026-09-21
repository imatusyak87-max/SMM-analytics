import axios from 'axios';

export const apiClient = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000' });

let unauthorizedHandler: (() => void) | null = null;

// Registered here, at import time, and never per-component: axios freezes a
// request's interceptor chain when the request is dispatched, and React runs a
// page's effects (which fetch) before its parent provider's (which used to
// register this). A session that expired between visits therefore had its very
// first 401 slip past unnoticed, leaving the app claiming to be logged in while
// every request failed. The handler is looked up when the response arrives, so
// it covers requests already in flight.
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) unauthorizedHandler?.();
    return Promise.reject(error);
  },
);

/** Registers a handler for expired/invalid sessions; returns a function that unregisters it. */
export function onUnauthorized(handler: () => void): () => void {
  unauthorizedHandler = handler;
  return () => {
    // Only clear our own: in StrictMode the next provider registers before this cleanup runs.
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

export function setAuthToken(token: string | null) {
  if (token) apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  else delete apiClient.defaults.headers.common['Authorization'];
}
