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
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
	parseJobsRouteSearch,
	toDateTimeLocalValue,
	toJobListQueryInput,
} from '@/features/jobs/job-list-search';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/jobs')({
	validateSearch: parseJobsRouteSearch,
	component: JobsRoute,
});

function JobsRoute() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const { managementApi, runtimeConfig } = Route.useRouteContext();
	const [cursorHistory, setCursorHistory] = useState<readonly string[]>([]);
	const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
	const searchIdentity = getJobsSearchIdentity(search);
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
	const columns: readonly ColumnDef<JobDto>[] = [
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
		{
			accessorKey: 'createdAt',
			header: ({ column }) => (
				<JobsSortButton
					activeSortBy={search.sortBy}
					columnId={column.id as JobListSortByDto}
					direction={search.sortDirection}
					label="Created time"
					onSortChange={handleSortChange}
				/>
			),
			cell: ({ row }) => (
				<span className="font-mono text-xs">{formatJobDate(row.original.createdAt)}</span>
			),
		},
		{
			accessorKey: 'updatedAt',
			header: ({ column }) => (
				<JobsSortButton
					activeSortBy={search.sortBy}
					columnId={column.id as JobListSortByDto}
					direction={search.sortDirection}
					label="Updated time"
					onSortChange={handleSortChange}
				/>
			),
			cell: ({ row }) => (
				<span className="font-mono text-xs">{formatJobDate(row.original.updatedAt)}</span>
			),
		},
		{
			accessorKey: 'nextRunAt',
			header: ({ column }) => (
				<JobsSortButton
					activeSortBy={search.sortBy}
					columnId={column.id as JobListSortByDto}
					direction={search.sortDirection}
					label="Next run"
					onSortChange={handleSortChange}
				/>
			),
			cell: ({ row }) => (
				<span className="font-mono text-xs">{formatJobDate(row.original.nextRunAt)}</span>
			),
		},
		{
			accessorKey: 'identifier',
			id: 'identifier',
			header: ({ column }) => (
				<JobsSortButton
					activeSortBy={search.sortBy}
					columnId={column.id as JobListSortByDto}
					direction={search.sortDirection}
					label="Identifier"
					onSortChange={handleSortChange}
				/>
			),
			cell: ({ row }) => <span className="font-mono text-xs">{row.original.id}</span>,
		},
	];
	const table = useReactTable({
		data: jobs,
		columns: [...columns],
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

	useEffect(() => {
		if (searchIdentity.length === 0) {
			return;
		}

		setCursorHistory([]);
	}, [searchIdentity]);

	useEffect(() => {
		setRowSelection((currentSelection) =>
			Object.fromEntries(
				Object.entries(currentSelection).filter(([rowId, selected]) =>
					selected ? jobs.some((job: JobDto) => job.id === rowId) : false,
				),
			),
		);
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
		updateSearch((currentSearch) => {
			const nextStatus = currentSearch.status.includes(status)
				? currentSearch.status.filter((candidate) => candidate !== status)
				: [...currentSearch.status, status].sort(
						(left, right) => JOB_STATUS_ORDER.indexOf(left) - JOB_STATUS_ORDER.indexOf(right),
					);

			return {
				...currentSearch,
				status: nextStatus,
				cursor: undefined,
			};
		});
	}

	function handleDateRangeChange(
		field: keyof Pick<
			JobsRouteSearch,
			| 'createdAtFrom'
			| 'createdAtTo'
			| 'updatedAtFrom'
			| 'updatedAtTo'
			| 'nextRunAtFrom'
			| 'nextRunAtTo'
		>,
		value: string,
	): void {
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
			limit: Math.min(parsed, 100),
			cursor: undefined,
		}));
	}

	function handleNextPage(): void {
		if (!jobsPage?.cursor) {
			return;
		}

		setCursorHistory((currentHistory) => [...currentHistory, search.cursor ?? '']);
		void navigate({
			search: (currentSearch) => ({
				...currentSearch,
				cursor: jobsPage.cursor ?? undefined,
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
							<select
								id="jobs-limit-filter"
								className="flex h-8 rounded-lg border border-input bg-background px-2.5 text-sm dark:bg-input/30"
								value={String(search.limit)}
								onChange={(event) => handleLimitChange(event.target.value)}
							>
								{[10, 25, 50, 100].map((limit) => (
									<option key={limit} value={limit}>
										{limit} rows
									</option>
								))}
							</select>
						</Field>
						<JobsDateField
							id="jobs-created-from-filter"
							label="Created from"
							value={search.createdAtFrom}
							onChange={(value) => handleDateRangeChange('createdAtFrom', value)}
						/>
						<JobsDateField
							id="jobs-created-to-filter"
							label="Created to"
							value={search.createdAtTo}
							onChange={(value) => handleDateRangeChange('createdAtTo', value)}
						/>
						<JobsDateField
							id="jobs-updated-from-filter"
							label="Updated from"
							value={search.updatedAtFrom}
							onChange={(value) => handleDateRangeChange('updatedAtFrom', value)}
						/>
						<JobsDateField
							id="jobs-updated-to-filter"
							label="Updated to"
							value={search.updatedAtTo}
							onChange={(value) => handleDateRangeChange('updatedAtTo', value)}
						/>
						<JobsDateField
							id="jobs-next-run-from-filter"
							label="Next run from"
							value={search.nextRunAtFrom}
							onChange={(value) => handleDateRangeChange('nextRunAtFrom', value)}
						/>
						<JobsDateField
							id="jobs-next-run-to-filter"
							label="Next run to"
							value={search.nextRunAtTo}
							onChange={(value) => handleDateRangeChange('nextRunAtTo', value)}
						/>
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
						{table.getSelectedRowModel().rows.length > 0
							? `${table.getSelectedRowModel().rows.length} rows selected on this page`
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

	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			className="h-auto px-0 text-left font-medium text-muted-foreground hover:bg-transparent hover:text-foreground"
			onClick={() => onSortChange(columnId)}
			aria-sort={isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
		>
			<span>{label}</span>
			{isActive ? (
				direction === 'asc' ? (
					<ArrowUp className="size-3.5" />
				) : (
					<ArrowDown className="size-3.5" />
				)
			) : (
				<ArrowUpDown className="size-3.5" />
			)}
		</Button>
	);
}

function JobsErrorPanel({ error }: { readonly error: unknown }) {
	const status = getErrorStatus(error);
	const message = getErrorMessage(error);

	if (status === 401) {
		return (
			<JobsStatePanel
				title="Sign in required"
				description={message ?? 'Your session is missing or expired for the Management API.'}
				variant="warning"
			/>
		);
	}

	if (status === 403) {
		return (
			<JobsStatePanel
				title="Access denied"
				description={
					message ?? 'Your account can reach the dashboard shell, but not the Jobs view.'
				}
				variant="warning"
			/>
		);
	}

	return (
		<JobsStatePanel
			title="Jobs failed to load"
			description={message ?? 'Refresh the view or confirm the Management API is reachable.'}
			variant="danger"
		/>
	);
}

function JobsStatePanel({
	description,
	title,
	variant = 'default',
}: {
	readonly description: string;
	readonly title: string;
	readonly variant?: 'danger' | 'default' | 'warning';
}) {
	return (
		<section
			className={cn(
				'grid gap-2 rounded-xl border p-6',
				variant === 'danger' && 'border-destructive/30 bg-destructive/10 text-destructive',
				variant === 'warning' && 'border-amber-500/30 bg-amber-500/10 text-amber-200',
				variant === 'default' && 'border-border bg-card text-foreground',
			)}
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
	const variant =
		status === 'completed'
			? 'success'
			: status === 'failed'
				? 'danger'
				: status === 'processing'
					? 'warning'
					: 'outline';

	return <Badge variant={variant}>{getStatusLabel(status)}</Badge>;
}

function formatJobDate(value: string): string {
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		year: 'numeric',
	}).format(new Date(value));
}

function getErrorStatus(error: unknown): number | undefined {
	return typeof error === 'object' && error !== null && 'status' in error
		? getOptionalNumber((error as { status?: unknown }).status)
		: undefined;
}

function getErrorMessage(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null || !('data' in error)) {
		return error instanceof Error ? error.message : undefined;
	}

	const data = (error as { data?: unknown }).data;

	if (typeof data !== 'object' || data === null || !('body' in data)) {
		return error instanceof Error ? error.message : undefined;
	}

	const body = (data as { body?: unknown }).body;

	return typeof body === 'object' && body !== null && 'error' in body
		? getOptionalString((body as { error?: unknown }).error)
		: error instanceof Error
			? error.message
			: undefined;
}

function getOptionalNumber(value: unknown): number | undefined {
	return typeof value === 'number' ? value : undefined;
}

function getOptionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}
