import { describe, expect, it } from "vitest";
import type { StorageLike } from "./office/model";
import { rememberedScreen, rememberScreen, SCREEN_KEY, SCREENS } from "./screen";

const memory = (init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
};
const throwing: StorageLike = {
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); },
};

describe("the remembered screen (Story 30.6)", () => {
  it("the key and the screens", () => {
    expect(SCREEN_KEY).toBe("tk-studio.web.screen");
    expect([...SCREENS]).toEqual(["office", "board", "status", "inbox", "issue", "chat"]);
  });

  it("status / bogus / absent / throwing → status / office / office / office", () => {
    expect(rememberedScreen(memory({ [SCREEN_KEY]: "status" }))).toBe("status");
    expect(rememberedScreen(memory({ [SCREEN_KEY]: "board" }))).toBe("board");
    expect(rememberedScreen(memory({ [SCREEN_KEY]: "inbox" }))).toBe("inbox");
    expect(rememberedScreen(memory({ [SCREEN_KEY]: "issue" }))).toBe("issue");
    expect(rememberedScreen(memory({ [SCREEN_KEY]: "chat" }))).toBe("chat");
    expect(rememberedScreen(memory({ [SCREEN_KEY]: "bogus" }))).toBe("office");
    expect(rememberedScreen(memory())).toBe("office");
    expect(rememberedScreen(throwing)).toBe("office");
    expect(rememberedScreen(null)).toBe("office");
  });

  it("rememberScreen stores it, read back; a throwing storage is swallowed", () => {
    const s = memory();
    rememberScreen("board", s);
    expect(s.data[SCREEN_KEY]).toBe("board");
    expect(rememberedScreen(s)).toBe("board");
    expect(() => rememberScreen("status", throwing)).not.toThrow();
    expect(() => rememberScreen("status", null)).not.toThrow();
  });
});
