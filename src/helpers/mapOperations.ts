function some<K, V>(it: Map<K, V>, pred: (k: K, v: V) => boolean) {
    for (const [k, v] of it)
        if (pred(k, v))
            return true;
    return false;
}


export default { some }