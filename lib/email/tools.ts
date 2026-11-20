import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ApprovalHandler } from "@/lib/approvals/types";
import {
  SmtpConfigError,
  normalizeEmailRequest,
  smtpConfigFromEnv,
  type EmailRequest,
  type SmtpConfig,
} from "./config";
import { sendSmtpEmail, type SendEmailResult } from "./sender";

export interface EmailToolDependencies {
  onApproval?: ApprovalHandler;
  config?: SmtpConfig;
  send?: (request: EmailRequest, config: SmtpConfig) => Promise<SendEmailResult>;
}

function validationError(error: unknown): SendEmailResult {
  if (error instanceof SmtpConfigError) return { ok: false, error: error.message };
  return { ok: false, error: "邮件参数无效，请检查收件人和内容后重试。" };
}

export async function handleSendEmail(
  request: EmailRequest,
  deps: EmailToolDependencies = {},
): Promise<SendEmailResult> {
  let config: SmtpConfig;
  try {
    config = deps.config ?? smtpConfigFromEnv();
    normalizeEmailRequest(request, config);
  } catch (error) {
    return validationError(error);
  }

  if (!deps.onApproval) {
    return {
      ok: false,
      error: "发送邮件需要用户批准，请用 create_task 创建后台任务并提供完整的收件人、主题和正文。",
    };
  }

  const decision = await deps.onApproval({
    tool: "SMTP_SEND_EMAIL",
    args: { ...request },
    calls: [{ tool: "SMTP_SEND_EMAIL", args: { ...request } }],
    reasons: ["这封邮件将通过 SMTP 发送给最终收件人。"],
  });
  if (!decision.approved) return { ok: false, error: decision.reason };

  const approved = decision.args as unknown as EmailRequest;
  try {
    normalizeEmailRequest(approved, config);
  } catch (error) {
    return validationError(error);
  }
  return (deps.send ?? sendSmtpEmail)(approved, config);
}

export function emailTools(options: { onApproval?: ApprovalHandler } = {}): ToolSet {
  return {
    send_email: tool({
      description:
        "通过 SMTP 发送一封纯文本邮件。聊天中不会直接发送；必须创建后台任务，并在用户批准后才能发送。",
      inputSchema: z.object({
        to: z.string().min(3).max(2000).describe("收件人，多个地址用英文逗号分隔"),
        cc: z.string().max(2000).optional().describe("抄送，可选"),
        bcc: z.string().max(2000).optional().describe("密送，可选"),
        subject: z.string().min(1).max(200).describe("邮件主题"),
        text: z.string().min(1).max(20_000).describe("邮件的纯文本正文"),
      }),
      execute: (request) => handleSendEmail(request, options),
    }),
  };
}
