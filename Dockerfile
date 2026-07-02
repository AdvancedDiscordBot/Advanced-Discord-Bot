# Lightweight official Node.js image as base
FROM node:24-alpine

WORKDIR /app

# Install root dependencies first (better layer caching).
# No package-lock.json is committed, so use `npm install`.
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the source
COPY . .

# Build the plugin dashboard front-ends (Create-React-App) into the image
# so the dashboard is served pre-compiled. build-plugins.js installs each
# plugin web app's own deps and runs its build.
RUN node scripts/build-plugins.js

# Register slash commands, then start the bot.
# deploy-commands needs the Discord token + network, so it runs at container
# start (idempotent) rather than at build time.
CMD ["sh", "-c", "node deploy-commands.js && node index.js"]
