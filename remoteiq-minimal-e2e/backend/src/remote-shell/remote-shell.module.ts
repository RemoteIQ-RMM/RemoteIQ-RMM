// remoteiq-minimal-e2e/backend/src/remote-shell/remote-shell.module.ts
import { Module } from "@nestjs/common";
import { RemoteShellGateway } from "./remote-shell.gateway";

@Module({
    providers: [RemoteShellGateway],
})
export class RemoteShellModule { }
