# Local dev/test image. Single stage shared by the compose `dev` and `test`
# services — both bind-mount the source, so this image's job is just to provide
# a Node 20 toolchain + linux-native node_modules (Tailwind's lightningcss,
# Vitest/esbuild ship platform-specific binaries that must NOT come from the
# host's macOS node_modules).
FROM node:20-bookworm-slim

WORKDIR /app

# Install deps first so this layer caches across source edits. Rebuild the
# image (npm run docker:build) whenever package-lock.json changes.
COPY package.json package-lock.json ./
RUN npm ci

# Fallback copy for running the image without a bind mount. In normal use
# docker-compose mounts the live source over this.
COPY . .

EXPOSE 3000

# Bind 0.0.0.0 so the published host port reaches the in-container server.
# Compose overrides this per service.
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]
