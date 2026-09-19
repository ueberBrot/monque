import type { CapabilitiesDto, JobDto } from '@monque/management/contract';
import { Link } from '@tanstack/react-router';
import {
	type CellContext,
	type ColumnDef,
	columnVisibilityFeature,
	flexRender,
	type RowSelectionState,
	rowPaginationFeature,
	rowSelectionFeature,
	tableFeatures,
	type Updater,
	useTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, MoreHorizontal } from 'lucide-react';
import { createContext, useContext } from 'react';

import { JobStatusBadge } from '@/components/job-status-badge';
import { JobTimestamp, RelativeTimestamp } from '@/components/job-timestamp';
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
import { getJobRunLabel } from '@/lib/job-detail';

import {
	getJobActionAvailability,
	JOB_ACTION_DEFINITIONS,
	JOB_ACTION_ORDER,
	type JobActionKey,
} from './job-actions.js';
import {
	type JobListSortByDto,
	type JobsRouteSearch,
	parseJobsRouteSearch,
} from './job-list-search.js';

const features = tableFeatures({
	rowSelectionFeature,
	rowPaginationFeature,
	columnVisibilityFeature,
});

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
	readonly activeSortBy: JobListSortByDto;
	readonly capabilities: CapabilitiesDto | undefined;
	readonly direction: JobsRouteSearch['sortDirection'];
	readonly onAction: (action: JobActionKey, job: JobDto) => void;
	readonly onSortChange: (sortBy: JobListSortByDto) => void;
};
function JobsTable({
	jobs,
	rowSelection,
	onRowSelectionChange,
	options,
}: {
	readonly jobs: JobDto[];
	readonly rowSelection: RowSelectionState;
	readonly onRowSelectionChange: (updater: Updater<RowSelectionState>) => void;
	readonly options: JobsColumnsOptions;
}) {
	const table = useTable({
		features,
		data: jobs,
		columns: JOB_COLUMNS,
		getRowId: (row) => row.id,
		enableRowSelection: true,
		manualPagination: true,
		onRowSelectionChange,
		state: {
			rowSelection,
		},
	});

	return (
		<div className="overflow-x-auto">
			<JobsColumnsContext value={options}>
				<Table className="table-fixed md:min-w-[74rem]">
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead
										key={header.id}
										aria-sort={getSortAriaValue(
											options.activeSortBy === header.column.id,
											options.direction,
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
							<TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined}>
								{row.getVisibleCells().map((cell) => (
									<TableCell key={cell.id} className={getColumnVisibilityClass(cell.column.id)}>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</Table>
			</JobsColumnsContext>
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
		{ id: 'actions', header: 'Actions', cell: JobActionsCell },
	];
}

function JobNameCell({ row }: JobCellProps) {
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
				<span title="Created">
					· <RelativeTimestamp value={row.original.createdAt} />
				</span>
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
	return (
		<div className="whitespace-nowrap">
			{field === 'nextRunAt' ? (
				<span className="text-xs text-muted-foreground">{getJobRunLabel(job)}</span>
			) : null}
			<JobTimestamp value={job[field]} />
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
	const isActive = activeSortBy === columnId;
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			className="h-auto px-0 text-left font-medium text-muted-foreground hover:bg-transparent hover:text-foreground"
			onClick={() => onSortChange(columnId)}
		>
			<span>{label}</span>
			{renderSortIcon(isActive, direction)}
		</Button>
	);
}

function JobActionsCell({ row }: JobCellProps) {
	const { busy, capabilities, onAction } = useJobsColumnsOptions();
	const job = row.original;
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
				{JOB_ACTION_ORDER.map((action) => {
					const { disabled, reason } = getJobActionAvailability(job, capabilities, action);
					const label = `${JOB_ACTION_DEFINITIONS[action].label} job`;
					const reasonId = `${job.id}-${action}-reason`;
					return (
						<DropdownMenuItem
							key={action}
							className={action === 'delete' ? 'text-destructive' : undefined}
							disabled={busy || disabled}
							aria-label={label}
							aria-describedby={reason ? reasonId : undefined}
							onClick={() => onAction(action, job)}
						>
							<div>
								<span>{label}</span>
								{reason ? (
									<p id={reasonId} className="sr-only">
										{reason}
									</p>
								) : null}
							</div>
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
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

export { type JobsColumnsOptions, JobsTable };
