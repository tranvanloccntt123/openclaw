"use client";

/**
 * React hook for managing UI settings with localStorage persistence.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { loadSettings, saveSettings, type UiSettings } from "./storage";

export type UseSettingsResult = {
  settings: UiSettings;
  updateSettings: (updates: Partial<UiSettings>) => void;
  isLoaded: boolean;
};

// Storage for settings with change notification
let currentSettings: UiSettings | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): UiSettings | null {
  if (currentSettings === null && typeof window !== "undefined") {
    currentSettings = loadSettings();
  }
  return currentSettings;
}

function getServerSnapshot(): UiSettings | null {
  return null;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyListeners() {
  listeners.forEach((cb) => cb());
}

/**
 * Hook to manage UI settings with localStorage persistence.
 * Returns isLoaded=false until settings are loaded from localStorage (SSR-safe).
 */
export function useSettings(): UseSettingsResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isLoaded = snapshot !== null;

  const defaultSettings: UiSettings = useMemo(
    () => ({
      gatewayUrl: "",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    }),
    [],
  );

  const settings: UiSettings = snapshot ?? defaultSettings;

  const updateSettings = useCallback(
    (updates: Partial<UiSettings>) => {
      const current = currentSettings ?? defaultSettings;
      const next = { ...current, ...updates };
      saveSettings(next);
      currentSettings = next;
      notifyListeners();
    },
    [defaultSettings],
  );

  return { settings, updateSettings, isLoaded };
}
