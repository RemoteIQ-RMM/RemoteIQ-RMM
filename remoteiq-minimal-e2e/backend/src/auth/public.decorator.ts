import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "remoteiq:isPublic";


/**
 * Mark a route/controller as publicly accessible (bypass GlobalAuthGuard).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
