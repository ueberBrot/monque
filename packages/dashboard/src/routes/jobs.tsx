import type { JobDto } from '@monque/management/contract';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	type RowSelectionState,
	type SortingState,
	useReactTable,
} from '@tanstack/react-table';
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
	Select,
	SelectItem,
	SelectPopup,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import {
	fromDateTimeLocalValue,
	getJobsSearchIdentity,
	getNextSort,
	getStatusLabel,
	JOB_STATUS_ORDER,
	type JobListSortByDto,
	type JobsRouteSearch,
	MAX_LIMIT,
	parseJobsRouteSearch,
	toDateTimeLocalValue,
	toJobListQueryInput,
} from '@/features/jobs/job-list-search';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/jobs')({
	validateSearch: parseJobsRouteSearch,
	component: JobsRoute,
});

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
const SORTABLE_DATE_COLUMNS = [
	{ accessorKey: 'createdAt', label: 'Created time' },
	{ accessorKey: 'updatedAt', label: 'Updated time' },
	{ accessorKey: 'nextRunAt', label: 'Next run' },
] as const satisfies readonly {
	readonly accessorKey: Extract<JobListSortByDto, 'createdAt' | 'updatedAt' | 'nextRunAt'>;
	readonly label: string;
}[];
const JOB_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	year: 'numeric',
});

type JobDateFilterField = keyof Pick<
	JobsRouteSearch,
	| 'createdAtFrom'
	| 'createdAtTo'
	| 'updatedAtFrom'
	| 'updatedAtTo'
	| 'nextRunAtFrom'
	| 'nextRunAtTo'
>;
type JobsColumnsOptions = {
	readonly activeSortBy: JobListSortByDto;
	readonly direction: JobsRouteSearch['sortDirection'];
	readonly onSortChange: (sortBy: JobListSortByDto) => void;
};
type JobStatusBadgeVariant = 'danger' | 'outline' | 'success' | 'warning';
type JobsStateVariant = 'danger' | 'default' | 'warning';

function JobsRoute() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const { managementApi, runtimeConfig } = Route.useRouteContext();
	const [cursorHistory, setCursorHistory] = useState<readonly string[]>([]);
	const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
	const cursorResetIdentityRef = useRef(getJobsSearchIdentity(search));
	const jobsQueryOptions = managementApi.orpc.jobs.queryOptions({
		input: toJobListQueryInput(search),
		...(runtimeConfig.pollingIntervalMs
			? { refetchInterval: runtimeConfig.pollingIntervalMs }
			: {}),
	});
	const jobsQuery = useQuery(jobsQueryOptions);
	const jobsPage = jobsQuery.data;
	const jobs = jobsPage?.jobs ?? [];
	const sorting = useMemo<SortingState>(
		() => [
			{
				id: search.sortBy,
				desc: search.sortDirection === 'desc',
			},
		],
		[search.sortBy, search.sortDirection],
	);
	const columns = createJobsColumns({
		activeSortBy: search.sortBy,
		direction: search.sortDirection,
		onSortChange: handleSortChange,
	});
	const table = useReactTable({
		data: jobs,
		columns,
		getCoreRowModel: getCoreRowModel(),
		getRowId: (row) => row.id,
		enableRowSelection: true,
		manualFiltering: true,
		manualPagination: true,
		manualSorting: true,
		onRowSelectionChange: setRowSelection,
		state: {
			rowSelection,
			sorting,
		},
	});
	const selectedRowCount = table.getSelectedRowModel().rows.length;

	useEffect(() => {
		const nextCursorResetIdentity = getJobsSearchIdentity(search);

		if (cursorResetIdentityRef.current === nextCursorResetIdentity) {
			return;
		}

		cursorResetIdentityRef.current = nextCursorResetIdentity;
		setCursorHistory([]);
	}, [search]);

	useEffect(() => {
		setRowSelection((currentSelection) => getSelectionForVisibleJobs(currentSelection, jobs));
	}, [jobs]);

	function updateSearch(updater: (search: JobsRouteSearch) => JobsRouteSearch): void {
		void navigate({
			search: (currentSearch) => updater(currentSearch),
			replace: true,
		});
	}

	function handleSortChange(nextSortBy: JobListSortByDto): void {
		updateSearch((currentSearch) => ({
			...currentSearch,
			...getNextSort(currentSearch.sortBy, currentSearch.sortDirection, nextSortBy),
			cursor: undefined,
		}));
	}

	function handleNameChange(value: string): void {
		updateSearch((currentSearch) => ({
			...currentSearch,
			name: value.trim().length > 0 ? value : undefined,
			cursor: undefined,
		}));
	}

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

	function handleNextPage(): void {
		const nextCursor = jobsPage?.cursor;

		if (!nextCursor) {
			return;
		}

		setCursorHistory((currentHistory) => [...currentHistory, search.cursor ?? '']);
		void navigate({
			search: (currentSearch) => ({
				...currentSearch,
				cursor: nextCursor,
			}),
		});
	}

	function handlePreviousPage(): void {
		const previousCursor = cursorHistory[cursorHistory.length - 1];

		if (previousCursor === undefined) {
			return;
		}

		setCursorHistory((currentHistory) => currentHistory.slice(0, -1));
		void navigate({
			search: (currentSearch) => ({
				...currentSearch,
				cursor: previousCursor || undefined,
			}),
		});
	}

	function handleRefresh(): void {
		void jobsQuery.refetch();
	}

	if (jobsQuery.isPending) {
		return <JobsStatePanel description="Loading jobs from the Management API." title="Jobs" />;
	}

	if (jobsQuery.isError) {
		return <JobsErrorPanel error={jobsQuery.error} />;
	}

	return (
		<section className="grid gap-5">
			<div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
				<div className="grid gap-1">
					<h1 className="text-2xl font-semibold">Jobs</h1>
					<p className="max-w-[72ch] text-sm text-muted-foreground">
						Server-backed filters, sorting, and cursor pagination for global job inspection.
					</p>
				</div>
				<div className="flex items-center gap-2">
					{jobsQuery.isFetching ? (
						<span className="text-xs text-muted-foreground">Refreshing…</span>
					) : null}
					<Button type="button" variant="outline" onClick={handleRefresh}>
						<RefreshCw className={cn('size-4', jobsQuery.isFetching && 'animate-spin')} />
						Refresh
					</Button>
				</div>
			</div>

			<div className="rounded-xl border border-border bg-card">
				<div className="grid gap-4 border-b border-border p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
					<div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
						<Field>
							<FieldLabel htmlFor="jobs-name-filter">Job name</FieldLabel>
							<Input
								id="jobs-name-filter"
								value={search.name ?? ''}
								onChange={(event) => handleNameChange(event.target.value)}
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
								<SelectPopup>
									{PAGE_SIZE_OPTIONS.map((limit) => (
										<SelectItem key={limit} value={String(limit)}>
											{limit} rows
										</SelectItem>
									))}
								</SelectPopup>
							</Select>
						</Field>
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
					<div className="grid gap-2 rounded-lg border border-border bg-background/70 p-3">
						<span className="text-xs font-medium text-muted-foreground">Status</span>
						<div className="grid gap-2 sm:grid-cols-2">
							{JOB_STATUS_ORDER.map((status) => (
								<div key={status} className="flex items-center gap-2 text-sm">
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

				<div className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
					Sorting and filters are server-backed for the full result set. Row selection stays local
					to this screen.
				</div>

				{jobs.length === 0 ? (
					<JobsStatePanel
						description="No jobs matched the current cursor and filters. Clear the filters or refresh the view."
						title="No jobs found"
					/>
				) : (
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								{table.getHeaderGroups().map((headerGroup) => (
									<TableRow key={headerGroup.id}>
										{headerGroup.headers.map((header) => (
											<TableHead key={header.id}>
												{header.isPlaceholder
													? null
													: flexRender(header.column.columnDef.header, header.getContext())}
											</TableHead>
										))}
									</TableRow>
								))}
							</TableHeader>
							<TableBody>
								{table.getRowModel().rows.map((row) => (
									<TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined}>
										{row.getVisibleCells().map((cell) => (
											<TableCell key={cell.id}>
												{flexRender(cell.column.columnDef.cell, cell.getContext())}
											</TableCell>
										))}
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}

				<div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="text-xs text-muted-foreground">
						{selectedRowCount > 0
							? `${selectedRowCount} rows selected on this page`
							: 'No rows selected'}
					</div>
					<div className="flex items-center gap-2">
						<Button
							type="button"
							variant="outline"
							onClick={handlePreviousPage}
							disabled={cursorHistory.length === 0}
						>
							Previous page
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={handleNextPage}
							disabled={!jobsPage?.hasNextPage || !jobsPage.cursor}
						>
							Next page
						</Button>
					</div>
				</div>
			</div>
		</section>
	);
}

function createJobsColumns({
	activeSortBy,
	direction,
	onSortChange,
}: JobsColumnsOptions): ColumnDef<JobDto>[] {
	return [
		{
			id: 'select',
			enableSorting: false,
			header: () => <span className="sr-only">Select</span>,
			cell: ({ row }) => (
				<Checkbox
					aria-label="Select job row"
					checked={row.getIsSelected()}
					onCheckedChange={() => row.toggleSelected()}
				/>
			),
		},
		{
			accessorKey: 'name',
			header: 'Job name',
			cell: ({ row }) => (
				<div className="min-w-0">
					<div className="truncate font-medium">{row.original.name}</div>
					<div className="text-xs text-muted-foreground">{row.original.id}</div>
				</div>
			),
		},
		{
			accessorKey: 'status',
			header: 'Status',
			cell: ({ row }) => <JobStatusBadge status={row.original.status} />,
		},
		...SORTABLE_DATE_COLUMNS.map(
			(column): ColumnDef<JobDto> => ({
				accessorKey: column.accessorKey,
				header: () => (
					<JobsSortButton
						activeSortBy={activeSortBy}
						columnId={column.accessorKey}
						direction={direction}
						label={column.label}
						onSortChange={onSortChange}
					/>
				),
				cell: ({ row }) => (
					<span className="font-mono text-xs">
						{formatJobDate(row.original[column.accessorKey])}
					</span>
				),
			}),
		),
		{
			id: 'identifier',
			header: () => (
				<JobsSortButton
					activeSortBy={activeSortBy}
					columnId="identifier"
					direction={direction}
					label="Identifier"
					onSortChange={onSortChange}
				/>
			),
			cell: ({ row }) => <span className="font-mono text-xs">{row.original.id}</span>,
		},
	];
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
			<Input
				id={id}
				type="datetime-local"
				value={toDateTimeLocalValue(value)}
				onChange={(event) => onChange(event.target.value)}
			/>
		</Field>
	);
}

function JobsSortButton({
	activeSortBy,
	columnId,
	direction,
	label,
	onSortChange,
}: {
	readonly activeSortBy: JobListSortByDto;
	readonly columnId: JobListSortByDto;
	readonly direction: JobsRouteSearch['sortDirection'];
	readonly label: string;
	readonly onSortChange: (sortBy: JobListSortByDto) => void;
}) {
	const isActive = activeSortBy === columnId;
	const sortIcon = renderSortIcon(isActive, direction);

	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			className="h-auto px-0 text-left font-medium text-muted-foreground hover:bg-transparent hover:text-foreground"
			onClick={() => onSortChange(columnId)}
			aria-sort={getSortAriaValue(isActive, direction)}
		>
			<span>{label}</span>
			{sortIcon}
		</Button>
	);
}

function JobsErrorPanel({ error }: { readonly error: unknown }) {
	const status = getErrorStatus(error);
	const message = getErrorMessage(error);

	switch (status) {
		case 401:
			return (
				<JobsStatePanel
					title="Sign in required"
					description={message ?? 'Your session is missing or expired for the Management API.'}
					variant="warning"
				/>
			);
		case 403:
			return (
				<JobsStatePanel
					title="Access denied"
					description={
						message ?? 'Your account can reach the dashboard shell, but not the Jobs view.'
					}
					variant="warning"
				/>
			);
		default:
			return (
				<JobsStatePanel
					title="Jobs failed to load"
					description={message ?? 'Refresh the view or confirm the Management API is reachable.'}
					variant="danger"
				/>
			);
	}
}

function JobsStatePanel({
	description,
	title,
	variant = 'default',
}: {
	readonly description: string;
	readonly title: string;
	readonly variant?: JobsStateVariant;
}) {
	return (
		<section
			className={cn('grid gap-2 rounded-xl border p-6', getJobsStatePanelClassName(variant))}
		>
			<div className="flex items-start gap-3">
				<AlertCircle className="mt-0.5 size-4 shrink-0" />
				<div className="grid gap-1">
					<h1 className="text-lg font-semibold">{title}</h1>
					<p className={cn('text-sm', variant === 'default' && 'text-muted-foreground')}>
						{description}
					</p>
				</div>
			</div>
		</section>
	);
}

function JobStatusBadge({ status }: { readonly status: JobDto['status'] }) {
	return <Badge variant={getJobStatusBadgeVariant(status)}>{getStatusLabel(status)}</Badge>;
}

function formatJobDate(value: string): string {
	return JOB_DATE_FORMATTER.format(new Date(value));
}

function getErrorStatus(error: unknown): number | undefined {
	return isRecord(error) ? getOptionalNumber(error['status']) : undefined;
}

function getErrorMessage(error: unknown): string | undefined {
	const fallbackMessage = error instanceof Error ? error.message : undefined;

	if (!isRecord(error)) {
		return fallbackMessage;
	}

	const data = error['data'];

	if (!isRecord(data)) {
		return fallbackMessage;
	}

	const body = data['body'];

	if (!isRecord(body) || !('error' in body)) {
		return fallbackMessage;
	}

	return getOptionalString(body['error']);
}

function getOptionalNumber(value: unknown): number | undefined {
	return typeof value === 'number' ? value : undefined;
}

function getOptionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
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

function getSelectionForVisibleJobs(
	currentSelection: RowSelectionState,
	jobs: readonly JobDto[],
): RowSelectionState {
	const visibleJobIds = new Set(jobs.map((job) => job.id));

	return Object.fromEntries(
		Object.entries(currentSelection).filter(
			([rowId, selected]) => selected && visibleJobIds.has(rowId),
		),
	);
}

function renderSortIcon(isActive: boolean, direction: JobsRouteSearch['sortDirection']) {
	if (!isActive) {
		return <ArrowUpDown className="size-3.5" />;
	}

	if (direction === 'asc') {
		return <ArrowUp className="size-3.5" />;
	}

	return <ArrowDown className="size-3.5" />;
}

function getSortAriaValue(
	isActive: boolean,
	direction: JobsRouteSearch['sortDirection'],
): 'ascending' | 'descending' | 'none' {
	if (!isActive) {
		return 'none';
	}

	return direction === 'asc' ? 'ascending' : 'descending';
}

function getJobsStatePanelClassName(variant: JobsStateVariant): string {
	switch (variant) {
		case 'danger':
			return 'border-destructive/30 bg-destructive/10 text-destructive';
		case 'warning':
			return 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200';
		case 'default':
			return 'border-border bg-card text-foreground';
	}
}

function getJobStatusBadgeVariant(status: JobDto['status']): JobStatusBadgeVariant {
	switch (status) {
		case 'completed':
			return 'success';
		case 'failed':
			return 'danger';
		case 'processing':
			return 'warning';
		case 'cancelled':
		case 'pending':
			return 'outline';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
