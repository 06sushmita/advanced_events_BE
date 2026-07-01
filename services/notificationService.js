const { sendEmail } = require("./emailService");
const { sendSms } = require("./smsService");
const QRCode = require("qrcode");
const jwt = require("jsonwebtoken");

const fmt = (datetime) => (datetime ? datetime.replace("T", " ") : "");

/** Sends through whichever channel the booking actually gave us. Both, if both exist. */
async function notify(booking, { subject, body }) {
  const tasks = [];

  if (booking.email) {
    tasks.push(sendEmail({ to: booking.email, subject, text: body }));
  }
  if (booking.phone) {
    tasks.push(sendSms({ to: booking.phone, body: `${subject}\n${body}` }));
  }

  const results = await Promise.allSettled(tasks);
  results.forEach((r) => {
    if (r.status === "rejected") console.error("Notification failed:", r.reason?.message || r.reason);
  });
}

async function sendBookingConfirmation(booking) {
  await notify(booking, {
    subject: `Booking received: ${booking.event}`,
    body: `Hi ${booking.name}, your booking for "${booking.event}" on ${fmt(booking.datetime)} is currently ${booking.status}.`,
  });
}

async function sendStatusUpdate(booking) {
  await notify(booking, {
    subject: `Booking ${booking.status}: ${booking.event}`,
    body: `Hi ${booking.name}, your booking for "${booking.event}" on ${fmt(booking.datetime)} is now ${booking.status}.`,
  });
}

async function sendReminder(booking) {
  await notify(booking, {
    subject: `Reminder: ${booking.event} starts soon`,
    body: `Hi ${booking.name}, "${booking.event}" starts at ${fmt(booking.datetime)}.`,
  });
}

/**
 * Generates a QR code check-in ticket and emails it to the registered user.
 * @param {{ id: string, name: string, email: string }} user
 * @param {{ _id: string, title: string, datetime: string, location: string }} event
 */
async function sendRegistrationConfirmation(user, event) {
  if (!user.email) return;

  // Generate a signed check-in JWT (24 h validity)
  const token = jwt.sign(
    { userId: user.id || user._id.toString(), eventId: event._id.toString(), type: "checkin" },
    process.env.JWT_SECRET,
    { expiresIn: "24h" }
  );

  // Generate QR code as PNG buffer
  const qrBuffer = await QRCode.toBuffer(token, {
    errorCorrectionLevel: "H",
    width: 300,
    margin: 2,
    color: { dark: "#1a1a2e", light: "#ffffff" },
  });

  const eventDate = event.datetime
    ? new Date(event.datetime).toLocaleString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "TBA";

  const subject = `🎟️ Your ticket for "${event.title}"`;

  const text = `Hi ${user.name},\n\nYou are successfully registered for "${event.title}".\n\nDate: ${eventDate}\nLocation: ${event.location || "TBA"}\n\nYour check-in QR code is attached to this email. Please show it at the entrance for instant check-in.\n\nSee you there!\n— EventDesk`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Your EventDesk Ticket</title>
</head>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f1a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:24px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6d35f7,#9c40e8);padding:28px 36px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">EventDesk</span>
                    <div style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:4px;">Your Event Ticket</div>
                  </td>
                  <td align="right">
                    <span style="background:rgba(255,255,255,0.18);color:#fff;font-size:11px;font-weight:700;letter-spacing:1.5px;padding:5px 12px;border-radius:20px;text-transform:uppercase;">Confirmed</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 36px;">
              <p style="margin:0 0 6px 0;color:rgba(255,255,255,0.55);font-size:12px;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;">Hi ${user.name},</p>
              <h1 style="margin:0 0 24px 0;color:#ffffff;font-size:24px;font-weight:800;line-height:1.3;">${event.title}</h1>

              <!-- Event Details -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td width="50%" style="padding:0 8px 8px 0;">
                    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px 16px;">
                      <div style="color:rgba(255,255,255,0.4);font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:4px;">📅 Date & Time</div>
                      <div style="color:#ffffff;font-size:13px;font-weight:600;">${eventDate}</div>
                    </div>
                  </td>
                  <td width="50%" style="padding:0 0 8px 8px;">
                    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px 16px;">
                      <div style="color:rgba(255,255,255,0.4);font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:4px;">📍 Location</div>
                      <div style="color:#ffffff;font-size:13px;font-weight:600;">${event.location || "TBA"}</div>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- QR Code -->
              <div style="text-align:center;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:28px;">
                <p style="margin:0 0 16px 0;color:rgba(255,255,255,0.55);font-size:12px;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;">Your Check-In QR Code</p>
                <img src="cid:qrticket" alt="QR Code" width="200" style="display:block;margin:0 auto;border-radius:12px;background:#ffffff;padding:10px;"/>
                <p style="margin:16px 0 0 0;color:rgba(255,255,255,0.4);font-size:11px;">Show this QR code at the entrance for instant check-in</p>
              </div>
            </td>
          </tr>
          <!-- Dashed tear line -->
          <tr>
            <td style="padding:0 36px;">
              <div style="border-top:2px dashed rgba(255,255,255,0.12);"></div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 36px 28px;">
              <p style="margin:0;color:rgba(255,255,255,0.3);font-size:11px;text-align:center;">
                This ticket was sent by EventDesk. Do not share your QR code with others — it is unique to your registration.<br/>
                <span style="color:rgba(255,255,255,0.2);">© 2026 EventDesk</span>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await sendEmail({
    to: user.email,
    subject,
    text,
    html,
    attachments: [
      {
        filename: `ticket-${event.title.replace(/\s+/g, "-").toLowerCase()}.png`,
        content: qrBuffer,
        cid: "qrticket",
        contentType: "image/png",
      },
    ],
  });
}

module.exports = { sendBookingConfirmation, sendStatusUpdate, sendReminder, sendRegistrationConfirmation };
