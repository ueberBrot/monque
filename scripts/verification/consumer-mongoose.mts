// Copied beside consumer-app.mts; imports must resolve from the packed install.
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import nodePath from "node:path";
import { MonqueModule, MonqueService } from "@monque/tsed";
import { Configuration, injectable } from "@tsed/di";
import { MongooseModule, MongooseService } from "@tsed/mongoose";
import { PlatformTest } from "@tsed/platform-http/testing";
import { BSON } from "mongodb";
import mongoose from "mongoose";

const isVersionedPackage = (value: unknown): value is { version: string } =>
  typeof value === "object" &&
  value !== null &&
  "version" in value &&
  typeof value.version === "string";

export const verifyMongoose = async (uri: string, databaseName: string) => {
  const require = createRequire(import.meta.url);
  const tsedRequire = createRequire(require.resolve("@tsed/mongoose"));
  assert.equal(
    await realpath(tsedRequire.resolve("mongoose")),
    await realpath(require.resolve("mongoose")),
    "The probe must use the same Mongoose installation as Ts.ED's MongooseService",
  );
  const mongooseRequire = createRequire(tsedRequire.resolve("mongoose"));
  const driverRequire = createRequire(mongooseRequire.resolve("mongodb"));
  const driverManifest: unknown = mongooseRequire("mongodb/package.json");
  const bsonManifest: unknown = JSON.parse(
    await readFile(
      nodePath.resolve(nodePath.dirname(driverRequire.resolve("bson")), "../package.json"),
      "utf-8",
    ),
  );
  assert.ok(isVersionedPackage(driverManifest));
  assert.ok(isVersionedPackage(bsonManifest));

  // A string alias exercises the public dbToken contract without asserting that
  // MongooseService is a native Db in the type system.
  injectable(MongooseService).alias("CONSUMER_MONGOOSE");
  // oxlint-disable-next-line typescript/no-extraneous-class -- Ts.ED server DI token.
  class MongooseConsumerServer {}
  Configuration({ port: 0, disableComponentScan: true, httpsPort: false })(MongooseConsumerServer);
  try {
    await PlatformTest.bootstrap(MongooseConsumerServer, {
      imports: [MongooseModule, MonqueModule],
      mongoose: [
        {
          id: "jobs",
          url: uri,
          connectionOptions: { dbName: databaseName, directConnection: true },
        },
      ],
      monque: {
        dbToken: "CONSUMER_MONGOOSE",
        mongooseConnectionId: "jobs",
        disableJobProcessing: true,
      },
    })();
    const service = PlatformTest.get<MonqueService>(MonqueService);
    const connections = PlatformTest.get<MongooseService>(MongooseService);
    const connection = connections.get("jobs");
    assert.ok(connection?.db !== undefined, "Ts.ED did not open the named Mongoose connection");
    assert.equal(connection.db.databaseName, databaseName);
    const model = connection.model(
      "VerificationJob",
      new mongoose.Schema(
        {
          name: String,
          priority: Number,
          data: {
            monqueId: mongoose.Schema.Types.ObjectId,
            mongooseId: mongoose.Schema.Types.ObjectId,
          },
        },
        { strict: false, autoCreate: false, autoIndex: false, versionKey: false },
      ),
      "monque_jobs",
    );
    const monqueId = new BSON.ObjectId();
    const mongooseId = new mongoose.Types.ObjectId();
    const job = await service.now("mongoose-consumer", { monqueId, mongooseId }, { priority: 12 });
    const read = await model.findById(job._id).lean().exec();
    assert.ok(read !== null);
    assert.equal(read.data?.monqueId?.toHexString(), monqueId.toHexString());
    assert.equal(read.data?.mongooseId?.toHexString(), mongooseId.toHexString());
    assert.equal(read.priority, 12);

    // Monque constructs its own ObjectId when changing priority by string. Its
    // BSON value must serialize through the driver's Mongoose connection.
    await service.setJobPriority(job._id.toHexString(), -2);
    const updated = await model
      .findById(new mongoose.Types.ObjectId(job._id.toHexString()))
      .lean()
      .exec();
    assert.equal(updated?.priority, -2);

    // Exercise the reverse direction: a Job inserted and updated through a
    // Mongoose model is read by Monque using both Mongoose and native ObjectIds.
    const inserted = await model.create({
      ...job,
      _id: new mongoose.Types.ObjectId(),
      name: "mongoose-insert",
    });
    const found = await service.getJob<{ monqueId: BSON.ObjectId; mongooseId: BSON.ObjectId }>(
      inserted._id,
    );
    assert.equal(found?.name, "mongoose-insert");
    assert.equal(found?.data.monqueId.toHexString(), monqueId.toHexString());
    assert.equal(found?.data.mongooseId.toHexString(), mongooseId.toHexString());
    await model.updateOne({ _id: inserted._id }, { $set: { priority: 4 } }).exec();
    const reread = await service.getJob(new BSON.ObjectId(inserted._id.toHexString()));
    assert.equal(reread?.priority, 4);
    assert.equal(service.isHealthy(), false);
    return `Mongoose ${mongoose.version} → MongoDB ${driverManifest.version} / BSON ${bsonManifest.version}: named Ts.ED connection, Job insert/read/update and ObjectIds in both directions`;
  } finally {
    await PlatformTest.reset();
  }
};
