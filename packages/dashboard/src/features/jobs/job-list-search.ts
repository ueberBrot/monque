import {
	type JobDto,
	type JobListQueryDto,
	JobListSortByDtoSchema,
	JobListSortDirectionDtoSchema,
	JobStatusDtoSchema,
} from '@monque/management/contract';

const JOB_STATUS_ORDER = ['pending', 'processing', 'completed', 'failed', 'cancelled'] as const;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type JobsRouteSearch = {
	readonly createdAtFrom: string | undefined;
	readonly createdAtTo: string | undefined;
	readonly cursor: string | undefined;
	readonly limit: number;
	readonly name: string | undefined;
	readonly nextRunAtFrom: string | undefined;
	readonly nextRunAtTo: string | undefined;
	readonly sortBy: JobListSortByDto;
	readonly sortDirection: JobListSortDirectionDto;
	readonly status: readonly JobStatusDto[];
	readonly updatedAtFrom: string | undefined;
	readonly updatedAtTo: string | undefined;
};

type JobListSortByDto = NonNullable<JobListQueryDto['sortBy']>;
type JobListSortDirectionDto = NonNullable<JobListQueryDto['sortDirection']>;
type JobStatusDto = JobDto['status'];

function parseJobsRouteSearch(search: Record<string, unknown>): JobsRouteSearch {
	return {
		cursor: getOptionalString(search['cursor']),
		limit: parseLimit(search['limit']),
		name: getOptionalString(search['name']),
		status: parseStatusFilter(search['status']),
		createdAtFrom: getOptionalIsoDate(search['createdAtFrom']),
		createdAtTo: getOptionalIsoDate(search['createdAtTo']),
		updatedAtFrom: getOptionalIsoDate(search['updatedAtFrom']),
		updatedAtTo: getOptionalIsoDate(search['updatedAtTo']),
		nextRunAtFrom: getOptionalIsoDate(search['nextRunAtFrom']),
		nextRunAtTo: getOptionalIsoDate(search['nextRunAtTo']),
		sortBy: parseSortBy(search['sortBy']),
		sortDirection: parseSortDirection(search['sortDirection']),
	};
}

function toJobListQueryInput(search: JobsRouteSearch): JobListQueryDto {
	return {
		cursor: search.cursor,
		limit: String(search.limit),
		name: search.name,
		status: toJobListStatusQuery(search.status),
		createdAtFrom: search.createdAtFrom,
		createdAtTo: search.createdAtTo,
		updatedAtFrom: search.updatedAtFrom,
		updatedAtTo: search.updatedAtTo,
		nextRunAtFrom: search.nextRunAtFrom,
		nextRunAtTo: search.nextRunAtTo,
		sortBy: search.sortBy,
		sortDirection: search.sortDirection,
	};
}

function getJobsSearchIdentity(search: JobsRouteSearch): string {
	return JSON.stringify({
		limit: search.limit,
		name: search.name,
		status: search.status,
		createdAtFrom: search.createdAtFrom,
		createdAtTo: search.createdAtTo,
		updatedAtFrom: search.updatedAtFrom,
		updatedAtTo: search.updatedAtTo,
		nextRunAtFrom: search.nextRunAtFrom,
		nextRunAtTo: search.nextRunAtTo,
		sortBy: search.sortBy,
		sortDirection: search.sortDirection,
	});
}

function toDateTimeLocalValue(value?: string): string {
	if (!value) {
		return '';
	}

	const parsed = new Date(value);

	if (Number.isNaN(parsed.getTime())) {
		return '';
	}

	const year = parsed.getFullYear();
	const month = toPaddedDatePart(parsed.getMonth() + 1);
	const day = toPaddedDatePart(parsed.getDate());
	const hour = toPaddedDatePart(parsed.getHours());
	const minute = toPaddedDatePart(parsed.getMinutes());

	return `${year}-${month}-${day}T${hour}:${minute}`;
}

function fromDateTimeLocalValue(value: string): string | undefined {
	if (!value) {
		return undefined;
	}

	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function getNextSort(
	currentSortBy: JobListSortByDto,
	currentSortDirection: JobListSortDirectionDto,
	nextSortBy: JobListSortByDto,
): Pick<JobsRouteSearch, 'sortBy' | 'sortDirection'> {
	if (currentSortBy !== nextSortBy) {
		return {
			sortBy: nextSortBy,
			sortDirection: nextSortBy === 'identifier' ? 'asc' : 'desc',
		};
	}

	return {
		sortBy: nextSortBy,
		sortDirection: currentSortDirection === 'asc' ? 'desc' : 'asc',
	};
}

function getStatusLabel(status: JobStatusDto): string {
	switch (status) {
		case 'pending':
			return 'Pending';
		case 'processing':
			return 'Processing';
		case 'completed':
			return 'Completed';
		case 'failed':
			return 'Failed';
		case 'cancelled':
			return 'Cancelled';
	}
}

function parseLimit(value: unknown): number {
	if (typeof value === 'number') {
		return normalizeLimit(value);
	}

	if (typeof value === 'string') {
		return normalizeLimit(Number.parseInt(value, 10));
	}

	return DEFAULT_LIMIT;
}

function parseStatusFilter(value: unknown): readonly JobStatusDto[] {
	const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
	const parsedStatuses = values
		.flatMap((candidate) => (typeof candidate === 'string' ? [candidate] : []))
		.filter(
			(candidate): candidate is JobStatusDto => JobStatusDtoSchema.safeParse(candidate).success,
		);

	return JOB_STATUS_ORDER.filter((status) => parsedStatuses.includes(status));
}

function parseSortBy(value: unknown): JobListSortByDto {
	const parsed = JobListSortByDtoSchema.safeParse(value);
	return parsed.success ? parsed.data : 'createdAt';
}

function parseSortDirection(value: unknown): JobListSortDirectionDto {
	const parsed = JobListSortDirectionDtoSchema.safeParse(value);
	return parsed.success ? parsed.data : 'desc';
}

function getOptionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getOptionalIsoDate(value: unknown): string | undefined {
	if (typeof value !== 'string' || value.length === 0) {
		return undefined;
	}

	return Number.isNaN(Date.parse(value)) ? undefined : value;
}

function normalizeLimit(value: number): number {
	if (!Number.isInteger(value) || value <= 0) {
		return DEFAULT_LIMIT;
	}

	return Math.min(value, MAX_LIMIT);
}

function toJobListStatusQuery(status: readonly JobStatusDto[]): JobListQueryDto['status'] {
	if (status.length === 0) {
		return undefined;
	}

	if (status.length === 1) {
		return status[0];
	}

	return [...status];
}

function toPaddedDatePart(value: number): string {
	return String(value).padStart(2, '0');
}

export {
	DEFAULT_LIMIT,
	fromDateTimeLocalValue,
	getJobsSearchIdentity,
	getNextSort,
	getStatusLabel,
	JOB_STATUS_ORDER,
	type JobListSortByDto,
	type JobListSortDirectionDto,
	type JobStatusDto,
	type JobsRouteSearch,
	MAX_LIMIT,
	parseJobsRouteSearch,
	toDateTimeLocalValue,
	toJobListQueryInput,
};
