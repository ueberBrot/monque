import { afterAll } from 'vitest';

import { stopMongoContainer } from './bootstrap.js';

afterAll(stopMongoContainer);
