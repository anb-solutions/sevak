// Sends Sevak's emails. EMAIL_MODE=resend sends them through Resend
// (resend.com) with RESEND_API_KEY; EMAIL_MODE=log (the default without a
// key: local development, or before email is set up) writes them to the
// server log instead, so sign-in still works there. Production refuses to
// log. To use another provider, change send() only.
export interface Email {
  to: string;
  subject: string;
  text: string;
}

function mode(): "resend" | "log" {
  const set = process.env.EMAIL_MODE?.trim();
  if (set === "resend" || set === "log") return set;
  return process.env.RESEND_API_KEY?.trim() ? "resend" : "log";
}

export async function send(email: Email): Promise<void> {
  if (mode() === "log") {
    if (process.env.SEVAK_ENV === "production") throw new Error("Production must send email: set RESEND_API_KEY.");
    console.log(`[email not sent: EMAIL_MODE=log] To: ${email.to}\nSubject: ${email.subject}\n\n${email.text}`);
    return;
  }
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("EMAIL_MODE=resend needs RESEND_API_KEY.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Sevak <notify@sevak.theanbgroup.com>",
      to: [email.to],
      subject: email.subject,
      text: email.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export function signInEmail(to: string, code: string, link: string): Email {
  return {
    to,
    subject: `${code} is your Sevak sign-in code`,
    text: [
      `Your Sevak sign-in code is ${code}`,
      "",
      "Enter it on the sign-in page, or open this link on the same device:",
      link,
      "",
      "The code and link work once, for 15 minutes.",
      "If you didn't try to sign in to Sevak, you can ignore this email.",
      "",
      "Sevak, a service of The ANB Group",
    ].join("\n"),
  };
}
