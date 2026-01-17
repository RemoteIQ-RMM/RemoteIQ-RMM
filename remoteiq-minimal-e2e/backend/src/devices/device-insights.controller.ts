// src/devices/device-insights.controller.ts
import { Controller, Get, Param } from "@nestjs/common";
import { RequirePerm } from "../auth/require-perm.decorator";

type CheckStatus = "Passing" | "Warning" | "Failing";

export type DeviceCheck = {
    id: string;
    name: string;
    status: CheckStatus;
    lastRun: string; // ISO or humanized
    output: string;
};

export type DeviceSoftware = {
    id: string;
    name: string;
    version: string;
    publisher?: string | null;
    installDate?: string | null; // ISO
};

@Controller("/api/devices/:id")
export class DeviceInsightsController {
    @Get("checks")
    @RequirePerm("devices.read")
    async getChecks(@Param("id") deviceId: string): Promise<{ items: DeviceCheck[] }> {
        const now = new Date();
        const items: DeviceCheck[] = [
            { id: "chk-1", name: "Ping", status: "Passing", lastRun: new Date(now.getTime() - 60_000).toISOString(), output: "8.8.8.8: 12ms" },
            { id: "chk-2", name: "Disk C:\\ free", status: "Passing", lastRun: new Date(now.getTime() - 5 * 60_000).toISOString(), output: "375GB free of 500GB" },
            { id: "chk-3", name: "CPU Load (5m)", status: "Warning", lastRun: new Date(now.getTime() - 90_000).toISOString(), output: "85% avg (5m)" },
            { id: "chk-4", name: "Spooler service", status: "Passing", lastRun: new Date(now.getTime() - 10 * 60_000).toISOString(), output: "Running" },
            { id: "chk-5", name: "AV Definitions", status: "Failing", lastRun: new Date(now.getTime() - 2 * 60 * 60_000).toISOString(), output: "Out of date (10 days)" },
        ];
        void deviceId;
        return { items };
    }

    @Get("software")
    @RequirePerm("devices.read")
    async getSoftware(@Param("id") deviceId: string): Promise<{ items: DeviceSoftware[] }> {
        const items: DeviceSoftware[] = [
            { id: "sw-1", name: "Google Chrome", version: "128.0.0", publisher: "Google LLC", installDate: "2024-06-02" },
            { id: "sw-2", name: "Visual Studio Code", version: "1.94.2", publisher: "Microsoft", installDate: "2024-05-28" },
            { id: "sw-3", name: "7-Zip", version: "24.07", publisher: "Igor Pavlov", installDate: "2024-05-11" },
            { id: "sw-4", name: "Node.js", version: "20.14.0", publisher: "OpenJS Foundation", installDate: "2024-04-20" },
        ];
        void deviceId;
        return { items };
    }
}
