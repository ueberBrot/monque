import { spawnSync } from "node:child_process";
import { MongoDBContainer } from "@testcontainers/mongodb";

const captureStartupDiagnostics = (containerId: string): void => {
  const probes = [
    {
      name: "runtime",
      args: [
        "info",
        "--format",
        "kernel={{.KernelVersion}} server={{.ServerVersion}} architecture={{.Architecture}} os={{.OperatingSystem}}",
      ],
    },
    {
      name: "container",
      args: [
        "inspect",
        containerId,
        "--format",
        "id={{.Id}} image={{.Config.Image}} imageId={{.Image}} healthcheck={{json .Config.Healthcheck}} state={{json .State}}",
      ],
    },
    { name: "container log tail", args: ["logs", "--tail", "50", containerId] },
  ];
  for (const probe of probes) {
    try {
      const result = spawnSync("docker", probe.args, {
        encoding: "utf-8",
        timeout: 5000,
        maxBuffer: 1_048_576,
        stdio: ["ignore", "pipe", "pipe"],
      });
      console.error(
        `[DEBUG-mongo-startup] ${probe.name} (exit=${result.status}):\n${result.stdout}${result.stderr}`,
      );
      if (result.error) {
        console.error(`[DEBUG-mongo-startup] Could not capture ${probe.name}`, result.error);
      }
    } catch (error) {
      console.error(`[DEBUG-mongo-startup] Could not capture ${probe.name}`, error);
    }
  }
};

/** Temporary probe: capture failures before Testcontainers stops and removes this container. */
export class DiagnosticMongoDBContainer extends MongoDBContainer {
  constructor(image: string) {
    super(image);
    const strategy = this.waitStrategy;
    if (!strategy) {
      throw new Error("MongoDBContainer must configure a startup wait strategy");
    }
    const waitUntilReady = strategy.waitUntilReady.bind(strategy);
    strategy.waitUntilReady = async (...args) => {
      try {
        await waitUntilReady(...args);
      } catch (error) {
        captureStartupDiagnostics(args[0].id);
        throw error;
      }
    };
  }
}
