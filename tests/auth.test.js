const test = require("node:test");
const assert = require("node:assert");
const { requireRole } = require("../middleware/auth");

test("auth middleware requireRole allows correct roles", (t) => {
  const middleware = requireRole("admin", "organizer");
  
  let nextCalled = false;
  const req = { user: { role: "organizer" } };
  const res = {};
  const next = () => { nextCalled = true; };

  middleware(req, res, next);
  assert.strictEqual(nextCalled, true);
});

test("auth middleware requireRole denies incorrect roles", (t) => {
  const middleware = requireRole("admin", "organizer");
  
  let nextCalled = false;
  let statusSet = null;
  let responseSent = null;

  const req = { user: { role: "participant" } };
  const res = {
    status(code) {
      statusSet = code;
      return this;
    },
    json(data) {
      responseSent = data;
      return this;
    }
  };
  const next = () => { nextCalled = true; };

  middleware(req, res, next);
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(statusSet, 403);
  assert.strictEqual(responseSent.success, false);
});
