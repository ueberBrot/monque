import { execFileSync, spawnSync } from "node:child_process";
import { MongoDBContainer } from "@testcontainers/mongodb";

/** Capture startup health failures before Testcontainers removes the container. */
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
        const [container] = args;
        try {
          const health = execFileSync(
            "docker",
            [
              "inspect",
              container.id,
              "--format",
              "image={{.Config.Image}} imageId={{.Image}} healthcheck={{json .Config.Healthcheck}} state={{json .State}}",
            ],
            { encoding: "utf-8", timeout: 5000, maxBuffer: 1_048_576 },
          );
          console.error(`[mongo-startup] ${health.trim()}`);
          const logs = spawnSync("docker", ["logs", "--tail", "30", container.id], {
            encoding: "utf-8",
            timeout: 5000,
            maxBuffer: 1_048_576,
            stdio: ["ignore", "pipe", "pipe"],
          });
          if (logs.error) {
            throw logs.error;
          }
          console.error(`[mongo-startup] container log tail:\n${logs.stdout}${logs.stderr}`);
        } catch (diagnosticError) {
          console.error("[mongo-startup] Could not capture startup diagnostics", diagnosticError);
        }
        throw error;
      }
    };
  }
}
