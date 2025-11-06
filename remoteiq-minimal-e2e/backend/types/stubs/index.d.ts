declare module "class-validator" {
    export type ValidationOptions = any;
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
    export function ArrayUnique(options?: ValidationOptions): PropertyDecorator;
    export function IsISO8601(options?: ValidationOptions): PropertyDecorator;
    export function IsIn(values: any[], options?: ValidationOptions): PropertyDecorator;
    export function IsObject(options?: ValidationOptions): PropertyDecorator;
    export function IsDefined(options?: ValidationOptions): PropertyDecorator;
    export function Min(minValue: number, options?: ValidationOptions): PropertyDecorator;
    export function Max(maxValue: number, options?: ValidationOptions): PropertyDecorator;
    export function MinLength(len: number, options?: ValidationOptions): PropertyDecorator;
    export function MaxLength(len: number, options?: ValidationOptions): PropertyDecorator;
    export function Length(min: number, max?: number, options?: ValidationOptions): PropertyDecorator;
    export function Matches(pattern: RegExp | string, options?: ValidationOptions): PropertyDecorator;
    export function ValidateIf(condition: (o: any) => boolean, options?: ValidationOptions): PropertyDecorator;
    export function IsNumber(options?: ValidationOptions): PropertyDecorator;
    export function IsPositive(options?: ValidationOptions): PropertyDecorator;
    export function IsDate(options?: ValidationOptions): PropertyDecorator;
    export function IsPhoneNumber(region?: string, options?: ValidationOptions): PropertyDecorator;
    export function IsLowercase(options?: ValidationOptions): PropertyDecorator;
    export function IsUrl(options?: ValidationOptions): PropertyDecorator;
    export function IsJSON(options?: ValidationOptions): PropertyDecorator;
    export function validateOrReject(instance: any, options?: any): Promise<void>;
}

declare module "class-transformer" {
    export function Type(...args: any[]): PropertyDecorator;
    export function Transform(...args: any[]): PropertyDecorator;
    export function Expose(...args: any[]): PropertyDecorator;
    export function Exclude(...args: any[]): ClassDecorator;
    export function plainToInstance<T>(cls: new (...args: any[]) => T, plain: any): T;
}

declare module "@nestjs/serve-static" {
    export const ServeStaticModule: {
        forRoot: (...args: any[]) => any;
    };
}

declare module "@nestjs/schedule" {
    export const ScheduleModule: {
        forRoot: (...args: any[]) => any;
    };
    export function Cron(...args: any[]): MethodDecorator;
    export const CronExpression: any;
    export const Interval: (...args: any[]) => MethodDecorator;
}

declare module "@nestjs/swagger" {
    export function ApiTags(...tags: string[]): ClassDecorator;
    export function ApiOkResponse(options?: any): MethodDecorator;
    export function ApiProperty(options?: any): PropertyDecorator;
    export function ApiPropertyOptional(options?: any): PropertyDecorator;
    export function ApiBearerAuth(...args: any[]): ClassDecorator;
}

declare module "@nestjs/core" {
    export class Reflector {
        get<T = any>(metadataKey: any, target: any): T;
    }
}

declare module "@nestjs/websockets" {
    export function WebSocketGateway(...args: any[]): ClassDecorator;
    export function WebSocketServer(...args: any[]): PropertyDecorator;
    export function SubscribeMessage(event?: string): MethodDecorator;
    export class MessageBody {}
    export class ConnectedSocket {}
}

declare module "bcryptjs" {
    export function hash(data: string, rounds: number): Promise<string>;
    export function compare(data: string, encrypted: string): Promise<boolean>;
}

declare module "otplib" {
    export const authenticator: {
        generateSecret(): string;
        keyuri(email: string, issuer: string, secret: string): string;
        verify(options: { token: string; secret: string }): boolean;
    };
}

declare module "qrcode" {
    const QRCode: {
        toDataURL(text: string): Promise<string>;
    };
    export default QRCode;
}

declare module "axios" {
    const axios: any;
    export default axios;
}

declare module "uuid" {
    export function v4(): string;
}

