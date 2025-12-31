import { describe, expect, it } from 'vitest';

import { MONQUE_METADATA } from '@/constants/constants';
import { MonqueTypes } from '@/constants/MonqueTypes';

describe('MonqueTypes', () => {
	it('should have correct JOB token', () => {
		expect(MonqueTypes.JOB).toBe('monque:job');
	});
});

describe('Constants', () => {
	it('should have correct MONQUE_METADATA key', () => {
		expect(MONQUE_METADATA).toBe('monque:metadata');
	});
});
