\
const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    const sessionId = event.queryStringParameters?.sessionId;
    if (!sessionId) return { statusCode: 400, body: JSON.stringify({ error: "Missing sessionId" }) };

    const store = getStore("phone_sessions");
    const existing = await store.getJSON(sessionId);
    if (!existing) return { statusCode: 404, body: JSON.stringify({ error: "Session not found (expired?)" }) };

    return { statusCode: 200, body: JSON.stringify({ text: existing.text || "" }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || "Failed" }) };
  }
};
