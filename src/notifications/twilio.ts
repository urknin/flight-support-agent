/**
 * Twilio SMS Dispatcher for Cloudflare Workers
 * Uses native fetch() without third-party SDK dependencies.
 * Solves Hole #5: Catching Twilio trial unverified number error 21608.
 */
export async function sendTwilioSms(
  accountSid: string,
  authToken: string,
  fromPhone: string,
  toPhone: string,
  message: string
): Promise<{ success: boolean; sid?: string; isTrialRestricted?: boolean; error?: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const credentials = btoa(`${accountSid}:${authToken}`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: toPhone,
        From: fromPhone,
        Body: message,
      }),
    });

    const data: any = await response.json();

    if (!response.ok) {
      // Catch Twilio Trial error 21608: The number is unverified
      if (data?.code === 21608) {
        console.warn(`[Twilio Trial] Recipient ${toPhone} is unverified. Gracefully routing to In-App Drawer.`);
        return {
          success: false,
          isTrialRestricted: true,
          error: "Twilio Trial Restriction: Recipient number is not verified on your Twilio account.",
        };
      }
      return { success: false, error: data?.message || `HTTP ${response.status}` };
    }

    return { success: true, sid: data?.sid };
  } catch (err: any) {
    return { success: false, error: err?.message || "Twilio network error." };
  }
}
