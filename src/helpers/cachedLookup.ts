class CachedLookup<K, V> {
    readonly cache: Map<K, V>;
    private readonly fetcher: (key: K) => Promise<V>;
    constructor(fetcher: (key: K) => Promise<V>, expireEveryMs?: number) {
        this.cache = new Map();
        this.fetcher = fetcher;

        if (expireEveryMs !== undefined)
            setInterval(() => this.cache.clear(), expireEveryMs);
    }
    async get(key: K): Promise<V | undefined> {
        if (this.cache.has(key)) return this.cache.get(key);

        try {
            const value = await this.fetcher(key);
            this.cache.set(key, value);
            return value;
        }
        catch {
            return undefined;
        }
    }
    update(key: K, value: V) {
        this.cache.set(key, value);
    }
    remove(key: K): boolean {
        return this.cache.delete(key);
    }
}

export { CachedLookup }