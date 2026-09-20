import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAppForm } from '@/forms/form';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '@/lib/dates';
import { useMediaQuery } from '@/lib/use-media-query';

import { getStatusLabel, JOB_STATUS_ORDER, type JobsRouteSearch } from './job-list-search.js';

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
	const compact = useMediaQuery('(max-width: 767px)');
	const form = useAppForm({ defaultValues: getFilterValues(search) });
	// Router history remains authoritative when filters change outside this form.
	useEffect(() => {
		form.reset(getFilterValues(search));
	}, [form, search]);

	return (
		<form.AppForm>
			<div className="grid min-w-0 gap-4 border-b border-border p-4">
				<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem] items-start gap-4 sm:grid-cols-[minmax(10rem,24rem)_8rem_auto]">
					<form.AppField
						name="name"
						listeners={{
							onChange: ({ value }) =>
								updateSearch((current) => ({ ...current, name: value, cursor: undefined })),
						}}
					>
						{(field) => (
							<field.TextField id="jobs-name-filter" label="Job name" placeholder="send-email" />
						)}
					</form.AppField>
					<form.AppField
						name="limit"
						listeners={{
							onChange: ({ value }) =>
								updateSearch((current) => ({
									...current,
									limit: Number(value),
									cursor: undefined,
								})),
						}}
					>
						{(field) => (
							<field.SelectField
								id="jobs-limit-filter"
								label="Page size"
								options={PAGE_SIZE_OPTIONS.map((limit) => ({
									value: String(limit),
									label: `${limit} rows`,
								}))}
							/>
						)}
					</form.AppField>
					{compact ? (
						<div className="col-span-2 grid grid-cols-2 gap-3">
							<form.AppField
								name="sortBy"
								listeners={{
									onChange: ({ value }) =>
										updateSearch((current) => ({ ...current, sortBy: value, cursor: undefined })),
								}}
							>
								{(field) => (
									<field.SelectField
										label="Sort by"
										displayLabel={
											{
												createdAt: 'Created time',
												updatedAt: 'Updated time',
												nextRunAt: 'Next run',
												identifier: 'Identifier',
											}[field.state.value]
										}
										options={[
											{ value: 'createdAt', label: 'Created time' },
											{ value: 'updatedAt', label: 'Updated time' },
											{ value: 'nextRunAt', label: 'Next run' },
											{ value: 'identifier', label: 'Identifier' },
										]}
									/>
								)}
							</form.AppField>
							<form.AppField
								name="sortDirection"
								listeners={{
									onChange: ({ value }) =>
										updateSearch((current) => ({
											...current,
											sortDirection: value,
											cursor: undefined,
										})),
								}}
							>
								{(field) => (
									<field.SelectField
										label="Sort direction"
										displayLabel={field.state.value === 'asc' ? 'Ascending' : 'Descending'}
										options={[
											{ value: 'asc', label: 'Ascending' },
											{ value: 'desc', label: 'Descending' },
										]}
									/>
								)}
							</form.AppField>
						</div>
					) : null}
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
									<form.AppField
										key={filter.field}
										name={filter.field}
										listeners={{
											onChange: ({ value }) =>
												updateSearch((current) => ({
													...current,
													[filter.field]: fromDateTimeLocalValue(value),
													cursor: undefined,
												})),
										}}
									>
										{(field) => <field.DateTimeField id={filter.id} label={filter.label} />}
									</form.AppField>
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
								<form.AppField
									name={status}
									listeners={{
										onChange: ({ value }) =>
											updateSearch((current) => ({
												...current,
												status: JOB_STATUS_ORDER.filter((candidate) =>
													candidate === status ? value : current.status.includes(candidate),
												),
												cursor: undefined,
											})),
									}}
								>
									{(field) => <field.CheckboxField label={getStatusLabel(status)} bare />}
								</form.AppField>
								<span>{getStatusLabel(status)}</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</form.AppForm>
	);
}

function getFilterValues(search: JobsRouteSearch) {
	return {
		name: search.name ?? '',
		limit: String(search.limit),
		sortBy: search.sortBy,
		sortDirection: search.sortDirection,
		createdAtFrom: toDateTimeLocalValue(search.createdAtFrom),
		createdAtTo: toDateTimeLocalValue(search.createdAtTo),
		updatedAtFrom: toDateTimeLocalValue(search.updatedAtFrom),
		updatedAtTo: toDateTimeLocalValue(search.updatedAtTo),
		nextRunAtFrom: toDateTimeLocalValue(search.nextRunAtFrom),
		nextRunAtTo: toDateTimeLocalValue(search.nextRunAtTo),
		pending: search.status.includes('pending'),
		processing: search.status.includes('processing'),
		completed: search.status.includes('completed'),
		failed: search.status.includes('failed'),
		cancelled: search.status.includes('cancelled'),
	};
}

export { JobsFilters };
