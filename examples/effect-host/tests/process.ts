import { spawn } from "node:child_process";
import { once } from "node:events";

/** Run the application with BunRuntime signal handling. */
export const launchHost = (env: Record<string, string>, entry = "src/main.ts") => {
  // oxlint-disable-next-line sonarjs/no-os-command-from-path -- Exercise the documented Bun executable.
  const child = spawn("bun", [entry], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      OPERATOR_PASSWORD: "operator-secret",
      VIEWER_PASSWORD: "viewer-secret",
      MANAGEMENT_PATH: "/custom/control",
      DASHBOARD_PATH: "/custom/ui",
      PORT: "0",
      READ_ONLY: "false",
      MONQUE_TRACING: "false",
      MONGO_DATABASE: "monque_effect_example_test",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const exited = once(child, "exit");
  const closed = once(child, "close");

  return {
    child,
    exited,
    output: () => output,
    stop: async (signal: NodeJS.Signals = "SIGTERM") => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }

      const escalation = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5000);

      try {
        await closed;
      } finally {
        clearTimeout(escalation);
      }
    },
  };
};
