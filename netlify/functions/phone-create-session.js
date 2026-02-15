\
const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    const { datasetId } = JSON.parse(event.body || "{}");
    const sessionId = crypto.randomBytes(4).toString("hex").toUpperCase(); // short code
    const store = getStore("phone_sessions");
    await store.setJSON(sessionId, { datasetId: datasetId || "", text: "", createdAt: Date.now() }, { ttl: 60 * 15 }); // 15 minutes
    return { statusCode: 200, body: JSON.stringify({ sessionId }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || "Failed" }) };
  }
};
