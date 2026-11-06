"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export type Role = "user" | "admin";

const STORAGE_KEY = "quotapay.role.v1";

const RoleContext = createContext<{
  role: Role;
  setRole: (role: Role) => void;
}>({
  role: "user",
  setRole: () => {},
});

/**
 * A lightweight "who are you?" switch. Beneficiaries ("user") and company
 * admins ("admin") get different navigation, so each role only sees the pages
 * relevant to them. Persisted to localStorage; defaults to "user".
 */
export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>("user");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "admin" || stored === "user") setRoleState(stored);
    } catch {
      /* ignore */
    }
  }, []);

  const setRole = useCallback((next: Role) => {
    setRoleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <RoleContext.Provider value={{ role, setRole }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
