import type { JobDto } from '@monque/management/contract';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute, Outlet, useMatchRoute, useNavigate } from '@tanstack/react-router';
import type { RowSelectionState } from '@tanstack/react-table';
import { AlertCircle } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { ButtonLink } from '@/components/button-link';
import { QueryFreshness, RefreshButton } from '@/components/query-freshness';
import { Button } from '@/components/ui/button';
import { JobActionDialog, type JobActionDialogState } from '@/features/jobs/job-action-dialog';
import { JobActionFeedbackPanel } from '@/features/jobs/job-action-feedback-panel';
import type {
	JobActionFeedback,
	JobActionKey,
	RunJobActionsInput,
} from '@/features/jobs/job-actions';
import {
	getJobsSearchIdentity,
	getNextSort,
	type JobListSortByDto,
	type JobsRouteSearch,
	parseJobsRouteSearch,
	toJobListQueryInput,
} from '@/features/jobs/job-list-search';
import { JobsBulkActions } from '@/features/jobs/jobs-bulk-actions';
import { JobsFilters } from '@/features/jobs/jobs-filters';
import { type JobsColumnsOptions, JobsTable } from '@/features/jobs/jobs-table';
import { useJobsActionMutation } from '@/features/jobs/use-jobs-action-mutation';
import { getOperatorTimeZoneLabel, toDateTimeLocalValue } from '@/lib/dates';
import { useDocumentVisiblePollingInterval } from '@/lib/document-visibility';
import { cn } from '@/lib/utils';
import { readManagementError } from '@/management-errors';

export const Route = createFileRoute('/jobs')({
	validateSearch: parseJobsRouteSearch,
	component: JobsRoute,
});

const EMPTY_JOBS: JobDto[] = [];
type JobsStateVariant = 'danger' | 'default' | 'warning';

function JobsRoute() {
	const matchRoute = useMatchRoute();
	return matchRoute({ to: '/jobs/$jobId' }) ? <Outlet /> : <JobsListRoute />;
}

function JobsListRoute() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const { managementApi, queryClient, runtimeConfig } = Route.useRouteContext();
	const [feedback, setFeedback] = useState<JobActionFeedback | null>(null);
	const [dialogState, setDialogState] = useState<JobActionDialogState | null>(null);

	const refetchInterval = useDocumentVisiblePollingInterval(runtimeConfig.pollingIntervalMs);
	const debouncedName = useDebouncedJobName(search.name);
	const namePending = debouncedName !== search.name;
	const jobsQuery = useQuery(
		managementApi.orpc.jobs.queryOptions({
			input: { ...toJobListQueryInput(search), view: 'summary' },
			enabled: !namePending,
			placeholderData: keepPreviousData,
			refetchInterval,
		}),
	);
	const capabilitiesInterval = useDocumentVisiblePollingInterval(
		runtimeConfig.pollingIntervalMs,
		6,
	);
	const capabilitiesQuery = useQuery({
		...managementApi.orpc.capabilities.queryOptions(),
		refetchInterval: capabilitiesInterval,
	});
	const resultsPending = namePending || jobsQuery.isPlaceholderData;
	const jobsPage = jobsQuery.data;
	const { hasPreviousPage, previousPageLabel, previousCursor, rememberNextPage } =
		useJobsPagination(search, jobsPage?.cursor);
	const jobs = jobsPage?.jobs ?? EMPTY_JOBS;
	const { rowSelection, setRowSelection, selectedJobs } = useJobsSelection(jobs);

	const actionMutation = useJobsActionMutation({
		managementApi,
		queryClient,
		setFeedback,
		setRowSelection,
	});

	const actionsBusy = actionMutation.isPending || resultsPending;
	const columnOptions: JobsColumnsOptions = {
		busy: actionsBusy,
		activeSortBy: search.sortBy,
		capabilities: capabilitiesQuery.data,
		direction: search.sortDirection,
		onAction: (action, job) => {
			if (action === 'delete' || action === 'reschedule') {
				setDialogState({
					action,
					jobIds: [job.id],
					jobName: job.name,
					nextRunAt: action === 'reschedule' ? toDateTimeLocalValue(job.nextRunAt) : '',
					scope: 'single',
				});
			} else {
				setFeedback(null);
				actionMutation.mutate({ action, jobIds: [job.id] });
			}
		},
		onSortChange: handleSortChange,
	};

	const updateSearch = useCallback(
		(updater: (currentSearch: JobsRouteSearch) => JobsRouteSearch): void => {
			void navigate({ search: updater, replace: true });
		},
		[navigate],
	);

	function clearFilters(): void {
		updateSearch(() => parseJobsRouteSearch({}));
	}

	function handleSortChange(nextSortBy: JobListSortByDto): void {
		updateSearch((currentSearch) => ({
			...currentSearch,
			...getNextSort(currentSearch.sortBy, currentSearch.sortDirection, nextSortBy),
			cursor: undefined,
		}));
	}

	const handleRefresh = useCallback((): void => {
		void Promise.all([jobsQuery.refetch(), capabilitiesQuery.refetch()]);
	}, [jobsQuery.refetch, capabilitiesQuery.refetch]);

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
		return <JobsErrorPanel error={error} onRetry={handleRefresh} onClearFilters={clearFilters} />;
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
				<JobsFilters search={search} updateSearch={updateSearch} />

				<JobsResultsToolbar count={jobs.length} onClearFilters={clearFilters} />

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
					busy={actionsBusy}
					openBulkDialog={openBulkDialog}
				/>

				{jobs.length === 0 ? (
					<JobsStatePanel
						description="No jobs matched the current cursor and filters. Clear the filters or refresh the view."
						title="No jobs found"
					/>
				) : (
					<JobsTable
						jobs={jobs}
						rowSelection={rowSelection}
						onRowSelectionChange={setRowSelection}
						options={columnOptions}
					/>
				)}

				<JobsPagination
					selectedRowCount={selectedJobs.length}
					hasPreviousPage={hasPreviousPage && !resultsPending}
					previousPageLabel={previousPageLabel}
					hasNextPage={Boolean(jobsPage?.hasNextPage && jobsPage.cursor && !resultsPending)}
					search={search}
					previousCursor={previousCursor}
					nextCursor={jobsPage?.cursor ?? undefined}
					onNextPage={rememberNextPage}
				/>
			</div>

			<JobActionDialog
				state={dialogState}
				busy={actionMutation.isPending}
				onClose={() => setDialogState(null)}
				onConfirm={handleDialogConfirm}
			/>
		</section>
	);
}

function useJobsSelection(jobs: readonly JobDto[]) {
	const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
	const [previousJobs, setPreviousJobs] = useState(jobs);
	if (jobs !== previousJobs) {
		setPreviousJobs(jobs);
		setRowSelection((selection) => getSelectionForVisibleJobs(selection, jobs));
	}

	const selectedJobs = useMemo(
		() => tableSelectionToJobs(rowSelection, jobs),
		[jobs, rowSelection],
	);

	return { rowSelection, setRowSelection, selectedJobs };
}

function useDebouncedJobName(name: string | undefined): string | undefined {
	const [debouncedName, setDebouncedName] = useState(name);
	useEffect(() => {
		const timer = setTimeout(() => setDebouncedName(name), 300);
		return () => clearTimeout(timer);
	}, [name]);
	return debouncedName;
}

function useJobsPagination(search: JobsRouteSearch, nextPageCursor: string | null | undefined) {
	const searchIdentity = getJobsSearchIdentity(search);
	const cursor = search.cursor ?? '';
	const [history, setHistory] = useState({ identity: searchIdentity, cursors: [cursor] });
	const currentIndex = history.cursors.indexOf(cursor);
	if (searchIdentity !== history.identity) {
		setHistory({ identity: searchIdentity, cursors: [cursor] });
	}

	function rememberNextPage(): void {
		if (!nextPageCursor) return;
		const trail = currentIndex < 0 ? [cursor] : history.cursors.slice(0, currentIndex + 1);
		setHistory({ identity: searchIdentity, cursors: [...trail, nextPageCursor] });
	}

	return {
		hasPreviousPage: Boolean(cursor),
		previousPageLabel: cursor && currentIndex <= 0 ? 'First page' : 'Previous page',
		rememberNextPage,
		previousCursor: (currentIndex > 0 ? history.cursors[currentIndex - 1] : undefined) || undefined,
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
				<RefreshButton onRefresh={onRefresh} />
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
	search,
	previousCursor,
	nextCursor,
	onNextPage,
}: {
	readonly previousPageLabel: string;
	readonly selectedRowCount: number;
	readonly hasPreviousPage: boolean;
	readonly hasNextPage: boolean;
	readonly search: JobsRouteSearch;
	readonly previousCursor: string | undefined;
	readonly nextCursor: string | undefined;
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
				<ButtonLink
					to="/jobs"
					search={{ ...search, cursor: previousCursor }}
					variant="outline"
					disabled={!hasPreviousPage}
				>
					{previousPageLabel}
				</ButtonLink>
				<ButtonLink
					to="/jobs"
					search={{ ...search, cursor: nextCursor }}
					variant="outline"
					onClick={onNextPage}
					disabled={!hasNextPage}
				>
					Next page
				</ButtonLink>
			</div>
		</div>
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
	return jobs.filter((job) => currentSelection[job.id]);
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
