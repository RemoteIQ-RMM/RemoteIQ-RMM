import { Injectable, BadRequestException } from "@nestjs/common";
import * as cronParser from "cron-parser"; // namespace import works across CJS/ESM builds

@Injectable()
export class CronPreviewService {
    nextRuns(expr: string, tz: string, count = 5): string[] {
        try {
            const parse = (cronParser as any).parseExpression as
                | ((e: string, o?: any) => any)
                | undefined;

            if (typeof parse !== "function") {
                throw new Error("cron-parser: parseExpression is not available");
            }

            const interval = parse(expr, { tz });
            const out: string[] = [];
            for (let i = 0; i < count; i++) {
                const d = interval.next().toDate();
                out.push(
                    d.toLocaleString("en-US", {
                        timeZone: tz,
                        weekday: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                    })
                );
            }
            return out;
        } catch (e: any) {
            throw new BadRequestException(e?.message ?? "Invalid cron");
        }
    }
}
