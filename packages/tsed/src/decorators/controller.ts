import { StoreMerge, useDecorators } from '@tsed/core';
import { Injectable } from '@tsed/di';

import { MonqueTypes } from '@/constants/MonqueTypes.js';
import type { JobControllerOptions } from '@/types.js';

/**
 * Class decorator that registers a class as a Monque job controller.
 *
 * Controllers group related job handlers together with an optional namespace.
 * Use `@Job` and `@Cron` method decorators within a controller to define
 * individual job handlers.
 *
 * @param options - Controller configuration options
 *
 * @example Basic controller
 * ```typescript
 * @JobController()
 * class NotificationJobs {
 *   @Job('send-email')
 *   async sendEmail(data: EmailData, job: Job<EmailData>) {
 *     await this.emailService.send(data);
 *   }
 * }
 * ```
 *
 * @example Controller with namespace
 * ```typescript
 * @JobController({ namespace: 'payments' })
 * class PaymentJobs {
 *   @Inject()
 *   private paymentService: PaymentService;
 *
 *   @Job('process')  // Registered as 'payments.process'
 *   async processPayment(data: PaymentData) {
 *     await this.paymentService.process(data);
 *   }
 *
 *   @Cron('0 0 * * *')  // Daily at midnight
 *   async reconcile() {
 *     await this.paymentService.reconcile();
 *   }
 * }
 * ```
 */
export function JobController(options: JobControllerOptions = {}): ClassDecorator {
	return useDecorators(
		options.namespace && StoreMerge('monque', { namespace: options.namespace }),
		Injectable({
			type: MonqueTypes.CONTROLLER,
		}),
	);
}
