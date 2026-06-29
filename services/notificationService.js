const { sendEmail } = require("./emailService");
const { sendSms } = require("./smsService");

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

module.exports = { sendBookingConfirmation, sendStatusUpdate, sendReminder };
