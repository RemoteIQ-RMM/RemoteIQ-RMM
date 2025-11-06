declare namespace NodeJS {
    type Timeout = any;
    interface ProcessEnv {
        [key: string]: string | undefined;
    }
    interface ReadableStream {}
    interface WritableStream {}
}

declare const process: {
    env: NodeJS.ProcessEnv;
    cwd(): string;
};

declare class Buffer extends Uint8Array {
    static from(data: string | ArrayBuffer | Uint8Array, encoding?: string): Buffer;
    static from(data: number[]): Buffer;
    static isBuffer(value: any): value is Buffer;
    static concat(list: Buffer[]): Buffer;
    toString(encoding?: string): string;
}

declare module "buffer" {
    export { Buffer };
}

declare module "crypto" {
    export function randomUUID(): string;
    export function createHash(algo: string): { update(data: string | Buffer): any; digest(enc: string): string };
}

declare module "events" {
    class EventEmitter {
        on(event: string | symbol, listener: (...args: any[]) => void): this;
        emit(event: string | symbol, ...args: any[]): boolean;
    }
    export { EventEmitter };
}

declare module "stream" {
    import { EventEmitter } from "events";
    class Readable extends EventEmitter {
        pipe<T>(destination: T): T;
    }
    export { Readable };
    export type ReadableOptions = any;
}

declare module "http" {
    import { EventEmitter } from "events";
    class IncomingMessage extends EventEmitter {
        headers: Record<string, string | string[] | undefined>;
        url?: string;
        method?: string;
    }
    class ServerResponse extends EventEmitter {
        statusCode: number;
        setHeader(name: string, value: string): void;
        end(data?: any): void;
    }
    export { IncomingMessage, ServerResponse };
}

declare module "fs" {
    import { Readable } from "stream";
    export function existsSync(path: string): boolean;
    export function createReadStream(path: string): Readable;
    export function createWriteStream(path: string): NodeJS.WritableStream;
    export type ReadStream = Readable;
    export type WriteStream = NodeJS.WritableStream;
}

declare module "fs/promises" {
    export function readFile(path: string, enc?: any): Promise<string | Buffer>;
    export function writeFile(path: string, data: string | Buffer): Promise<void>;
    export function mkdir(path: string, opts?: any): Promise<void>;
    export function access(path: string, mode?: number): Promise<void>;
    export function stat(path: string): Promise<{ isDirectory(): boolean }>; 
}

declare module "path" {
    export function join(...parts: string[]): string;
    export function resolve(...parts: string[]): string;
    export function dirname(p: string): string;
    export function basename(p: string): string;
}

declare function setInterval(handler: (...args: any[]) => void, timeout?: number): NodeJS.Timeout;
declare function clearInterval(handle: NodeJS.Timeout): void;
