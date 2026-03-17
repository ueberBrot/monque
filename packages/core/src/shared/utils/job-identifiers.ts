import { InvalidJobIdentifierError } from '../errors.js';

const JOB_NAME_PATTERN = /^[^\s\p{Cc}]+$/u;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

const MAX_JOB_NAME_LENGTH = 255;
const MAX_UNIQUE_KEY_LENGTH = 1024;

/**
 * Validate a public job name before it is registered or scheduled.
 *
 * @param name - The job name to validate
 * @throws {InvalidJobIdentifierError} If the job name is empty, too long, or contains unsupported characters
 */
export function validateJobName(name: string): void {
	if (name.length === 0 || name.trim().length === 0) {
		throw new InvalidJobIdentifierError(
			'name',
			name,
			'Job name cannot be empty or whitespace only.',
		);
	}

	if (name.length > MAX_JOB_NAME_LENGTH) {
		throw new InvalidJobIdentifierError(
			'name',
			name,
			`Job name cannot exceed ${MAX_JOB_NAME_LENGTH} characters.`,
		);
	}

	if (!JOB_NAME_PATTERN.test(name)) {
		throw new InvalidJobIdentifierError(
			'name',
			name,
			'Job name cannot contain whitespace or control characters.',
		);
	}
}

/**
 * Validate a deduplication key before it is stored or used in a unique query.
 *
 * @param uniqueKey - The unique key to validate
 * @throws {InvalidJobIdentifierError} If the key is empty, too long, or contains control characters
 */
export function validateUniqueKey(uniqueKey: string): void {
	if (uniqueKey.length === 0 || uniqueKey.trim().length === 0) {
		throw new InvalidJobIdentifierError(
			'uniqueKey',
			uniqueKey,
			'Unique key cannot be empty or whitespace only.',
		);
	}

	if (uniqueKey.length > MAX_UNIQUE_KEY_LENGTH) {
		throw new InvalidJobIdentifierError(
			'uniqueKey',
			uniqueKey,
			`Unique key cannot exceed ${MAX_UNIQUE_KEY_LENGTH} characters.`,
		);
	}

	if (CONTROL_CHARACTER_PATTERN.test(uniqueKey)) {
		throw new InvalidJobIdentifierError(
			'uniqueKey',
			uniqueKey,
			'Unique key cannot contain control characters.',
		);
	}
}
