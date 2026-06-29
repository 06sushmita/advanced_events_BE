const cron = require("node-cron");
const bookingModel = require("../models/bookingModel");
const { sendReminder } = require("./notificationService");
const { emitEvent } = require("../socket");

const LOOKAHEAD_MINUTES = Number(process.env.REMINDER_LOOKAHEAD_MINUTES) || 60;

async function runReminderSweep() {
  try {
    const now = new Date();
    const horizon = new Date(now.getTime() + LOOKAHEAD_MINUTES * 60 * 1000);
    const due = await bookingModel.getBookingsDueForReminder(now, horizon);

    for (const booking of due) {
      await sendReminder(booking);
      await bookingModel.markReminderSent(booking._id);
      emitEvent("booking:reminder", booking);
    }

    if (due.length > 0) {
      console.log(`Sent ${due.length} reminder(s).`);
    }
  } catch (err) {
    console.error("Reminder sweep failed:", err.message);
  }
}

/** Checks every 5 minutes for bookings starting within the lookahead window. */
function startReminderJob() {
  cron.schedule("*/5 * * * *", runReminderSweep);
  console.log(`Reminder job scheduled (every 5 min, ${LOOKAHEAD_MINUTES}-minute lookahead).`);
}

module.exports = { startReminderJob, runReminderSweep };
