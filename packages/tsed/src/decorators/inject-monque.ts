/**
 * @InjectMonque property decorator
 *
 * Convenience decorator for injecting the MonqueService instance.
 * Equivalent to @Inject(MonqueService).
 *
 * @example
 * ```typescript
 * @Service()
 * export class UserService {
 *   @InjectMonque()
 *   private monque: MonqueService;
 *
 *   async createUser(data: CreateUserDto) {
 *     const user = await this.save(data);
 *     await this.monque.enqueue("email.send-welcome", { userId: user.id });
 *     return user;
 *   }
 * }
 * ```
 */
import { Inject } from '@tsed/di';

import { MonqueService } from '@/services';

/**
 * Property decorator that injects the MonqueService instance.
 *
 * This is a convenience decorator equivalent to `@Inject(MonqueService)`.
 */
export function InjectMonque(): PropertyDecorator {
	return Inject(MonqueService);
}
