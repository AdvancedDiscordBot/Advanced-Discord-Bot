function createLogger(namespace) {
	const prefix = namespace ? `[${namespace}]` : "[adb]";

	return {
		info(message, meta) {
			console.log(prefix, message, meta || "");
		},
		warn(message, meta) {
			console.warn(prefix, message, meta || "");
		},
		error(message, meta) {
			console.error(prefix, message, meta || "");
		},
		debug(message, meta) {
			if (process.env.DEBUG) {
				console.debug(prefix, message, meta || "");
			}
		},
	};
}

module.exports = { createLogger };
