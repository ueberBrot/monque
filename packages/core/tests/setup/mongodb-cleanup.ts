import { afterAll } from 'vitest';

import { closeMongoDb } from './mongodb.js';

afterAll(closeMongoDb);
