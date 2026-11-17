import { once } from "node:events";
import { Monque } from "@monque/core";
import { createDashboardExpressRouter } from "@monque/dashboard-express";
import { createManagementExpressRouter } from "@monque/management-express";
import express from "express";
import { MongoClient } from "mongodb";

const client = new MongoClient(
  process.env["MONGO_URI"] ?? "mongodb://127.0.0.1:27018/?directConnection=true",
);

await client.connect();

const monque = new Monque(client.db(process.env["MONGO_DATABASE"] ?? "monque_browser_express"));

await monque.initialize();

const app = express();

app.disable("x-powered-by");

app.use((req, res, next) => {
  const operatorCredential = Buffer.from(`operator:${process.env["OPERATOR_PASSWORD"]}`).toString(
    "base64",
  );

  const operator = `Basic ${operatorCredential}`;

  const viewerCredential = Buffer.from(`viewer:${process.env["VIEWER_PASSWORD"]}`).toString(
    "base64",
  );

  const viewer = `Basic ${viewerCredential}`;

  if (req.headers.authorization !== operator && req.headers.authorization !== viewer) {
    res.setHeader("www-authenticate", 'Basic realm="Monque", charset="UTF-8"');
    res.status(401).json({ error: "Authentication required" });

    return;
  }

  res.locals["role"] = req.headers.authorization === operator ? "operator" : "viewer";
  next();
});

app.use(
  "/control",
  createManagementExpressRouter({
    monque,
    readOnly: process.env["READ_ONLY"] === "true",
    context: ({ res }) => String(res.locals["role"]),
    authorize: ({ action, context }) => {
      if (process.env["AUTHORIZATION_FAILURE"] === "true") {
        throw new Error("private policy failure");
      }

      return (
        action === "read" ||
        (context === "operator" && action !== "delete" && action !== "deleteBulk")
      );
    },
  }),
);

app.use("/ui", createDashboardExpressRouter({ apiBaseUrl: "/control", pollingIntervalMs: 1000 }));

const server = app.listen(Number(process.env["PORT"] ?? 0), "127.0.0.1");

await once(server, "listening");

const address = server.address();

// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Node returns a TCP address or a pipe name; this host requires TCP.
if (address === null || typeof address === "string") {
  throw new Error("Missing listener");
}

console.log(`Dashboard: http://127.0.0.1:${address.port}/ui; Job: none`);

let closing: Promise<void> | undefined;

const stop = async () => {
  closing ??= release();
  await closing;
};

const release = async () => {
  server.closeAllConnections();
  const closed: PromiseWithResolvers<void> = Promise.withResolvers();
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Node listener closure is callback-based.
  server.close((error) => {
    if (error) {
      closed.reject(error);
    } else {
      closed.resolve();
    }
  });

  try {
    await closed.promise;
  } finally {
    try {
      await monque.dispose();
    } finally {
      await client.close();
    }
  }
};

process.once("SIGTERM", () => {
  void stop();
});

process.once("SIGINT", () => {
  void stop();
});
