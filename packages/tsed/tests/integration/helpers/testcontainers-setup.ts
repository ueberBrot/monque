import { afterAll } from 'vitest';

import { stopMongoContainer } from './mongo-container.js';

afterAll(stopMongoContainer);
