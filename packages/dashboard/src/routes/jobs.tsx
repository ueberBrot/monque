import type { CapabilitiesDto, JobDto } from '@monque/management/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	type RowSelectionState,
	type SortingState,
	useReactTable,
} from '@tanstack/react-table';
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useDashboardShellRouteActions } from '@/components/dashboard-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
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
import { JobActionFeedbackPanel } from '@/features/jobs/job-action-feedback-panel';
import {
	getActionErrorFeedback,
	getActionSuccessFeedback,
	getBulkJobActionAvailability,
	getJobActionAvailability,
	type JobActionFeedback,
	type JobActionKey,
	runJobAction,
} from '@/features/jobs/job-actions';
import {
	DEFAULT_LIMIT,
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
type JobStatusBadgeVariant = 'danger' | 'outline' | 'success' | 'warning';
type JobsStateVariant = 'danger' | 'default' | 'warning';
type JobActionDialogState = {
	readonly action: JobActionKey;
	readonly jobIds: readonly string[];
	readonly nextRunAt: string;
	readonly scope: 'bulk' | 'single';
};

function JobsRoute() {
	const pathname = useLocation().pathname;
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const { managementApi, queryClient, runtimeConfig } = Route.useRouteContext();
	const [cursorHistory, setCursorHistory] = useState<readonly string[]>([]);
	const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
	const [feedback, setFeedback] = useState<JobActionFeedback | null>(null);
	const [dialogState, setDialogState] = useState<JobActionDialogState | null>(null);
	const cursorResetIdentityRef = useRef(getJobsSearchIdentity(search));

	const jobsQuery = useQuery(
		managementApi.orpc.jobs.queryOptions({
			input: toJobListQueryInput(search),
			...(runtimeConfig.pollingIntervalMs
				? { refetchInterval: runtimeConfig.pollingIntervalMs }
				: {}),
		}),
	);
	const capabilitiesQuery = useQuery(managementApi.orpc.capabilities.queryOptions());
	const jobsPage = jobsQuery.data;
	const jobs = jobsPage?.jobs ?? [];
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

	const actionMutation = useMutation({
		mutationFn: async (input: {
			readonly action: JobActionKey;
			readonly jobIds: readonly string[];
			readonly nextRunAt?: string;
		}) => {
			for (const jobId of input.jobIds) {
				await runJobAction(
					managementApi,
					input.nextRunAt
						? {
								action: input.action,
								jobId,
								nextRunAt: input.nextRunAt,
							}
						: {
								action: input.action,
								jobId,
							},
				);
			}

			return {
				action: input.action,
				count: input.jobIds.length,
			};
		},
		onSuccess: async ({ action, count }) => {
			setFeedback(getActionSuccessFeedback(action, count));
			setRowSelection({});
			await queryClient.invalidateQueries();
		},
		onError: async (error) => {
			setFeedback(getActionErrorFeedback(error));
			await queryClient.invalidateQueries();
		},
	});

	const columns = createJobsColumns({
		activeSortBy: search.sortBy,
		capabilities: capabilitiesQuery.data,
		direction: search.sortDirection,
		onDelete: (job) => {
			setDialogState({
				action: 'delete',
				jobIds: [job.id],
				nextRunAt: '',
				scope: 'single',
			});
		},
		onReschedule: (job) => {
			setDialogState({
				action: 'reschedule',
				jobIds: [job.id],
				nextRunAt: toDateTimeLocalValue(job.nextRunAt),
				scope: 'single',
			});
		},
		onRunAction: (action, job) => {
			setFeedback(null);
			void actionMutation.mutateAsync({ action, jobIds: [job.id] });
		},
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

	const handleRefresh = useCallback((): void => {
		void jobsQuery.refetch();
	}, [jobsQuery.refetch]);

	const shellActions = useMemo(
		() => ({
			clearFilters: {
				label: 'Clear Jobs filters',
				run: () => {
					void navigate({
						search: (currentSearch) => ({
							...currentSearch,
							createdAtFrom: undefined,
							createdAtTo: undefined,
							cursor: undefined,
							limit: DEFAULT_LIMIT,
							name: undefined,
							nextRunAtFrom: undefined,
							nextRunAtTo: undefined,
							sortBy: 'createdAt',
							sortDirection: 'desc',
							status: [],
							updatedAtFrom: undefined,
							updatedAtTo: undefined,
						}),
					});
				},
			},
			refresh: handleRefresh,
			viewLabel: 'Jobs',
		}),
		[handleRefresh, navigate],
	);

	useDashboardShellRouteActions(pathname === '/jobs' ? shellActions : null);

	function openBulkDialog(action: JobActionKey): void {
		setDialogState({
			action,
			jobIds: selectedJobs.map((job) => job.id),
			nextRunAt: action === 'reschedule' ? toDateTimeLocalValue(selectedJobs[0]?.nextRunAt) : '',
			scope: 'bulk',
		});
	}

	function handleDialogConfirm(): void {
		if (!dialogState) {
			return;
		}

		setFeedback(null);
		const nextRunAt =
			dialogState.action === 'reschedule'
				? fromDateTimeLocalValue(dialogState.nextRunAt)
				: undefined;

		void actionMutation.mutateAsync(
			nextRunAt
				? {
						action: dialogState.action,
						jobIds: dialogState.jobIds,
						nextRunAt,
					}
				: {
						action: dialogState.action,
						jobIds: dialogState.jobIds,
					},
		);
		setDialogState(null);
	}

	if (pathname !== '/jobs') {
		return <Outlet />;
	}

	if (jobsQuery.isPending || capabilitiesQuery.isPending) {
		return <JobsStatePanel description="Loading jobs from the Management API." title="Jobs" />;
	}

	const error = jobsQuery.error ?? capabilitiesQuery.error;

	if (error) {
		return <JobsErrorPanel error={error} />;
	}

	const bulkCancelAvailability = getBulkJobActionAvailability(
		selectedJobs,
		capabilitiesQuery.data,
		'cancel',
	);
	const bulkRetryAvailability = getBulkJobActionAvailability(
		selectedJobs,
		capabilitiesQuery.data,
		'retry',
	);
	const bulkRescheduleAvailability = getBulkJobActionAvailability(
		selectedJobs,
		capabilitiesQuery.data,
		'reschedule',
	);
	const bulkDeleteAvailability = getBulkJobActionAvailability(
		selectedJobs,
		capabilitiesQuery.data,
		'delete',
	);

	return (
		<section className="grid min-w-0 gap-5">
			<div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
				<div className="grid min-w-0 gap-1">
					<h1 className="text-2xl font-semibold">Jobs</h1>
					<p className="max-w-[72ch] text-sm text-muted-foreground">
						Server-backed filters, sorting, and cursor pagination for global job inspection.
					</p>
				</div>
				<div className="flex items-center gap-2">
					{jobsQuery.isFetching ? (
						<span className="text-xs text-muted-foreground">Refreshing...</span>
					) : null}
					<Button type="button" variant="outline" onClick={handleRefresh}>
						<RefreshCw className={cn('size-4', jobsQuery.isFetching && 'animate-spin')} />
						Refresh
					</Button>
				</div>
			</div>

			<div className="min-w-0 rounded-xl border border-border bg-card">
				<div className="grid min-w-0 gap-4 border-b border-border p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
					<div className="grid min-w-0 gap-4 lg:grid-cols-2 xl:grid-cols-4">
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
					<div className="grid min-w-0 gap-2 rounded-lg border border-border bg-background/70 p-3">
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

				{feedback ? (
					<JobActionFeedbackPanel
						feedback={feedback}
						className="border-b border-border px-4 py-3"
					/>
				) : null}

				<div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => openBulkDialog('cancel')}
						disabled={bulkCancelAvailability.disabled || actionMutation.isPending}
						title={bulkCancelAvailability.reason ?? undefined}
					>
						Cancel selected jobs
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => openBulkDialog('retry')}
						disabled={bulkRetryAvailability.disabled || actionMutation.isPending}
						title={bulkRetryAvailability.reason ?? undefined}
					>
						Retry selected jobs
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => openBulkDialog('reschedule')}
						disabled={bulkRescheduleAvailability.disabled || actionMutation.isPending}
						title={bulkRescheduleAvailability.reason ?? undefined}
					>
						Reschedule selected jobs
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => openBulkDialog('delete')}
						disabled={bulkDeleteAvailability.disabled || actionMutation.isPending}
						title={bulkDeleteAvailability.reason ?? undefined}
					>
						Delete selected jobs
					</Button>
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

function createJobsColumns({
	activeSortBy,
	capabilities,
	direction,
	onDelete,
	onReschedule,
	onRunAction,
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
		{
			id: 'actions',
			enableSorting: false,
			header: 'Actions',
			cell: ({ row }) => (
				<JobRowActions
					job={row.original}
					capabilities={capabilities}
					onDelete={onDelete}
					onReschedule={onReschedule}
					onRunAction={onRunAction}
				/>
			),
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

function JobRowActions({
	job,
	capabilities,
	onDelete,
	onReschedule,
	onRunAction,
}: {
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
		<div className="flex flex-wrap gap-1">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={() => onRunAction('cancel', job)}
				disabled={cancelAvailability.disabled}
				title={cancelAvailability.reason ?? undefined}
			>
				Cancel
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={() => onRunAction('retry', job)}
				disabled={retryAvailability.disabled}
				title={retryAvailability.reason ?? undefined}
			>
				Retry
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={() => onReschedule(job)}
				disabled={rescheduleAvailability.disabled}
				title={rescheduleAvailability.reason ?? undefined}
			>
				Reschedule
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={() => onDelete(job)}
				disabled={deleteAvailability.disabled}
				title={deleteAvailability.reason ?? undefined}
			>
				Delete job
			</Button>
		</div>
	);
}

function JobActionDialog({
	busy,
	onClose,
	onConfirm,
	onNextRunAtChange,
	state,
}: {
	readonly busy: boolean;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
	readonly onNextRunAtChange: (nextRunAt: string) => void;
	readonly state: JobActionDialogState | null;
}) {
	const open = state !== null;
	const requiresDate = state?.action === 'reschedule';
	const invalidDate =
		requiresDate && (!state.nextRunAt || fromDateTimeLocalValue(state.nextRunAt) === undefined);

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
			<DialogContent>
				<DialogTitle>{getDialogTitle(state)}</DialogTitle>
				<DialogDescription>{getDialogDescription(state)}</DialogDescription>
				{requiresDate ? (
					<Field>
						<FieldLabel htmlFor="job-action-next-run-at">Next run at</FieldLabel>
						<Input
							id="job-action-next-run-at"
							type="datetime-local"
							value={state?.nextRunAt ?? ''}
							onChange={(event) => onNextRunAtChange(event.target.value)}
						/>
					</Field>
				) : null}
				<div className="flex justify-end gap-2">
					<Button type="button" variant="outline" onClick={onClose}>
						Keep current state
					</Button>
					<Button type="button" onClick={onConfirm} disabled={busy || invalidDate}>
						{getDialogConfirmLabel(state)}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
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
			return 'warning';
		case 'cancelled':
		case 'pending':
			return 'outline';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function getDialogTitle(state: JobActionDialogState | null): string {
	if (!state) {
		return '';
	}

	switch (state.action) {
		case 'cancel':
			return 'Cancel selected jobs?';
		case 'retry':
			return 'Retry selected jobs?';
		case 'reschedule':
			return state.scope === 'single' ? 'Reschedule job' : 'Reschedule selected jobs?';
		case 'delete':
			return state.scope === 'single' ? 'Delete job?' : 'Delete selected jobs?';
	}
}

function getDialogDescription(state: JobActionDialogState | null): string {
	if (!state) {
		return '';
	}

	const scopeText = state.scope === 'single' ? 'this job' : `${state.jobIds.length} selected jobs`;

	switch (state.action) {
		case 'cancel':
			return `Confirm cancellation for ${scopeText}.`;
		case 'retry':
			return `Confirm retry for ${scopeText}.`;
		case 'reschedule':
			return `Choose a new run time for ${scopeText}.`;
		case 'delete':
			return `Delete is permanent. Confirm deletion for ${scopeText}.`;
	}
}

function getDialogConfirmLabel(state: JobActionDialogState | null): string {
	if (!state) {
		return '';
	}

	switch (state.action) {
		case 'cancel':
			return 'Confirm cancel selected jobs';
		case 'retry':
			return 'Confirm retry selected jobs';
		case 'reschedule':
			return state.scope === 'single'
				? 'Confirm reschedule job'
				: 'Confirm reschedule selected jobs';
		case 'delete':
			return state.scope === 'single' ? 'Confirm delete job' : 'Confirm delete selected jobs';
	}
}
