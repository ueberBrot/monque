import { afterAll } from "vite-plus/test";

import { closeMongoDb } from "./mongodb.js";

afterAll(closeMongoDb);
