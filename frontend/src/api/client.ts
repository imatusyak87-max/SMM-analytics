import axios from 'axios';

export const apiClient = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000' });

/** Registers a handler for expired/invalid sessions; returns a function that unregisters it. */
export function onUnauthorized(handler: () => void): () => void {
  const id = apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error?.response?.status === 401) handler();
      return Promise.reject(error);
    },
  );
  return () => apiClient.interceptors.response.eject(id);
}

export function setAuthToken(token: string | null) {
  if (token) apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  else delete apiClient.defaults.headers.common['Authorization'];
}
