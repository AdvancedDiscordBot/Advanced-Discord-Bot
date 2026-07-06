# Lightweight official Nodejs image as base
FROM node:24-alpine

# Install git and ssh client (required for git pull in trial mode)
RUN apk add --no-cache git openssh-client

# Setting the working directory 
WORKDIR /app

# COPY package.json and package-lock.json for Docker caching 
COPY package*.json ./

# Install dependencies (both dev and prod dependencies, as react-scripts / build tools are needed to build plugin assets)
RUN npm install

# COPY the rest of the application files
COPY . .

# Build/compile the plugin web assets (dashboard)
RUN node scripts/build-plugins.js

# Expose the single unified port 3210
EXPOSE 3000

# Run the bot and web dashboard
CMD ["npm", "start"]
