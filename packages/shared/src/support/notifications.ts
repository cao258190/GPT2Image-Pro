import { getRuntimePublicAppUrl } from "../runtime-app-url-server";
import { getRuntimeSettingString } from "../system-settings";
import { sendEmail } from "../mail/utils";
import { SupportTicketNotificationEmail } from "../mail/templates";
import { logError, logger } from "../logger";
import { ticketCategories, ticketPriorities } from "./schemas";

type TicketNotificationType = "created" | "user_reply";

interface TicketNotificationInput {
  type: TicketNotificationType;
  ticketId: string;
  subject: string;
  category: string;
  priority: string;
  message: string;
  userName?: string | null;
  userEmail?: string | null;
}

function parseRecipients(value?: string) {
  return (value ?? "")
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function truncatePreview(value: string, maxLength = 600) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

function optionLabel(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string
) {
  return options.find((option) => option.value === value)?.label ?? value;
}

async function getTicketUrl(ticketId: string) {
  const baseUrl = await getRuntimePublicAppUrl();
  return `${baseUrl}/dashboard/support/${ticketId}`;
}

export async function sendTicketAdminNotification(
  input: TicketNotificationInput
) {
  const recipients = parseRecipients(
    await getRuntimeSettingString("SUPPORT_TICKET_NOTIFICATION_EMAIL")
  );
  if (recipients.length === 0) return;

  const title =
    input.type === "created" ? "有新的用户工单" : "用户追加了工单回复";
  const ticketUrl = await getTicketUrl(input.ticketId);

  try {
    const result = await sendEmail({
      to: recipients,
      subject: `[GPT2IMAGE] ${title}: ${input.subject}`,
      react: SupportTicketNotificationEmail({
        title,
        subject: input.subject,
        ticketUrl,
        userName: input.userName,
        userEmail: input.userEmail,
        category: optionLabel(ticketCategories, input.category),
        priority: optionLabel(ticketPriorities, input.priority),
        messagePreview: truncatePreview(input.message),
      }),
      ...(input.userEmail ? { replyTo: input.userEmail } : {}),
    });

    if (!result.success) {
      logger.warn(
        {
          ticketId: input.ticketId,
          recipients,
          error: result.error,
        },
        "Failed to send support ticket notification email"
      );
    }
  } catch (error) {
    logError(error, {
      source: "support-ticket-notification",
      ticketId: input.ticketId,
    });
  }
}
