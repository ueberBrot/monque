import { describe, expect, it } from 'vitest';

import { InvalidJobIdentifierError, validateJobName, validateUniqueKey } from '@/shared';

describe('job identifier validation', () => {
	describe('validateJobName', () => {
		it('accepts supported job names', () => {
			expect(() => validateJobName('email:send.v2_worker-1')).not.toThrow();
		});

		it('accepts printable symbols used by existing schedule names', () => {
			expect(() => validateJobName('job-*/15-*-*-*-*')).not.toThrow();
		});

		it('rejects empty job names', () => {
			expect(() => validateJobName('')).toThrow(InvalidJobIdentifierError);
		});

		it('rejects names with whitespace', () => {
			expect(() => validateJobName('email send')).toThrow(InvalidJobIdentifierError);
		});

		it('rejects names with control characters', () => {
			expect(() => validateJobName('email\nsend')).toThrow(InvalidJobIdentifierError);
		});

		it('rejects names longer than 255 characters', () => {
			expect(() => validateJobName(`a${'b'.repeat(255)}`)).toThrow(InvalidJobIdentifierError);
		});
	});

	describe('validateUniqueKey', () => {
		it('accepts printable unique keys', () => {
			expect(() => validateUniqueKey('tenant-42:user:abc 123')).not.toThrow();
		});

		it('rejects empty unique keys', () => {
			expect(() => validateUniqueKey('')).toThrow(InvalidJobIdentifierError);
		});

		it('rejects whitespace-only unique keys', () => {
			expect(() => validateUniqueKey('   ')).toThrow(InvalidJobIdentifierError);
		});

		it('rejects control characters', () => {
			expect(() => validateUniqueKey('tenant\n42')).toThrow(InvalidJobIdentifierError);
		});

		it('rejects keys longer than 1024 characters', () => {
			expect(() => validateUniqueKey('a'.repeat(1025))).toThrow(InvalidJobIdentifierError);
		});
	});
});
