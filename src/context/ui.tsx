import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useLocalStorage } from "@/hooks/store";

export interface Prefs {
  /** Autoplay muted thumbnail previews on card hover (desktop). */
  preview: boolean;
}

interface UiValue {
  collapsed: boolean;
  toggleCollapsed: () => void;
  mobileNav: boolean;
  setMobileNav: (v: boolean) => void;
  mobileSearch: boolean;
  setMobileSearch: (v: boolean) => void;
  prefs: Prefs;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
}

const UiContext = createContext<UiValue | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useLocalStorage("eb:sidebar-collapsed", false);
  const [prefs, setPrefs] = useLocalStorage<Prefs>("eb:prefs", { preview: false });
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);

  const toggleCollapsed = useCallback(() => setCollapsed((c: boolean) => !c), [setCollapsed]);
  const setPref = useCallback(
    <K extends keyof Prefs>(key: K, value: Prefs[K]) => setPrefs((p: Prefs) => ({ ...p, [key]: value })),
    [setPrefs]
  );

  const value = useMemo<UiValue>(
    () => ({
      collapsed,
      toggleCollapsed,
      mobileNav,
      setMobileNav,
      mobileSearch,
      setMobileSearch,
      prefs,
      setPref,
    }),
    [collapsed, toggleCollapsed, mobileNav, setMobileNav, mobileSearch, setMobileSearch, prefs, setPref]
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiValue {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used within UiProvider");
  return ctx;
}
