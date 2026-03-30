import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
});

function shouldSkipAuthRedirect(url?: string) {
  if (!url) return false;
  return url === '/auth/login'
    || url === '/setup'
    || url === '/setup/status';
}

// JWT interceptor
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const requestUrl = error.config?.url as string | undefined;
      const skipRedirectHeader = String(error.config?.headers?.['X-Skip-Auth-Redirect'] || '') === 'true';
      const isAuthPage = window.location.pathname === '/login' || window.location.pathname === '/setup';

      if (!shouldSkipAuthRedirect(requestUrl) && !skipRedirectHeader) {
        localStorage.removeItem('token');
        if (!isAuthPage) {
          window.location.replace('/login');
        }
      }
    }
    return Promise.reject(error);
  },
);

export { api };
