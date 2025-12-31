import { Store } from '@tsed/core';
import { PlatformTest } from '@tsed/platform-http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JobController } from '@/decorators/controller';

// Define test controllers at module level so they're registered when the file is loaded
@JobController()
class TestController {}

@JobController({ namespace: 'email' })
class EmailController {}

@JobController()
class PlainController {}

@JobController({})
class EmptyOptionsController {}

@JobController({ namespace: 'orders' })
class OrderController {}

@JobController({ namespace: 'users' })
class UserController {}

describe('JobController decorator', () => {
	beforeEach(() => PlatformTest.create());
	afterEach(() => PlatformTest.reset());

	it('should register class as injectable provider', () => {
		const controller = PlatformTest.get<TestController>(TestController);

		expect(controller).toBeDefined();
		expect(controller).toBeInstanceOf(TestController);
	});

	it('should store namespace in metadata when provided', () => {
		const store = Store.from(EmailController);
		const metadata = store.get<{ namespace?: string }>('monque');

		expect(metadata?.namespace).toBe('email');
	});

	it('should not store namespace when not provided', () => {
		const store = Store.from(PlainController);
		const metadata = store.get<{ namespace?: string }>('monque');

		expect(metadata?.namespace).toBeUndefined();
	});

	it('should allow empty namespace option', () => {
		const store = Store.from(EmptyOptionsController);
		const metadata = store.get<{ namespace?: string }>('monque');

		expect(metadata?.namespace).toBeUndefined();
	});

	it('should register multiple controllers independently', () => {
		const orderController = PlatformTest.get<OrderController>(OrderController);
		const userController = PlatformTest.get<UserController>(UserController);

		expect(orderController).toBeInstanceOf(OrderController);
		expect(userController).toBeInstanceOf(UserController);
	});
});
