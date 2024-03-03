async function asyncFilter<T>(array: T[], predicate: (value: T, index: number, array: T[]) => Promise<boolean>) {
    const results = await Promise.all(array.map(predicate));
    return array.filter((value, index) => results[index]);
}

export { asyncFilter }