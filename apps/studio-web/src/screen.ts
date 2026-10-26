// The remembered screen (Story 30.6): the last screen shown, per browser, under `tk-studio.web.screen`.
// Modelled on `rememberedProject`/`rememberProject` (`office/model.ts`): the storage is injectable, a storage that
// throws counts as nothing stored, and a write that throws is ignored. Absent or unknown: the Office screen.
import type { StorageLike } from "./office/model";

export const SCREEN_KEY = "tk-studio.web.screen";
// Story 31.6: the Inbox and the Issue screens join the switch. Story 32.7: the Chat screen joins it.
export const SCREENS = ["office", "board", "status", "inbox", "issue", "chat"] as const;
export type Screen = (typeof SCREENS)[number];
export const DEFAULT_SCREEN: Screen = "office";

const defaultStorage = (): StorageLike | null => {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
};

const isScreen = (v: unknown): v is Screen => typeof v === "string" && (SCREENS as readonly string[]).includes(v);

/** The stored screen when it is one of `SCREENS`, else `office`. */
export function rememberedScreen(storage: StorageLike | null = defaultStorage()): Screen {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(SCREEN_KEY) ?? null;
  } catch {
    stored = null;
  }
  return isScreen(stored) ? stored : DEFAULT_SCREEN;
}

/** Stores the screen; a storage that throws is ignored (the screen stays in memory only). */
export function rememberScreen(screen: Screen, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(SCREEN_KEY, screen);
  } catch {
    /* in memory only */
  }
}
