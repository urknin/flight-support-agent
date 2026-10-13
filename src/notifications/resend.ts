/**
 * Resend Email Dispatcher for Cloudflare Workers
 * Uses native fetch() to send transactional emails via Resend REST API.
 */
export async function sendResendEmail(
  apiKey: string,
  toEmail: string,
  subject: string,
  htmlContent: string
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Flight Support <onboarding@resend.dev>",
        to: [toEmail],
        subject: subject,
        html: htmlContent,
      }),
    });

    const data: any = await response.json();

    if (!response.ok) {
      return { success: false, error: data?.message || `HTTP ${response.status}` };
    }

    return { success: true, id: data?.id };
  } catch (err: any) {
    return { success: false, error: err?.message || "Resend network error." };
  }
}
