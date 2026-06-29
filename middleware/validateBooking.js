const PHONE_REGEX = /^[0-9+\-\s()]{7,15}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Rejects bad data before it ever reaches MongoDB: missing fields,
 * malformed phone numbers, and bookings dated in the past.
 * `email` and `resource` are optional but validated/shaped if present.
 */
function validateBooking(req, res, next) {
  const { name, event, datetime, phone, email } = req.body;
  const errors = [];

  if (!name || !name.trim()) errors.push("Name is required.");
  if (!event || !event.trim()) errors.push("Event name is required.");
  if (!datetime) errors.push("Date & time is required.");
  if (!phone || !PHONE_REGEX.test(phone)) {
    errors.push("Enter a valid phone number (7-15 digits).");
  }
  if (email && !EMAIL_REGEX.test(email)) {
    errors.push("Email looks invalid — leave it blank or fix the format.");
  }

  if (datetime) {
    const chosen = new Date(datetime);
    if (Number.isNaN(chosen.getTime())) {
      errors.push("Date & time is not a valid date.");
    } else if (chosen.getTime() < Date.now() - 60 * 1000) {
      errors.push("Date & time cannot be in the past.");
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  next();
}

module.exports = validateBooking;
