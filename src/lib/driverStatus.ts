import { useEffect, useState } from "react";

// Lightweight module-level store for the driver's online/offline status.
// There's no backend column for this yet (see NOTES.md if added), so this
// is intentionally client-only and resets on app restart — consistent with
// how "Go Online" behaved before, just now shared across screens instead of
// being local state trapped on a single screen.

type Listener = (online: boolean) => void;

let online = false;
const listeners = new Set<Listener>();

export function getDriverOnline(): boolean {
  return online;
}

export function setDriverOnline(value: boolean): void {
  if (value === online) return;
  online = value;
  listeners.forEach((l) => l(value));
}

export function toggleDriverOnline(): void {
  setDriverOnline(!online);
}

export function subscribeDriverOnline(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDriverOnline(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(online);
  useEffect(() => subscribeDriverOnline(setValue), []);
  return [value, setDriverOnline];
}