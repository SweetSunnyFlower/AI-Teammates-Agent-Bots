import { smtpConfigFromEnv } from "../lib/email/config";
import { createSmtpTransport, verifySmtp } from "../lib/email/sender";

const config = smtpConfigFromEnv();
await verifySmtp(createSmtpTransport(config));
console.log("SMTP 连接验证成功，未发送邮件。");
