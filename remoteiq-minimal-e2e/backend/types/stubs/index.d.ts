/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Loose stub typings to allow compilation without full @types dependencies.
 * These stubs are intentionally permissive.
 */

/* ------------------------- class-validator ------------------------- */
declare module "class-validator" {
    export type ValidationOptions = {
        each?: boolean;
        message?: string | ((args: any) => string);
        groups?: string[];
        always?: boolean;
        [key: string]: any; // allow vendor keys like { require_protocol: true }
    };

    export type ValidationArguments = any;

    export const registerDecorator: (...args: any[]) => void;

    export function ValidateNested(options?: ValidationOptions): PropertyDecorator;
    export function IsOptional(options?: ValidationOptions): PropertyDecorator;
    export function IsString(options?: ValidationOptions): PropertyDecorator;
    export function IsNotEmpty(options?: ValidationOptions): PropertyDecorator;
    export function IsEmail(options?: ValidationOptions): PropertyDecorator;
    export function IsUUID(...args: any[]): PropertyDecorator;
    export function IsInt(options?: ValidationOptions): PropertyDecorator;
    export function IsBoolean(options?: ValidationOptions): PropertyDecorator;
    export function IsEnum(enumObj: any, options?: ValidationOptions): PropertyDecorator;

    export function IsArray(options?: ValidationOptions): PropertyDecorator;
    export function ArrayNotEmpty(options?: ValidationOptions): PropertyDecorator;
    export function ArrayMinSize(min: number, options?: ValidationOptions): PropertyDecorator;
    export function ArrayUnique(options?: ValidationOptions): PropertyDecorator;

    export function IsISO8601(options?: ValidationOptions): PropertyDecorator;
    export function IsDateString(options?: ValidationOptions): PropertyDecorator;

    export function IsIn(values: any[], options?: ValidationOptions): PropertyDecorator;
    export function IsObject(options?: ValidationOptions): PropertyDecorator;
    export function IsDefined(options?: ValidationOptions): PropertyDecorator;

    export function Min(minValue: number, options?: ValidationOptions): PropertyDecorator;
    export function Max(maxValue: number, options?: ValidationOptions): PropertyDecorator;

    export function MinLength(len: number, options?: ValidationOptions): PropertyDecorator;
    export function MaxLength(len: number, options?: ValidationOptions): PropertyDecorator;

    export function Length(min: number, max?: number, options?: ValidationOptions): PropertyDecorator;
    export function Matches(pattern: RegExp | string, options?: ValidationOptions): PropertyDecorator;

    export function ValidateIf(
        condition: (o: any, value?: any) => boolean,
        options?: ValidationOptions
    ): PropertyDecorator;

    export function IsNumber(options?: ValidationOptions): PropertyDecorator;
    export function IsPositive(options?: ValidationOptions): PropertyDecorator;
    export function IsDate(options?: ValidationOptions): PropertyDecorator;
    export function IsPhoneNumber(region?: string, options?: ValidationOptions): PropertyDecorator;
    export function IsLowercase(options?: ValidationOptions): PropertyDecorator;
    export function IsUrl(options?: ValidationOptions): PropertyDecorator;
    export function IsJSON(options?: ValidationOptions): PropertyDecorator;
    export function IsJWT(options?: ValidationOptions): PropertyDecorator;

    export function validateSync(instance: any, options?: any): any[];
    export function validateOrReject(instance: any, options?: any): Promise<void>;
}

/* ------------------------ class-transformer ------------------------ */
declare module "class-transformer" {
    export function Type(...args: any[]): PropertyDecorator;
    export function Transform(...args: any[]): PropertyDecorator;
    export function Expose(...args: any[]): PropertyDecorator;
    export function Exclude(...args: any[]): ClassDecorator;

    // important: dev code uses 3 args (options), so allow it
    export function plainToInstance<T>(
        cls: new (...args: any[]) => T,
        plain: any,
        options?: any
    ): T;
}

/* ------------------------- @nestjs/swagger ------------------------- */
declare module "@nestjs/swagger" {
    export function ApiTags(...tags: string[]): ClassDecorator;
    export function ApiOkResponse(options?: any): MethodDecorator;
    export function ApiConsumes(...args: any[]): MethodDecorator;
    export function ApiProperty(options?: any): PropertyDecorator;
    export function ApiPropertyOptional(options?: any): PropertyDecorator;
    export function ApiBearerAuth(...args: any[]): ClassDecorator;
}

/* --------------------------- @nestjs/core -------------------------- */
declare module "@nestjs/core" {
    export class Reflector {
        get<T = any>(metadataKey: any, target: any): T;
        getAllAndOverride<T = any>(metadataKey: any, targets: any[]): T | undefined;
    }

    export const NestFactory: {
        create<T = any>(module: any, options?: any): Promise<T>;
    };
}

/* ------------------------ @nestjs/websockets ----------------------- */
declare module "@nestjs/websockets" {
    export function WebSocketGateway(...args: any[]): ClassDecorator;
    export function WebSocketServer(...args: any[]): PropertyDecorator;
    export function SubscribeMessage(event?: string): MethodDecorator;
    export class MessageBody { }
    export class ConnectedSocket { }

    export interface OnGatewayInit {
        afterInit(server: any): any;
    }
}

/* ------------------------ @nestjs/serve-static --------------------- */
declare module "@nestjs/serve-static" {
    export const ServeStaticModule: {
        forRoot: (...args: any[]) => any;
    };
}

/* -------------------------- @nestjs/schedule ----------------------- */
declare module "@nestjs/schedule" {
    export const ScheduleModule: {
        forRoot: (...args: any[]) => any;
    };
    export function Cron(...args: any[]): MethodDecorator;
    export const CronExpression: any;
    export const Interval: (...args: any[]) => MethodDecorator;
}

/* ------------------------------ express ---------------------------- */
declare module "express" {
    export type NextFunction = (...args: any[]) => any;

    export interface Request {
        [key: string]: any;
        user?: any;
        headers?: any;
        body?: any;
        query?: any;
        params?: any;
    }

    export interface Response {
        [key: string]: any;

        // common response helpers
        redirect(url: string, status?: number): any;
        status(code: number): this;
        json(body: any): this;
        send(body: any): this;

        // stream-ish methods so stream.pipe(res) typechecks
        write(chunk: any, encoding?: any, cb?: any): any;
        end(chunk?: any, encoding?: any, cb?: any): any;
        on(event: any, cb: any): any;
        once(event: any, cb: any): any;
        emit(event: any, ...args: any[]): any;
    }
}

/* ------------------------------- fs -------------------------------- */
declare module "fs" {
    export interface Stats {
        isDirectory(): boolean;
        size: number;
        [key: string]: any;
    }
}

/* ----------------------------- crypto ------------------------------ */
declare module "crypto" {
    export type BufferEncoding =
        | "utf8"
        | "utf-8"
        | "ascii"
        | "latin1"
        | "binary"
        | "base64"
        | "hex"
        | string;

    export interface Hash {
        update(data: any, inputEncoding?: BufferEncoding): this;
        digest(encoding: BufferEncoding): string;
    }

    export function createHash(algorithm: string): Hash;
}

/* ------------------------------ Buffer ----------------------------- */
// Make Buffer.alloc/toString exist for TS when stubs are active
declare var Buffer: {
    alloc: (size: number, fill?: any, encoding?: any) => any;
};

/* ---------------------------- bcryptjs ----------------------------- */
declare module "bcryptjs" {
    export function hash(data: string, rounds: number): Promise<string>;
    export function compare(data: string, encrypted: string): Promise<boolean>;
}

/* ------------------------------ otplib ----------------------------- */
declare module "otplib" {
    export const authenticator: {
        generateSecret(): string;
        keyuri(email: string, issuer: string, secret: string): string;
        verify(options: { token: string; secret: string }): boolean;

        // allow code to set authenticator.options
        options?: any;
    };
}

/* ------------------------------ qrcode ----------------------------- */
declare module "qrcode" {
    const QRCode: {
        toDataURL(text: string): Promise<string>;
    };
    export default QRCode;
}

/* ------------------------------ axios ------------------------------ */
declare module "axios" {
    const axios: any;
    export default axios;
}

/* ------------------------------- uuid ------------------------------ */
declare module "uuid" {
    export function v4(): string;
}
