\
const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    const { sessionId, text } = JSON.parse(event.body || "{}");
    if (!sessionId || !text) return { statusCode: 400, body: JSON.stringify({ error: "Missing sessionId or text" }) };

    const store = getStore("phone_sessions");
    const existing = await store.getJSON(sessionId);
    if (!existing) return { statusCode: 404, body: JSON.stringify({ error: "Session not found (expired?)" }) };

    existing.text = String(text);
    existing.updatedAt = Date.now();
    await store.setJSON(sessionId, existing, { ttl: 60 * 15 }); // extend
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || "Failed" }) };
  }
};
