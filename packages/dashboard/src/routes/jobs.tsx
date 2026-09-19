import type { CapabilitiesDto, JobDto } from '@monque/management/contract';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, useMatchRoute, useNavigate } from '@tanstack/react-router';
import {
	type CellContext,
	type ColumnDef,
	columnFilteringFeature,
	columnVisibilityFeature,
	flexRender,
	type RowSelectionState,
	rowPaginationFeature,
	rowSelectionFeature,
	rowSortingFeature,
	type SortingState,
	tableFeatures,
	useTable,
} from '@tanstack/react-table';
import {
	AlertCircle,
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	MoreHorizontal,
	RefreshCw,
} from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import { JobTimestamp } from '@/components/job-timestamp';
import { QueryFreshness } from '@/components/query-freshness';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { JobActionDialog, type JobActionDialogState } from '@/features/jobs/job-action-dialog';
import { JobActionFeedbackPanel } from '@/features/jobs/job-action-feedback-panel';
import {
	getJobActionAvailability,
	type JobActionFeedback,
	type JobActionKey,
	type RunJobActionsInput,
} from '@/features/jobs/job-actions';
import {
	getJobsSearchIdentity,
	getNextSort,
	getStatusLabel,
	type JobListSortByDto,
	type JobsRouteSearch,
	parseJobsRouteSearch,
	toJobListQueryInput,
} from '@/features/jobs/job-list-search';
import { JobsBulkActions } from '@/features/jobs/jobs-bulk-actions';
import { JobsFilters } from '@/features/jobs/jobs-filters';
import { useJobsActionMutation } from '@/features/jobs/use-jobs-action-mutation';
import { formatRelativeDate, getOperatorTimeZoneLabel, toDateTimeLocalValue } from '@/lib/dates';
import { useDocumentVisiblePollingInterval } from '@/lib/document-visibility';
import { getJobRunLabel } from '@/lib/job-detail';
import { useNow } from '@/lib/use-now';
import { cn } from '@/lib/utils';
import { readManagementError } from '@/management-errors';

export const Route = createFileRoute('/jobs')({
	validateSearch: parseJobsRouteSearch,
	component: JobsRoute,
});

const features = tableFeatures({
	rowSelectionFeature,
	rowSortingFeature,
	columnFilteringFeature,
	rowPaginationFeature,
	columnVisibilityFeature,
});
const EMPTY_JOBS: JobDto[] = [];

const SORTABLE_DATE_COLUMNS = [
	{ accessorKey: 'createdAt', label: 'Created time' },
	{ accessorKey: 'updatedAt', label: 'Updated time' },
	{ accessorKey: 'nextRunAt', label: 'Next run' },
] as const satisfies readonly {
	readonly accessorKey: Extract<JobListSortByDto, 'createdAt' | 'updatedAt' | 'nextRunAt'>;
	readonly label: string;
}[];
type JobsColumnsOptions = {
	readonly busy: boolean;
	readonly now: Date;
	readonly activeSortBy: JobListSortByDto;
	readonly capabilities: CapabilitiesDto | undefined;
	readonly direction: JobsRouteSearch['sortDirection'];
	readonly onDelete: (job: JobDto) => void;
	readonly onReschedule: (job: JobDto) => void;
	readonly onRunAction: (
		action: Exclude<JobActionKey, 'delete' | 'reschedule'>,
		job: JobDto,
	) => void;
	readonly onSortChange: (sortBy: JobListSortByDto) => void;
};
type JobStatusBadgeVariant = 'danger' | 'info' | 'outline' | 'success';
type JobsStateVariant = 'danger' | 'default' | 'warning';

function JobsRoute() {
	const matchRoute = useMatchRoute();
	return matchRoute({ to: '/jobs/$jobId' }) ? <Outlet /> : <JobsListRoute />;
}

function JobsListRoute() {
	const now = useNow();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const { managementApi, queryClient, runtimeConfig } = Route.useRouteContext();
	const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
	const [feedback, setFeedback] = useState<JobActionFeedback | null>(null);
	const [dialogState, setDialogState] = useState<JobActionDialogState | null>(null);
	const [dateFiltersOpen, setDateFiltersOpen] = useState(false);

	const refetchInterval = useDocumentVisiblePollingInterval(runtimeConfig.pollingIntervalMs);
	const jobsQuery = useQuery(
		managementApi.orpc.jobs.queryOptions({
			input: toJobListQueryInput(search),
			refetchInterval,
		}),
	);
	const capabilitiesQuery = useQuery(managementApi.orpc.capabilities.queryOptions());
	const jobsPage = jobsQuery.data;
	const { hasPreviousPage, previousPageLabel, handleNextPage, handlePreviousPage } =
		useJobsPagination(search, jobsPage?.cursor);
	const jobs = jobsPage?.jobs ?? EMPTY_JOBS;
	const [previousJobs, setPreviousJobs] = useState(jobs);
	if (jobs !== previousJobs) {
		setPreviousJobs(jobs);
		setRowSelection((selection) => getSelectionForVisibleJobs(selection, jobs));
	}

	const selectedJobs = useMemo(
		() => tableSelectionToJobs(rowSelection, jobs),
		[jobs, rowSelection],
	);

	const sorting = useMemo<SortingState>(
		() => [
			{
				id: search.sortBy,
				desc: search.sortDirection === 'desc',
			},
		],
		[search.sortBy, search.sortDirection],
	);

	const actionMutation = useJobsActionMutation({
		managementApi,
		queryClient,
		setFeedback,
		setRowSelection,
	});

	const columnOptions: JobsColumnsOptions = {
		busy: actionMutation.isPending,
		now,
		activeSortBy: search.sortBy,
		capabilities: capabilitiesQuery.data,
		direction: search.sortDirection,
		onDelete: (job) => {
			setDialogState({
				action: 'delete',
				jobIds: [job.id],
				jobName: job.name,
				nextRunAt: '',
				scope: 'single',
			});
		},
		onReschedule: (job) => {
			setDialogState({
				action: 'reschedule',
				jobIds: [job.id],
				jobName: job.name,
				nextRunAt: toDateTimeLocalValue(job.nextRunAt),
				scope: 'single',
			});
		},
		onRunAction: (action, job) => {
			setFeedback(null);
			actionMutation.mutate({ action, jobIds: [job.id] });
		},
		onSortChange: handleSortChange,
	};

	const table = useTable({
		features,
		data: jobs,
		columns: JOB_COLUMNS,
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

	function updateSearch(updater: (currentSearch: JobsRouteSearch) => JobsRouteSearch): void {
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

	const handleRefresh = useCallback((): void => {
		void jobsQuery.refetch();
	}, [jobsQuery.refetch]);

	function openBulkDialog(action: JobActionKey): void {
		setDialogState({
			action,
			jobIds: selectedJobs.map((job) => job.id),
			nextRunAt: action === 'reschedule' ? toDateTimeLocalValue(selectedJobs[0]?.nextRunAt) : '',
			scope: 'bulk',
		});
	}

	function handleDialogConfirm(input: RunJobActionsInput): void {
		setFeedback(null);
		actionMutation.mutate(input);
		setDialogState(null);
	}

	if (jobsQuery.isPending || capabilitiesQuery.isPending) {
		return <JobsStatePanel description="Loading jobs from the Management API." title="Jobs" />;
	}

	const error = jobsQuery.error ?? capabilitiesQuery.error;

	if (error) {
		return (
			<JobsErrorPanel
				error={error}
				onRetry={() => {
					void jobsQuery.refetch();
					void capabilitiesQuery.refetch();
				}}
				onClearFilters={() => updateSearch(() => parseJobsRouteSearch({}))}
			/>
		);
	}

	return (
		<section className="grid min-w-0 gap-5">
			<JobsPageHeader
				updatedAt={jobsQuery.dataUpdatedAt}
				fetching={jobsQuery.isFetching}
				paused={jobsQuery.fetchStatus === 'paused'}
				pollingIntervalMs={runtimeConfig.pollingIntervalMs}
				onRefresh={handleRefresh}
			/>

			<div className="min-w-0 rounded-xl border border-border bg-card">
				<JobsFilters
					search={search}
					updateSearch={updateSearch}
					dateFiltersOpen={dateFiltersOpen}
					setDateFiltersOpen={setDateFiltersOpen}
				/>

				<JobsResultsToolbar
					count={jobs.length}
					onClearFilters={() => updateSearch(() => parseJobsRouteSearch({}))}
				/>

				{feedback ? (
					<JobActionFeedbackPanel
						feedback={feedback}
						onDismiss={() => setFeedback(null)}
						className="border-b border-border px-4 py-3"
					/>
				) : null}

				<JobsBulkActions
					selectedJobs={selectedJobs}
					capabilities={capabilitiesQuery.data}
					busy={actionMutation.isPending}
					openBulkDialog={openBulkDialog}
				/>

				{jobs.length === 0 ? (
					<JobsStatePanel
						description="No jobs matched the current cursor and filters. Clear the filters or refresh the view."
						title="No jobs found"
					/>
				) : (
					<div className="overflow-x-auto">
						<JobsColumnsContext value={columnOptions}>
							<Table className="table-fixed md:min-w-[74rem]">
								<TableHeader>
									{table.getHeaderGroups().map((headerGroup) => (
										<TableRow key={headerGroup.id}>
											{headerGroup.headers.map((header) => (
												<TableHead
													key={header.id}
													aria-sort={getSortAriaValue(
														search.sortBy === header.column.id,
														search.sortDirection,
													)}
													className={getColumnVisibilityClass(header.column.id)}
												>
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
										<TableRow
											key={row.id}
											data-state={row.getIsSelected() ? 'selected' : undefined}
										>
											{row.getVisibleCells().map((cell) => (
												<TableCell
													key={cell.id}
													className={getColumnVisibilityClass(cell.column.id)}
												>
													{flexRender(cell.column.columnDef.cell, cell.getContext())}
												</TableCell>
											))}
										</TableRow>
									))}
								</TableBody>
							</Table>
						</JobsColumnsContext>
					</div>
				)}

				<JobsPagination
					selectedRowCount={selectedRowCount}
					hasPreviousPage={hasPreviousPage}
					previousPageLabel={previousPageLabel}
					hasNextPage={Boolean(jobsPage?.hasNextPage && jobsPage.cursor)}
					onPreviousPage={handlePreviousPage}
					onNextPage={handleNextPage}
				/>
			</div>

			<JobActionDialog
				state={dialogState}
				busy={actionMutation.isPending}
				onClose={() => setDialogState(null)}
				onConfirm={handleDialogConfirm}
				onNextRunAtChange={(nextRunAt) => {
					setDialogState((currentState) =>
						currentState ? { ...currentState, nextRunAt } : currentState,
					);
				}}
			/>
		</section>
	);
}

function useJobsPagination(search: JobsRouteSearch, nextPageCursor: string | null | undefined) {
	const navigate = Route.useNavigate();
	const searchIdentity = getJobsSearchIdentity(search);
	const cursor = search.cursor ?? '';
	const [history, setHistory] = useState({ identity: searchIdentity, cursors: [cursor] });
	const currentIndex = history.cursors.indexOf(cursor);
	if (searchIdentity !== history.identity) {
		setHistory({ identity: searchIdentity, cursors: [cursor] });
	}

	function handleNextPage(): void {
		if (!nextPageCursor) return;
		const trail = currentIndex < 0 ? [cursor] : history.cursors.slice(0, currentIndex + 1);
		setHistory({ identity: searchIdentity, cursors: [...trail, nextPageCursor] });
		void navigate({
			search: (currentSearch) => ({ ...currentSearch, cursor: nextPageCursor }),
		});
	}

	function handlePreviousPage(): void {
		if (!cursor) return;
		const previousCursor = currentIndex > 0 ? history.cursors[currentIndex - 1] : undefined;
		void navigate({
			search: (currentSearch) => ({ ...currentSearch, cursor: previousCursor || undefined }),
		});
	}

	return {
		hasPreviousPage: Boolean(cursor),
		previousPageLabel: cursor && currentIndex <= 0 ? 'First page' : 'Previous page',
		handleNextPage,
		handlePreviousPage,
	};
}

function JobsPageHeader({
	updatedAt,
	fetching,
	paused,
	pollingIntervalMs,
	onRefresh,
}: {
	readonly updatedAt: number;
	readonly fetching: boolean;
	readonly paused: boolean;
	readonly pollingIntervalMs: number | undefined;
	readonly onRefresh: () => void;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
			<div className="grid min-w-0 gap-1">
				<h1 className="text-2xl font-semibold">Jobs</h1>
				<p className="max-w-[72ch] text-sm text-muted-foreground">
					Find, inspect, and manage background jobs.
				</p>
			</div>
			<div className="flex items-center gap-2">
				<QueryFreshness
					updatedAt={updatedAt}
					fetching={fetching}
					paused={paused}
					pollingIntervalMs={pollingIntervalMs}
				/>
				<Button type="button" variant="outline" onClick={onRefresh}>
					<RefreshCw className="size-4" />
					Refresh
				</Button>
			</div>
		</div>
	);
}

function JobsResultsToolbar({
	count,
	onClearFilters,
}: {
	readonly count: number;
	readonly onClearFilters: () => void;
}) {
	return (
		<div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-muted-foreground">
			<span>
				{count} jobs on this page · Times in {getOperatorTimeZoneLabel()}
			</span>
			<Button variant="ghost" size="sm" onClick={onClearFilters}>
				Clear filters
			</Button>
		</div>
	);
}

function JobsPagination({
	previousPageLabel,
	selectedRowCount,
	hasPreviousPage,
	hasNextPage,
	onPreviousPage,
	onNextPage,
}: {
	readonly previousPageLabel: string;
	readonly selectedRowCount: number;
	readonly hasPreviousPage: boolean;
	readonly hasNextPage: boolean;
	readonly onPreviousPage: () => void;
	readonly onNextPage: () => void;
}) {
	return (
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
					onClick={onPreviousPage}
					disabled={!hasPreviousPage}
				>
					{previousPageLabel}
				</Button>
				<Button type="button" variant="outline" onClick={onNextPage} disabled={!hasNextPage}>
					Next page
				</Button>
			</div>
		</div>
	);
}

const JobsColumnsContext = createContext<JobsColumnsOptions | null>(null);
const JOB_COLUMNS = createJobsColumns();
type JobCellProps = CellContext<typeof features, JobDto>;

function useJobsColumnsOptions(): JobsColumnsOptions {
	const options = useContext(JobsColumnsContext);
	if (!options) throw new Error('Jobs table cells require column options.');
	return options;
}

function createJobsColumns(): ColumnDef<typeof features, JobDto>[] {
	return [
		{
			id: 'select',
			enableSorting: false,
			header: ({ table }) => (
				<Checkbox
					aria-label="Select all jobs on this page"
					checked={table.getIsAllPageRowsSelected()}
					indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
					onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked)}
				/>
			),
			cell: ({ row }) => (
				<Checkbox
					aria-label={`Select job row ${row.original.name} ${row.original.id}`}
					checked={row.getIsSelected()}
					onCheckedChange={() => row.toggleSelected()}
				/>
			),
		},
		{ accessorKey: 'name', header: 'Job name', cell: JobNameCell },
		{
			accessorKey: 'status',
			header: 'Status',
			cell: ({ row }) => <JobStatusBadge status={row.original.status} />,
		},
		...SORTABLE_DATE_COLUMNS.map(
			(column): ColumnDef<typeof features, JobDto> => ({
				accessorKey: column.accessorKey,
				header: () => <JobColumnSortHeader columnId={column.accessorKey} label={column.label} />,
				cell: ({ row }) => <JobDateCell job={row.original} field={column.accessorKey} />,
			}),
		),
		{
			id: 'identifier',
			header: () => <JobColumnSortHeader columnId="identifier" label="Identifier" />,
			cell: ({ row }) => <span className="whitespace-nowrap text-xs">{row.original.id}</span>,
		},
		{ id: 'actions', enableSorting: false, header: 'Actions', cell: JobActionsCell },
	];
}

function JobNameCell({ row }: JobCellProps) {
	const { now } = useJobsColumnsOptions();
	return (
		<div className="min-w-0 whitespace-normal">
			<Link
				to="/jobs/$jobId"
				search={(current) => parseJobsRouteSearch(current)}
				params={{ jobId: row.original.id }}
				className="break-all font-medium underline decoration-border underline-offset-4 hover:text-primary"
			>
				{row.original.name}
			</Link>
			<p className="mt-1 flex flex-wrap gap-x-1 text-xs text-muted-foreground md:hidden">
				<span className="font-mono" title={row.original.id}>
					…{row.original.id.slice(-8)}
				</span>
				<span title="Created">· {formatRelativeDate(row.original.createdAt, now)}</span>
			</p>
		</div>
	);
}

function JobDateCell({
	job,
	field,
}: {
	readonly job: JobDto;
	readonly field: (typeof SORTABLE_DATE_COLUMNS)[number]['accessorKey'];
}) {
	const { now } = useJobsColumnsOptions();
	return (
		<div className="whitespace-nowrap">
			{field === 'nextRunAt' ? (
				<span className="text-xs text-muted-foreground">{getJobRunLabel(job)}</span>
			) : null}
			<JobTimestamp value={job[field]} now={now} />
		</div>
	);
}

function JobColumnSortHeader({
	columnId,
	label,
}: {
	readonly columnId: JobListSortByDto;
	readonly label: string;
}) {
	const { activeSortBy, direction, onSortChange } = useJobsColumnsOptions();
	return (
		<JobsSortButton
			activeSortBy={activeSortBy}
			columnId={columnId}
			direction={direction}
			label={label}
			onSortChange={onSortChange}
		/>
	);
}

function JobActionsCell({ row }: JobCellProps) {
	const { busy, capabilities, onDelete, onReschedule, onRunAction } = useJobsColumnsOptions();
	return (
		<JobRowActions
			busy={busy}
			job={row.original}
			capabilities={capabilities}
			onDelete={onDelete}
			onReschedule={onReschedule}
			onRunAction={onRunAction}
		/>
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
		>
			<span>{label}</span>
			{sortIcon}
		</Button>
	);
}

function JobRowActions({
	busy,
	job,
	capabilities,
	onDelete,
	onReschedule,
	onRunAction,
}: {
	readonly busy: boolean;
	readonly capabilities: CapabilitiesDto | undefined;
	readonly job: JobDto;
	readonly onDelete: (job: JobDto) => void;
	readonly onReschedule: (job: JobDto) => void;
	readonly onRunAction: (
		action: Exclude<JobActionKey, 'delete' | 'reschedule'>,
		job: JobDto,
	) => void;
}) {
	const cancelAvailability = getJobActionAvailability(job, capabilities, 'cancel');
	const retryAvailability = getJobActionAvailability(job, capabilities, 'retry');
	const rescheduleAvailability = getJobActionAvailability(job, capabilities, 'reschedule');
	const deleteAvailability = getJobActionAvailability(job, capabilities, 'delete');

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button variant="ghost" size="icon" disabled={busy} aria-label={`Actions for ${job.id}`}>
						<MoreHorizontal className="size-4" />
					</Button>
				}
			/>
			<DropdownMenuContent className="w-44" align="end">
				<DropdownMenuItem
					disabled={busy || cancelAvailability.disabled}
					aria-label="Cancel job"
					aria-describedby={cancelAvailability.reason ? `${job.id}-cancel-reason` : undefined}
					onClick={() => onRunAction('cancel', job)}
				>
					<div>
						<span>Cancel job</span>
						{cancelAvailability.reason ? (
							<p id={`${job.id}-cancel-reason`} className="sr-only">
								{cancelAvailability.reason}
							</p>
						) : null}
					</div>
				</DropdownMenuItem>
				<DropdownMenuItem
					disabled={busy || retryAvailability.disabled}
					aria-label="Retry job"
					aria-describedby={retryAvailability.reason ? `${job.id}-retry-reason` : undefined}
					onClick={() => onRunAction('retry', job)}
				>
					<div>
						<span>Retry job</span>
						{retryAvailability.reason ? (
							<p id={`${job.id}-retry-reason`} className="sr-only">
								{retryAvailability.reason}
							</p>
						) : null}
					</div>
				</DropdownMenuItem>
				<DropdownMenuItem
					disabled={busy || rescheduleAvailability.disabled}
					aria-label="Reschedule job"
					aria-describedby={
						rescheduleAvailability.reason ? `${job.id}-reschedule-reason` : undefined
					}
					onClick={() => onReschedule(job)}
				>
					<div>
						<span>Reschedule job</span>
						{rescheduleAvailability.reason ? (
							<p id={`${job.id}-reschedule-reason`} className="sr-only">
								{rescheduleAvailability.reason}
							</p>
						) : null}
					</div>
				</DropdownMenuItem>
				<DropdownMenuItem
					className="text-destructive"
					disabled={busy || deleteAvailability.disabled}
					aria-label="Delete job"
					aria-describedby={deleteAvailability.reason ? `${job.id}-delete-reason` : undefined}
					onClick={() => onDelete(job)}
				>
					<div>
						<span>Delete job</span>
						{deleteAvailability.reason ? (
							<p id={`${job.id}-delete-reason`} className="sr-only">
								{deleteAvailability.reason}
							</p>
						) : null}
					</div>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function JobsErrorPanel({
	error,
	onRetry,
	onClearFilters,
}: {
	readonly error: unknown;
	readonly onRetry: () => void;
	readonly onClearFilters: () => void;
}) {
	const { status, message } = readManagementError(error);

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
				>
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" onClick={onRetry}>
							Retry
						</Button>
						<Button variant="outline" onClick={onClearFilters}>
							Clear filters
						</Button>
					</div>
				</JobsStatePanel>
			);
	}
}

function JobsStatePanel({
	children,
	description,
	title,
	variant = 'default',
}: {
	readonly children?: ReactNode;
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
			{children}
		</section>
	);
}

function JobStatusBadge({ status }: { readonly status: JobDto['status'] }) {
	return <Badge variant={getJobStatusBadgeVariant(status)}>{getStatusLabel(status)}</Badge>;
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

function tableSelectionToJobs(
	currentSelection: RowSelectionState,
	jobs: readonly JobDto[],
): readonly JobDto[] {
	const selectedJobIds = new Set(
		Object.entries(currentSelection)
			.filter(([, selected]) => selected)
			.map(([jobId]) => jobId),
	);

	return jobs.filter((job) => selectedJobIds.has(job.id));
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
			return 'info';
		case 'cancelled':
		case 'pending':
			return 'outline';
	}
}

function getColumnVisibilityClass(id: string): string {
	if (id === 'name') return 'md:w-48';
	if (id === 'select') return 'w-10';
	if (id === 'status') return 'w-28';
	if (id === 'actions') return 'w-18';
	if (id === 'createdAt' || id === 'updatedAt') return 'hidden w-48 md:table-cell';
	if (id === 'identifier') return 'hidden w-52 md:table-cell';
	if (id === 'nextRunAt') return 'hidden w-48 sm:table-cell';
	return '';
}
