import {
    Body,
    Controller,
    Get,
    HttpCode,
    Post,
    UsePipes,
    ValidationPipe,
} from "@nestjs/common";
import { DatabaseConfigDto, TestResultDto } from "./database.dto";
import { DatabaseService } from "./database.service";
import { RequirePerm } from "../auth/require-perm.decorator";

@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@Controller("/api/admin/database")
export class DatabaseController {
    constructor(private readonly svc: DatabaseService) { }

    /**
     * IMPORTANT: Never return secrets (passwords / credentialed URLs).
     */
    @Get()
    @RequirePerm("settings.read")
    async getConfig(): Promise<DatabaseConfigDto | { enabled: false }> {
        const cfg = this.svc.getConfig() ?? (await this.svc.loadConfig());
        if (!cfg) return { enabled: false } as any;
        return this.svc.sanitizeForClient(cfg) as any;
    }

    @Post("test")
    @HttpCode(200)
    @RequirePerm("settings.write")
    async test(@Body() body: DatabaseConfigDto): Promise<TestResultDto> {
        return this.svc.testConnection(body);
    }

    @Post("save")
    @HttpCode(204)
    @RequirePerm("settings.write")
    async save(@Body() body: DatabaseConfigDto): Promise<void> {
        // Persist with safe "preserve existing secrets if not provided" behavior
        await this.svc.saveConfig(body);
    }

    // Stub endpoint your UI can call for the "Dry-run migration" button
    @Post("migrate/dry-run")
    @RequirePerm("settings.read")
    async dryRun(): Promise<{ ok: true; destructive: false; steps: string[] }> {
        return {
            ok: true,
            destructive: false,
            steps: [
                "Verify connectivity to primary",
                "Check presence of required tables/collections",
                "Plan non-destructive CREATEs/INDEXes if missing",
            ],
        };
    }
}
