import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import type { LoginConfig, MeResponse, UserDto } from '../api/types';

interface AuthContextValue {
  user: UserDto | null;
  isAdmin: boolean;
  loading: boolean;
  config: LoginConfig | null;
  loginDev: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<LoginConfig | null>(null);

  const reload = useCallback(async () => {
    try {
      const me = await api<MeResponse>('/api/v1/auth/me');
      setUser(me.user);
      setIsAdmin(me.is_admin);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setIsAdmin(false);
      } else {
        throw error;
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api<LoginConfig>('/api/v1/auth/config');
        if (!cancelled) setConfig(cfg);
      } catch {
        // 配置接口失败不阻塞登录页渲染
      }
      try {
        await reload();
      } catch {
        // 忽略网络错误，保持未登录态
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const loginDev = useCallback(async (email: string) => {
    const result = await api<{ user: UserDto }>('/api/v1/auth/dev-login', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    setUser(result.user);
    setIsAdmin(result.user.role === 'admin');
  }, []);

  const logout = useCallback(async () => {
    await api<void>('/api/v1/auth/logout', { method: 'POST' });
    setUser(null);
    setIsAdmin(false);
  }, []);

  const value = useMemo(
    () => ({ user, isAdmin, loading, config, loginDev, logout, reload }),
    [user, isAdmin, loading, config, loginDev, logout, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}