type UniqueString<T extends string> = string & { [i: unique symbol]: T }
type InstanceName = string & { [i: unique symbol]: string };

export type { InstanceName, UniqueString }