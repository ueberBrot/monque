import type { JobDto } from '@monque/management/contract';

import { DateTimePicker } from '@/components/date-time-picker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '@/lib/dates';

import {
	getStatusLabel,
	JOB_STATUS_ORDER,
	type JobsRouteSearch,
	MAX_LIMIT,
} from './job-list-search.js';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const JOB_DATE_FILTERS = [
	{ field: 'createdAtFrom', id: 'jobs-created-from-filter', label: 'Created from' },
	{ field: 'createdAtTo', id: 'jobs-created-to-filter', label: 'Created to' },
	{ field: 'updatedAtFrom', id: 'jobs-updated-from-filter', label: 'Updated from' },
	{ field: 'updatedAtTo', id: 'jobs-updated-to-filter', label: 'Updated to' },
	{ field: 'nextRunAtFrom', id: 'jobs-next-run-from-filter', label: 'Next run from' },
	{ field: 'nextRunAtTo', id: 'jobs-next-run-to-filter', label: 'Next run to' },
] as const satisfies readonly {
	readonly field: JobDateFilterField;
	readonly id: string;
	readonly label: string;
}[];
type JobDateFilterField = keyof Pick<
	JobsRouteSearch,
	| 'createdAtFrom'
	| 'createdAtTo'
	| 'updatedAtFrom'
	| 'updatedAtTo'
	| 'nextRunAtFrom'
	| 'nextRunAtTo'
>;

function JobsFilters({
	search,
	updateSearch,
}: {
	readonly search: JobsRouteSearch;
	readonly updateSearch: (updater: (search: JobsRouteSearch) => JobsRouteSearch) => void;
}) {
	function handleStatusToggle(status: JobDto['status']): void {
		updateSearch((currentSearch) => ({
			...currentSearch,
			status: getNextStatusFilter(currentSearch.status, status),
			cursor: undefined,
		}));
	}

	function handleDateRangeChange(field: JobDateFilterField, value: string): void {
		updateSearch((currentSearch) => ({
			...currentSearch,
			[field]: fromDateTimeLocalValue(value),
			cursor: undefined,
		}));
	}

	function handleLimitChange(value: string): void {
		const parsed = Number.parseInt(value, 10);

		if (!Number.isInteger(parsed) || parsed <= 0) {
			return;
		}

		updateSearch((currentSearch) => ({
			...currentSearch,
			limit: Math.min(parsed, MAX_LIMIT),
			cursor: undefined,
		}));
	}

	return (
		<div className="grid min-w-0 gap-4 border-b border-border p-4">
			<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem] items-start gap-4 sm:grid-cols-[minmax(10rem,24rem)_8rem_auto]">
				<Field>
					<FieldLabel htmlFor="jobs-name-filter">Job name</FieldLabel>
					<Input
						id="jobs-name-filter"
						value={search.name ?? ''}
						onChange={(event) => {
							const name = event.target.value;
							updateSearch((current) => ({ ...current, name, cursor: undefined }));
						}}
						placeholder="send-email"
					/>
				</Field>
				<Field>
					<FieldLabel htmlFor="jobs-limit-filter">Page size</FieldLabel>
					<Select
						value={String(search.limit)}
						onValueChange={(value) => {
							if (value !== null) {
								handleLimitChange(value);
							}
						}}
					>
						<SelectTrigger id="jobs-limit-filter">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PAGE_SIZE_OPTIONS.map((limit) => (
								<SelectItem key={limit} value={String(limit)}>
									{limit} rows
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
				<Collapsible className="col-span-2 min-w-0 sm:col-span-3">
					<CollapsibleTrigger
						render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}
					>
						Date filters
						{JOB_DATE_FILTERS.some((filter) => search[filter.field]) ? ' · Active' : ''}
					</CollapsibleTrigger>
					<CollapsibleContent>
						<div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
							{JOB_DATE_FILTERS.map((filter) => (
								<JobsDateField
									key={filter.field}
									id={filter.id}
									label={filter.label}
									value={search[filter.field]}
									onChange={(value) => handleDateRangeChange(filter.field, value)}
								/>
							))}
						</div>
					</CollapsibleContent>
				</Collapsible>
			</div>
			<div className="flex min-w-0 flex-wrap items-center gap-3">
				<span className="text-xs font-medium text-muted-foreground">Status</span>
				<div className="flex flex-wrap gap-3">
					{JOB_STATUS_ORDER.map((status) => (
						<div key={status} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
							<Checkbox
								aria-label={getStatusLabel(status)}
								checked={search.status.includes(status)}
								onCheckedChange={() => handleStatusToggle(status)}
							/>
							<span>{getStatusLabel(status)}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
function JobsDateField({
	id,
	label,
	value,
	onChange,
}: {
	readonly id: string;
	readonly label: string;
	readonly onChange: (value: string) => void;
	readonly value: string | undefined;
}) {
	return (
		<Field>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<DateTimePicker
				id={id}
				label={label}
				value={toDateTimeLocalValue(value)}
				onChange={onChange}
			/>
		</Field>
	);
}

function getNextStatusFilter(
	currentStatus: readonly JobDto['status'][],
	status: JobDto['status'],
): readonly JobDto['status'][] {
	if (currentStatus.includes(status)) {
		return currentStatus.filter((candidate) => candidate !== status);
	}

	return [...currentStatus, status].sort(compareJobStatus);
}

function compareJobStatus(left: JobDto['status'], right: JobDto['status']): number {
	return JOB_STATUS_ORDER.indexOf(left) - JOB_STATUS_ORDER.indexOf(right);
}

export { JobsFilters };
