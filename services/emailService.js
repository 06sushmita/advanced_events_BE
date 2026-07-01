const nodemailer = require("nodemailer");

let transporter = null;
let usingRealSmtp = false;

function getTransporter() {
  if (transporter) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    usingRealSmtp = true;
  } else {
    // No SMTP configured — fall back to logging the email to the
    // console so the feature is fully visible and testable with zero
    // setup. Drop real SMTP credentials into .env at any time and
    // this starts sending for real with no code changes.
    transporter = {
      sendMail: async (options) => {
        console.log("\n--- [email:console-fallback] ---");
        console.log(`To:      ${options.to}`);
        console.log(`Subject: ${options.subject}`);
        if (options.html) console.log("[HTML body present]");
        if (options.attachments?.length) console.log(`Attachments: ${options.attachments.map((a) => a.filename).join(", ")}`);
        console.log(options.text || "");
        console.log("--- (set SMTP_HOST/SMTP_USER/SMTP_PASS in .env to send real emails) ---\n");
        return { accepted: [options.to] };
      },
    };
    usingRealSmtp = false;
  }

  return transporter;
}

async function sendEmail({ to, subject, text, html, attachments }) {
  const tx = getTransporter();
  return tx.sendMail({
    from: process.env.FROM_EMAIL || "no-reply@eventdesk.local",
    to,
    subject,
    text,
    ...(html && { html }),
    ...(attachments && { attachments }),
  });
}

module.exports = { sendEmail, isUsingRealSmtp: () => usingRealSmtp };
