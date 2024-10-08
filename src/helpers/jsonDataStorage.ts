import { writeFile, readFile, access, constants as fsconst } from 'fs'
import type { Logger } from "orange-common-lib";


type BasicTypes = "string" | "string?" | "number" | "number?" | "boolean" | "boolean?";

type JsonSchema = BasicTypes | SchemaObject | [JsonSchema];

type SchemaObject = {
    readonly [key: string]: JsonSchema
};

type ParseArray<T extends readonly unknown[]> = (T extends readonly (infer ElementType)[] ? ParseSchema<ElementType> : never)[];

type ParseObject<T extends SchemaObject> = { -readonly [K in keyof T]: ParseSchema<T[K]> };


type BasicType<T> = 
      T extends "string" ? string
    : T extends "number" ? number
    : T extends "boolean" ? boolean
    : never;

type ParseSchema<T> =
    T extends `${infer H}?` ? BasicType<H> | undefined
    : T extends string ? BasicType<T>
    : T extends readonly unknown[] ? ParseArray<T>
    : T extends SchemaObject ? ParseObject<T>
    : never


class JsonDataStorage<SCHEMA extends JsonSchema, T extends ParseSchema<SCHEMA>> {
    private readonly dataPath: string;
    private readonly logger: Logger;
    constructor(dataPath: string, readonly schema: SCHEMA, logger: Logger) {
        this.dataPath = dataPath;
        this.logger = logger.sublogger(`json-storage ${dataPath}`);
        if (process.env.GENERATE_CONFIG_SCHEMA) this.generateJsonSchema();
        else this.ensureJsonSchema();
    }
    makeSureDataFileExists(content: string | undefined | T = undefined): Promise<void> {
        if (typeof content !== "string" && typeof content !== "undefined") content = JSON.stringify(content, null, 4);
        return new Promise((resolve, reject) => {
            access(this.dataPath, fsconst.F_OK, err => {
                if (err) writeFile(this.dataPath, content || "{}", err => {
                    if (err) {
                        this.logger.error(`Error while creating ${this.dataPath}:`);
                        this.logger.error(err);
                        return reject();
                    }
                    this.logger.log(`Created data file ${this.dataPath}`)
                    return resolve();
                })
                this.generateJsonSchema();
                return resolve();
            })
        })
    }
    ensureJsonSchema() {
        access(this.dataPath.replace(/\.json$/, ".schema.json"), fsconst.F_OK, err => {
            if (err) this.generateJsonSchema();
        })
    }
    generateJsonSchema() {
        const jsonSchema: any = this.generateJsonSchemaRecurse(this.schema);
        jsonSchema.properties["$schema"] = { type: "string" };
        jsonSchema.additionalProperties = false;
        const schemaPath = this.dataPath.replace(/\.json$/, ".schema.json");
        writeFile(schemaPath, JSON.stringify(jsonSchema, null, 4), err => {
            if (err) {
                this.logger.error(`Error while creating ${schemaPath}:`);
                this.logger.error(err);
            }
            this.logger.log(`Created schema file file ${schemaPath}`)
        });
    }
    generateJsonSchemaRecurse(schema: JsonSchema) {
        if (typeof schema === "string") {
            const type = schema.replace("?", "");
            if (schema.endsWith("?")) return { type, optional: true }
            return { type }
        }
        if (Array.isArray(schema)) {
            const child: any = this.generateJsonSchemaRecurse(schema[0]);
            if (child.optional) delete child.optional;
            return {
                type: "array",
                items: child
            }
        }
        if (typeof schema === "object") {
            const properties: { [name: string]: any } = {};
            const required: string[] = [];
            for (const key in schema) {
                const child: any = this.generateJsonSchemaRecurse(schema[key]);
                if (!child.optional) required.push(key);
                else delete child.optional;
                properties[key] = child;
            }
            return {
                type: "object",
                properties,
                required
            }
        }
        return {};
    }

    read(): Promise<T> {
        return new Promise((resolve, reject) => {
            readFile(this.dataPath, "utf8", (err, data) => {
                if (err) {
                    this.logger.error(`Error while reading ${this.dataPath}:`);
                    this.logger.error(err);
                    return reject()
                }
                try {
                    const jsonData = JSON.parse(data);
                    this.validate(jsonData, this.schema, "");
                    resolve(jsonData);
                    this.logger.log(`Loaded data file ${this.dataPath}`);
                }
                catch (e) {
                    reject(e);
                }

            })
        })
    }
    save(data: T): Promise<void> {
        return new Promise((resolve, reject) => {
            writeFile(this.dataPath, JSON.stringify(data, null, 4), "utf8", err => {
                if (err) {
                    this.logger.error(`Error while saving ${this.dataPath}:`);
                    this.logger.error(err);
                    return reject();
                }
                this.logger.log(`Saved data file ${this.dataPath}`);
                resolve()
            })
        })
    }
    typeError(path: string, actual: string, desired: string) {
        return new TypeError(`${path} is "${actual}", expected "${desired}"`);
    }
    validate(data: any, schema: JsonSchema, path: string) {
        if (typeof(schema) === "string") {
            if (schema.endsWith("?") && (data === undefined || data === null)) {
                return true;
            }
            const type = schema.replace("?", "");
            if (type === typeof(data)) {
                return true;
            }
            throw this.typeError(path, typeof(data), type);
        }
        if (Array.isArray(schema)) {
            if (!Array.isArray(data)) throw this.typeError(path, typeof(data), `${schema[0]}[]`);

            if (data.some((value, index) => {
                this.validate(value, schema[0], `${path}.${index}`);
            })) return false;
            return true;
        }
        
        if (!(data instanceof Object)) throw this.typeError(path, typeof(data), `object`);

        for (const key in schema) {
            if (!this.validate(data[key], schema[key], `${path}.${key}`))
                return false;
        }
        return true;
    }
}


export default JsonDataStorage
export type { JsonSchema, ParseSchema }