import { Controller, Get, Query } from "@nestjs/common";
import { SmtpService } from "../smtp/smtp.service";
import { Public } from "../auth/public.decorator";

@Public()
@Controller("healthz")
export class EmailHealthController {
    constructor(private svc: SmtpService) { }

    @Get("email")
    async email(@Query("purpose") purpose = "alerts") {
        const [smtp, imap] = await Promise.all([
            this.svc.smtpHealth(purpose as any),
            this.svc.imapHealth(purpose as any),
        ]);
        return { smtp, imap };
    }
}
