// Web dashboard lives in core/adminPlugin.js (registered by core/api/server.js).
// load() registers the /mod infractions + moderation command (moderation.js).
module.exports = { load: (ctx) => require("./moderation").register(ctx) };
