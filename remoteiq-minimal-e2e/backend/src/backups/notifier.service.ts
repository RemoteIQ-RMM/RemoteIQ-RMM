import { Injectable, Logger } from "@nestjs/common";
import nodemailer from "nodemailer";
import axios from "axios";

type Channels = { email?: boolean; slack?: boolean; webhook?: boolean };

@Injectable()
export class NotifierService {
    private log = new Logger("BackupsNotifier");

    async send(channels: Channels, subject: string, body: string) {
        const promises: Promise<any>[] = [];
        if (channels.email) promises.push(this.sendEmail(subject, body));
        if (channels.slack) promises.push(this.sendSlack(body));
        if (channels.webhook) promises.push(this.sendWebhook({ subject, body }));
        await Promise.allSettled(promises);
    }

    private async sendEmail(subject: string, body: string) {
        const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_TO } = process.env as any;
        if (!SMTP_HOST || !SMTP_FROM || !SMTP_TO) return;
        const transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: Number(SMTP_PORT ?? 587),
            secure: String(SMTP_SECURE ?? "false") === "true",
            auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
        });
        await transporter.sendMail({
            from: SMTP_FROM,
            to: SMTP_TO,
            subject,
            text: body,
        });
    }

    private async sendSlack(text: string) {
        const url = process.env.SLACK_WEBHOOK_URL;
        if (!url) return;
        await axios.post(url, { text });
    }

    private async sendWebhook(payload: any) {
        const url = process.env.BACKUPS_WEBHOOK_URL;
        if (!url) return;
        await axios.post(url, payload, { timeout: 5000 });
    }
}
