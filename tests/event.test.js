const test = require("node:test");
const assert = require("node:assert");
const eventRoutes = require("../routes/eventRoutes");
const validateEventDates = eventRoutes.validateEventDates;

test("validateEventDates accepts valid future datetime", (t) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const result = validateEventDates(tomorrow.toISOString(), null);
  assert.strictEqual(result.valid, true);
});

test("validateEventDates rejects past datetime", (t) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  const result = validateEventDates(yesterday.toISOString(), null);
  assert.strictEqual(result.valid, false);
  assert.match(result.message, /cannot be in the past/);
});

test("validateEventDates rejects far-future datetime", (t) => {
  const result = validateEventDates("2150-01-01T00:00:00.000Z", null);
  assert.strictEqual(result.valid, false);
  assert.match(result.message, /too far in the future/);
});

test("validateEventDates rejects deadline after datetime", (t) => {
  const eventTime = new Date();
  eventTime.setDate(eventTime.getDate() + 2);
  const deadlineTime = new Date();
  deadlineTime.setDate(deadlineTime.getDate() + 3);

  const result = validateEventDates(eventTime.toISOString(), deadlineTime.toISOString());
  assert.strictEqual(result.valid, false);
  assert.match(result.message, /cannot be after the event date/);
});

test("validateEventDates accepts deadline before datetime", (t) => {
  const eventTime = new Date();
  eventTime.setDate(eventTime.getDate() + 3);
  const deadlineTime = new Date();
  deadlineTime.setDate(deadlineTime.getDate() + 1);

  const result = validateEventDates(eventTime.toISOString(), deadlineTime.toISOString());
  assert.strictEqual(result.valid, true);
});
