declare module "express" {
    import { IncomingMessage, ServerResponse } from "http";

    export interface Request extends IncomingMessage {
        params: Record<string, string>;
        query: Record<string, any>;
        body?: any;
        [key: string]: any;
    }

    export interface Response extends ServerResponse {
        status(code: number): this;
        json(body: any): this;
        send(body?: any): this;
    }

    export type NextFunction = (err?: any) => void;

    export type RequestHandler = (
        req: Request,
        res: Response,
        next: NextFunction,
    ) => any;

    export interface Router {
        use(...handlers: RequestHandler[]): Router;
        get(path: string, ...handlers: RequestHandler[]): Router;
        post(path: string, ...handlers: RequestHandler[]): Router;
        put(path: string, ...handlers: RequestHandler[]): Router;
        delete(path: string, ...handlers: RequestHandler[]): Router;
        patch(path: string, ...handlers: RequestHandler[]): Router;
    }

    export interface Application extends Router {
        listen(port: number, callback?: () => void): any;
    }

    export default function express(): Application;
}
