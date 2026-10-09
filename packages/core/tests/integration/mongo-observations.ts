import { z } from "zod";

import { requireValue } from "./helpers";

const bsonDocument = z.record(z.string(), z.unknown());
const commandSchema = z.object({
  find: z.string().optional(),
  findAndModify: z.string().optional(),
  aggregate: z.string().optional(),
  pipeline: z.array(bsonDocument).optional(),
  query: bsonDocument.optional(),
  // The driver normalizes sort specifications to BSON Maps before monitoring.
  sort: z
    .union([
      bsonDocument,
      z.map(z.string(), z.unknown()).transform((entries) => Object.fromEntries(entries)),
    ])
    .optional(),
  update: z.union([bsonDocument, z.array(bsonDocument)]).optional(),
  new: z.boolean().optional(),
});

/** Validate the observed command fields that scheduler integration tests inspect. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser validates MongoDB driver input at the observation boundary.
export const readCommand = (value: unknown) => commandSchema.parse(value);

const executionStatsSchema = z.object({
  totalKeysExamined: z.number(),
  totalDocsExamined: z.number(),
  executionStages: z.object({ nWouldModify: z.number().optional() }).optional(),
});
const explainSchema = z.object({
  queryPlanner: z.object({ winningPlan: z.unknown() }).optional(),
  executionStats: executionStatsSchema.optional(),
  stages: z
    .array(
      z.object({
        $cursor: z.object({ executionStats: executionStatsSchema }).optional(),
      }),
    )
    .optional(),
});

/** MongoDB puts aggregate statistics at the root or inside its cursor stage. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser validates MongoDB explain output before inspecting it.
export const readExplanation = (value: unknown) => {
  const result = explainSchema.parse(value);
  return {
    winningPlan: result.queryPlanner?.winningPlan,
    stats: requireValue(result.executionStats ?? result.stages?.[0]?.$cursor?.executionStats),
  };
};

const streamNotificationSchema = z.object({
  operationType: z.string().optional(),
  fullDocument: z
    .object({
      name: z.string().optional(),
      status: z.string().optional(),
      nextRunAt: z.date().optional(),
      data: z.unknown().optional(),
    })
    .optional(),
  updateDescription: z
    .object({
      updatedFields: z.object({ status: z.string().optional() }).optional(),
    })
    .optional(),
});
export type StreamNotification = z.infer<typeof streamNotificationSchema>;
const streamReplySchema = z.object({
  cursor: z
    .object({
      ns: z.string().optional(),
      firstBatch: z.array(streamNotificationSchema).optional(),
      nextBatch: z.array(streamNotificationSchema).optional(),
    })
    .optional(),
});
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser validates MongoDB change stream replies at the observation boundary.
export const readStreamReply = (value: unknown) => streamReplySchema.parse(value);
