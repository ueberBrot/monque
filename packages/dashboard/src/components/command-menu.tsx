import { formatForDisplay, useHotkey } from "@tanstack/react-hotkeys";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { parseJobsRouteSearch } from "@/features/jobs/job-list-search";
import { copyToClipboard } from "@/lib/clipboard";

const CommandSearch = lazy(async () => {
  const module = await import("./command-search.js");
  return { default: module.CommandSearch };
});
const COMMAND_HOTKEY = "Mod+K";
const REFRESH_HOTKEY = "Mod+Shift+R";
const CommandMenu = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries();
  };
  useHotkey(COMMAND_HOTKEY, () => {
    setOpen((current) => !current);
  });
  useHotkey(REFRESH_HOTKEY, refresh);
  useHotkey({ key: "/", shift: true }, () => {
    setOpen(true);
  });
  const commands = [
    {
      label: "Go to Queue Views",
      run: () => {
        void navigate({ to: "/queue-views" });
      },
    },
    {
      label: "Go to Jobs",
      run: () => {
        void navigate({ to: "/jobs", search: parseJobsRouteSearch({}) });
      },
    },
    {
      label: "Go to Health",
      run: () => {
        void navigate({ to: "/health" });
      },
    },
    { label: "Refresh current view", run: refresh },
    {
      label: "Clear filters",
      run: () => {
        void navigate({ to: "/jobs", search: parseJobsRouteSearch({}), replace: true });
      },
    },
    { label: "Toggle theme", run: () => window.dispatchEvent(new Event("monque:toggle-theme")) },
    {
      label: "Copy page URL",
      run: () => {
        void copyToClipboard(window.location.href, "Page URL copied");
      },
    },
  ];
  return (
    <div className="mb-5 flex min-h-8 items-center justify-end gap-3">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <Search className="size-4" />
              Commands{" "}
              <kbd
                className="ml-2 hidden rounded border border-border px-1 text-xs sm:inline"
                aria-label={formatForDisplay(COMMAND_HOTKEY, { useSymbols: false })}
              >
                {formatForDisplay(COMMAND_HOTKEY)}
              </kbd>
            </Button>
          }
        />
        <DialogContent>
          <DialogTitle>Commands</DialogTitle>
          <DialogDescription>
            Navigate or update your view. {formatForDisplay(REFRESH_HOTKEY)} refreshes; ? opens this
            menu.
          </DialogDescription>
          {open ? (
            <Suspense fallback={<output>Loading commands…</output>}>
              <CommandSearch
                commands={commands}
                onClose={() => {
                  setOpen(false);
                }}
              />
            </Suspense>
          ) : null}
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
            }}
          >
            Close commands
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};
export { CommandMenu };
