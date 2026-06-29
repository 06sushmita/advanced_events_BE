let twilioClient = null;
let usingRealSms = false;

function getClient() {
  if (twilioClient !== null) return twilioClient;

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;

  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER) {
    // Lazy require so the "twilio" package is only needed if you actually
    // configure it — it isn't installed by default to keep the base
    // install lean. Run `npm install twilio` in backend/ to enable this.
    // eslint-disable-next-line global-require
    const twilio = require("twilio");
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    usingRealSms = true;
  } else {
    twilioClient = {
      messages: {
        create: async ({ to, body }) => {
          console.log("\n--- [sms:console-fallback] ---");
          console.log(`To:   ${to}`);
          console.log(`Body: ${body}`);
          console.log("--- (set TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER in .env, then `npm install twilio`, to send real texts) ---\n");
          return { sid: "console-fallback" };
        },
      },
    };
    usingRealSms = false;
  }

  return twilioClient;
}

async function sendSms({ to, body }) {
  const client = getClient();
  return client.messages.create({
    to,
    from: process.env.TWILIO_FROM_NUMBER,
    body,
  });
}

module.exports = { sendSms, isUsingRealSms: () => usingRealSms };
