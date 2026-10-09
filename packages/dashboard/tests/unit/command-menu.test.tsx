// @vitest-environment jsdom
import { HotkeyManager } from "@tanstack/react-hotkeys";
import type * as ReactQueryModule from "@tanstack/react-query";
import type * as ReactRouterModule from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { fromPartial } from "@total-typescript/shoehorn";
import { describe, afterEach, expect, it, vi } from "vite-plus/test";

import { CommandMenu } from "@/components/command-menu";

const invalidateQueries = vi.fn<() => Promise<void>>();
vi.mock(import("@tanstack/react-router"), () =>
  fromPartial<typeof ReactRouterModule>({ useNavigate: () => vi.fn<() => Promise<void>>() }),
);
vi.mock(import("@tanstack/react-query"), () =>
  fromPartial<typeof ReactQueryModule>({
    useQueryClient: () => ({ invalidateQueries }),
  }),
);
describe("command menu", () => {
  afterEach(() => {
    cleanup();
    HotkeyManager.resetInstance();
    vi.restoreAllMocks();
    invalidateQueries.mockClear();
  });

  it.each([
    { platform: "MacIntel", label: "⌘ K", refresh: "⇧ ⌘ R", metaKey: true, ctrlKey: false },
    { platform: "Win32", label: "Ctrl+K", refresh: "Ctrl+Shift+R", metaKey: false, ctrlKey: true },
    {
      platform: "Linux x86_64",
      label: "Ctrl+K",
      refresh: "Ctrl+Shift+R",
      metaKey: false,
      ctrlKey: true,
    },
  ])(
    "shows shortcuts that match the keyboard handler on $platform",
    async ({ platform, label, refresh, metaKey, ctrlKey }) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(platform);
      render(<CommandMenu />);
      expect(
        screen.getByRole("button", { name: /^Commands/u }).querySelector("kbd")?.textContent,
      ).toBe(label);
      fireEvent.keyDown(document, { key: "k", metaKey: !metaKey, ctrlKey: !ctrlKey });
      expect(screen.queryByRole("dialog", { name: "Commands" })).toBeNull();
      fireEvent.keyDown(document, { key: "k", metaKey, ctrlKey });
      const dialog = await screen.findByRole("dialog", { name: "Commands" });
      expect(dialog.textContent).toContain(`${refresh} refreshes`);
      fireEvent.click(screen.getByRole("button", { name: "Close commands" }));
      fireEvent.keyDown(document, { key: "R", shiftKey: true, metaKey, ctrlKey });
      expect(invalidateQueries).toHaveBeenCalledOnce();
    },
  );
});
