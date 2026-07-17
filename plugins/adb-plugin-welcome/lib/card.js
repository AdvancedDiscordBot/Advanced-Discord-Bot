const { createCanvas, loadImage } = require("@napi-rs/canvas");

/**
 * Generates a welcome or goodbye image card.
 * @param {object} options
 * @param {string} options.avatarUrl - URL to the user's avatar.
 * @param {string} options.username - The username of the member.
 * @param {string} [options.serverIconUrl] - URL to the guild icon.
 * @param {string} [options.serverName] - The name of the guild.
 * @param {number} [options.memberCount] - Member count of the guild.
 * @param {boolean} [options.isWelcome] - Whether this is a welcome card (true) or goodbye card (false).
 * @returns {Promise<Buffer>} The generated image buffer.
 */
async function generateWelcomeCard({
	avatarUrl,
	username,
	serverIconUrl,
	serverName,
	memberCount,
	isWelcome = true,
}) {
	const width = 1024;
	const height = 450;
	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext("2d");

	// 1. Draw Background Gradient
	const bgGrad = ctx.createLinearGradient(0, 0, width, height);
	if (isWelcome) {
		bgGrad.addColorStop(0, "#0f172a"); // slate-900
		bgGrad.addColorStop(0.5, "#1e1b4b"); // indigo-950
		bgGrad.addColorStop(1, "#311042"); // purple-950
	} else {
		bgGrad.addColorStop(0, "#0f172a"); // slate-900
		bgGrad.addColorStop(0.5, "#450a0a"); // red-950
		bgGrad.addColorStop(1, "#18000a"); // dark red/black
	}
	ctx.fillStyle = bgGrad;
	ctx.fillRect(0, 0, width, height);

	// 2. Draw modern diagonal design lines with low opacity
	ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
	ctx.lineWidth = 20;
	for (let i = -width; i < width * 2; i += 80) {
		ctx.beginPath();
		ctx.moveTo(i, 0);
		ctx.lineTo(i + height, height);
		ctx.stroke();
	}

	// 3. Draw a sleek Glassmorphism Panel
	ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
	ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
	ctx.lineWidth = 2;
	const margin = 24;
	const rx = margin;
	const ry = margin;
	const rw = width - margin * 2;
	const rh = height - margin * 2;
	const radius = 24;

	ctx.beginPath();
	ctx.roundRect(rx, ry, rw, rh, radius);
	ctx.fill();
	ctx.stroke();

	// 4. Draw Avatar
	const avatarX = 160;
	const avatarY = height / 2;
	const avatarRadius = 100;

	// Draw Avatar Outer Ring/Glow
	const ringGrad = ctx.createLinearGradient(
		avatarX - avatarRadius,
		avatarY - avatarRadius,
		avatarX + avatarRadius,
		avatarY + avatarRadius,
	);
	if (isWelcome) {
		ringGrad.addColorStop(0, "#818cf8"); // indigo-400
		ringGrad.addColorStop(1, "#c084fc"); // purple-400
	} else {
		ringGrad.addColorStop(0, "#f87171"); // red-400
		ringGrad.addColorStop(1, "#fb923c"); // orange-400
	}

	ctx.shadowColor = isWelcome ? "rgba(129, 140, 248, 0.4)" : "rgba(248, 113, 113, 0.4)";
	ctx.shadowBlur = 15;
	ctx.strokeStyle = ringGrad;
	ctx.lineWidth = 6;
	ctx.beginPath();
	ctx.arc(avatarX, avatarY, avatarRadius + 4, 0, Math.PI * 2);
	ctx.stroke();
	ctx.shadowBlur = 0; // Reset shadow

	// Load and Draw Avatar Image
	let avatarImg;
	try {
		if (avatarUrl) {
			avatarImg = await loadImage(avatarUrl);
		}
	} catch (err) {
		console.error("Failed to load avatar image, using fallback", err);
	}

	ctx.save();
	ctx.beginPath();
	ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
	ctx.clip();

	if (avatarImg) {
		ctx.drawImage(avatarImg, avatarX - avatarRadius, avatarY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
	} else {
		// Fallback Avatar drawing (Circle + Initial)
		ctx.fillStyle = isWelcome ? "#4f46e5" : "#dc2626";
		ctx.fillRect(avatarX - avatarRadius, avatarY - avatarRadius, avatarRadius * 2, avatarRadius * 2);

		ctx.fillStyle = "#ffffff";
		ctx.font = 'bold 80px "Inter", "Segoe UI", sans-serif';
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		const initial = username ? username.charAt(0).toUpperCase() : "?";
		ctx.fillText(initial, avatarX, avatarY);
	}
	ctx.restore();

	// 5. Draw Server Badge (Icon + Server Name) in top-right
	const badgeX = width - 50;
	const badgeY = 60;

	let serverIconImg;
	if (serverIconUrl) {
		try {
			serverIconImg = await loadImage(serverIconUrl);
		} catch (err) {
			console.error("Failed to load server icon, using text fallback", err);
		}
	}

	ctx.save();
	ctx.textAlign = "right";
	ctx.textBaseline = "middle";

	const serverText = serverName || "Discord Server";
	ctx.font = 'bold 20px "Inter", "Segoe UI", sans-serif';
	ctx.fillStyle = "rgba(255, 255, 255, 0.9)";

	if (serverIconImg) {
		// Draw icon circular
		const iconRadius = 24;
		const iconX = badgeX - iconRadius;
		const iconY = badgeY;

		ctx.beginPath();
		ctx.arc(iconX, iconY, iconRadius, 0, Math.PI * 2);
		ctx.clip();
		ctx.drawImage(serverIconImg, iconX - iconRadius, iconY - iconRadius, iconRadius * 2, iconRadius * 2);
		ctx.restore();

		// Draw Server Name to the left of the icon
		ctx.fillText(serverText, badgeX - iconRadius * 2 - 12, badgeY);
	} else {
		// No server icon, just draw name
		ctx.fillText(serverText, badgeX, badgeY);
		ctx.restore();
	}

	// 6. Draw Main Texts (Right Column)
	const textStartX = 300;

	// Welcome / Goodbye header
	ctx.fillStyle = isWelcome ? "#c7d2fe" : "#fecaca"; // indigo-200 / red-200
	ctx.font = 'bold 22px "Inter", "Segoe UI", sans-serif';
	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	const subtitleText = isWelcome ? "WELCOME TO THE SERVER" : "GOODBYE & FAREWELL";
	ctx.fillText(subtitleText, textStartX, 135);

	// Username (Slightly adjust size if it is too long to prevent overflowing)
	let fontSize = 56;
	ctx.font = `bold ${fontSize}px "Inter", "Segoe UI", sans-serif`;
	ctx.fillStyle = "#ffffff";

	let nameText = username || "NewMember";
	let textWidth = ctx.measureText(nameText).width;
	const maxTextWidth = width - textStartX - 80;
	while (textWidth > maxTextWidth && fontSize > 24) {
		fontSize -= 4;
		ctx.font = `bold ${fontSize}px "Inter", "Segoe UI", sans-serif`;
		textWidth = ctx.measureText(nameText).width;
	}

	ctx.fillText(nameText, textStartX, 175);

	// Member count text
	ctx.font = '28px "Inter", "Segoe UI", sans-serif';
	ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
	let countText = "";
	if (memberCount !== undefined) {
		countText = isWelcome
			? `You are our ${getOrdinal(memberCount)} member!`
			: `We now have ${memberCount} members`;
	}
	ctx.fillText(countText, textStartX, 255);

	return canvas.toBuffer("image/png");
}

function getOrdinal(n) {
	const s = ["th", "st", "nd", "rd"];
	const v = n % 100;
	return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

module.exports = { generateWelcomeCard };
