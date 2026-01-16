/**
 * Unit tests for JobQueryService.
 *
 * Tests job querying: getJob, getJobs, getJobsWithCursor.
 * Uses mock SchedulerContext to test query building in isolation.
 */

import { ObjectId } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockContext, JobFactory } from '@tests/factories';
import { JobStatus } from '@/jobs';
import { JobQueryService } from '@/scheduler/services/job-query.js';
import { ConnectionError, InvalidCursorError } from '@/shared';

describe('JobQueryService', () => {
	let ctx: ReturnType<typeof createMockContext>;
	let queryService: JobQueryService;

	beforeEach(() => {
		ctx = createMockContext();
		queryService = new JobQueryService(ctx);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('getJob', () => {
		it('should return job by ObjectId', async () => {
			const jobId = new ObjectId();
			const job = JobFactory.build({ _id: jobId, name: 'found-job' });

			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(job);

			const result = await queryService.getJob(jobId);

			expect(result).not.toBeNull();
			expect(result?.name).toBe('found-job');
			expect(ctx.mockCollection.findOne).toHaveBeenCalledWith({ _id: jobId });
		});

		it('should return null for non-existent job', async () => {
			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(null);

			const result = await queryService.getJob(new ObjectId());

			expect(result).toBeNull();
		});

		it('should throw ConnectionError when database operation fails', async () => {
			vi.mocked(ctx.mockCollection.findOne).mockRejectedValueOnce(
				new Error('Database connection lost'),
			);

			const error = await queryService.getJob(new ObjectId()).catch((e: unknown) => e);
			expect(error).toBeInstanceOf(ConnectionError);
			expect((error as ConnectionError).message).toMatch(/Failed to get job/);
		});

		it('should wrap non-Error thrown values in ConnectionError', async () => {
			vi.mocked(ctx.mockCollection.findOne).mockRejectedValueOnce('String error');

			await expect(queryService.getJob(new ObjectId())).rejects.toThrow(ConnectionError);
		});
	});

	describe('getJobs', () => {
		it('should return all jobs when no filter provided', async () => {
			const jobs = JobFactory.buildList(2);

			const mockCursor = {
				sort: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				skip: vi.fn().mockReturnThis(),
				toArray: vi.fn().mockResolvedValueOnce(jobs),
			};

			vi.mocked(ctx.mockCollection.find).mockReturnValueOnce(
				mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
			);

			const result = await queryService.getJobs();

			expect(result).toHaveLength(2);
			expect(ctx.mockCollection.find).toHaveBeenCalledWith({});
		});

		it('should apply status filter', async () => {
			const mockCursor = {
				sort: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				skip: vi.fn().mockReturnThis(),
				toArray: vi.fn().mockResolvedValueOnce([]),
			};

			vi.mocked(ctx.mockCollection.find).mockReturnValueOnce(
				mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
			);

			await queryService.getJobs({ status: JobStatus.PENDING });

			expect(ctx.mockCollection.find).toHaveBeenCalledWith({ status: JobStatus.PENDING });
		});

		it('should apply name filter', async () => {
			const mockCursor = {
				sort: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				skip: vi.fn().mockReturnThis(),
				toArray: vi.fn().mockResolvedValueOnce([]),
			};

			vi.mocked(ctx.mockCollection.find).mockReturnValueOnce(
				mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
			);

			await queryService.getJobs({ name: 'specific-job' });

			expect(ctx.mockCollection.find).toHaveBeenCalledWith({ name: 'specific-job' });
		});

		it('should apply limit and skip', async () => {
			const mockCursor = {
				sort: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				skip: vi.fn().mockReturnThis(),
				toArray: vi.fn().mockResolvedValueOnce([]),
			};

			vi.mocked(ctx.mockCollection.find).mockReturnValueOnce(
				mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
			);

			await queryService.getJobs({ limit: 10, skip: 20 });

			expect(mockCursor.limit).toHaveBeenCalledWith(10);
			expect(mockCursor.skip).toHaveBeenCalledWith(20);
		});

		it('should apply status array filter with $in operator', async () => {
			const mockCursor = {
				sort: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				skip: vi.fn().mockReturnThis(),
				toArray: vi.fn().mockResolvedValueOnce([]),
			};

			vi.mocked(ctx.mockCollection.find).mockReturnValueOnce(
				mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
			);

			await queryService.getJobs({ status: [JobStatus.PENDING, JobStatus.PROCESSING] });

			expect(ctx.mockCollection.find).toHaveBeenCalledWith({
				status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
			});
		});

		it('should throw ConnectionError when database operation fails', async () => {
			const mockCursor = {
				sort: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				skip: vi.fn().mockReturnThis(),
				toArray: vi.fn().mockRejectedValueOnce(new Error('Database timeout')),
			};

			vi.mocked(ctx.mockCollection.find).mockReturnValueOnce(
				mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
			);

			const error = await queryService.getJobs().catch((e: unknown) => e);
			expect(error).toBeInstanceOf(ConnectionError);
			expect((error as ConnectionError).message).toMatch(/Failed to query jobs/);
		});

		it('should wrap non-Error thrown values in ConnectionError', async () => {
			const mockCursor = {
				sort: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				skip: vi.fn().mockReturnThis(),
				toArray: vi.fn().mockRejectedValueOnce('Network failure'),
			};

			vi.mocked(ctx.mockCollection.find).mockReturnValueOnce(
				mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
			);

			await expect(queryService.getJobs()).rejects.toThrow(ConnectionError);
		});
	});

	describe('getJobsWithCursor', () => {
		it('should return page with jobs and cursor info', async () => {
			const jobs = JobFactory.buildList(2);

			const mockCursor = {
				sort: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				toArray: vi.fn().mockResolvedValueOnce(jobs),
			};

			vi.mocked(ctx.mockCollection.find).mockReturnValueOnce(
				mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
			);

			const page = await queryService.getJobsWithCursor({ limit: 10 });

			expect(page.jobs).toHaveLength(2);
			expect(page.hasNextPage).toBe(false);
			expect(page.hasPreviousPage).toBe(false);
		});

		it('should throw InvalidCursorError for malformed cursor', async () => {
			await expect(
				queryService.getJobsWithCursor({ cursor: 'invalid-base64-cursor' }),
			).rejects.toThrow(InvalidCursorError);
		});

		it('should detect hasNextPage when more results exist', async () => {
			// Return 11 jobs when limit is 10 (fetches limit + 1 to detect next page)
			const jobs = JobFactory.buildList(11);

			const mockCursor = {
				sort: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				toArray: vi.fn().mockResolvedValueOnce(jobs),
			};

			vi.mocked(ctx.mockCollection.find).mockReturnValueOnce(
				mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
			);

			const page = await queryService.getJobsWithCursor({ limit: 10 });

			expect(page.jobs).toHaveLength(10); // Should trim to limit
			expect(page.hasNextPage).toBe(true);
		});
	});
});
