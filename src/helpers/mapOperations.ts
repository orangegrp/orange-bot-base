function some<K, V>(it: Map<K, V>, pred: (k: K, v: V) => boolean) {
    for (const [k, v] of it)
        if (pred(k, v))
            return true;
    return false;
}
function find<K, V>(it: Map<K, V>, pred: (key: K, value: V) => boolean): { key: K, value: V } | undefined {
    for (const [key, value] of it) {
        if (pred(key, value)) return { key, value };
    }
    return undefined;
}


export default { some, find }