/** Bounded snapshots with shared in-flight reads. Failed reads are never cached. */
export class QueryCache<T> {
	private readonly entries = new Map<string, { value: T; expiresAt: number }>();
	private readonly pending = new Map<string, Promise<T>>();
	private generation = 0;

	async get(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
		const cached = this.entries.get(key);
		if (ttl > 0 && cached && cached.expiresAt > Date.now()) {
			this.entries.delete(key);
			this.entries.set(key, cached);
			return cached.value;
		}
		const pending = this.pending.get(key);
		if (pending) return pending;
		const generation = this.generation;
		const request = load().then((value) => {
			if (ttl > 0 && generation === this.generation) {
				this.entries.delete(key);
				if (this.entries.size >= 100) {
					const oldest = this.entries.keys().next().value;
					if (oldest !== undefined) this.entries.delete(oldest);
				}
				this.entries.set(key, { value, expiresAt: Date.now() + ttl });
			}
			return value;
		});
		this.pending.set(key, request);
		try {
			return await request;
		} finally {
			if (this.pending.get(key) === request) this.pending.delete(key);
		}
	}

	clear(): void {
		this.generation++;
		this.entries.clear();
		this.pending.clear();
	}
}
