# Stream worker image. Build from the repo root (npm workspaces):
#   docker build -f apps/worker/Dockerfile -t streamwatcher-worker .
# Run with CONVEX_URL, WORKER_SECRET, PUBLIC_WS_URL (and optionally WORKER_PORT,
# BUFFER_SECONDS, DATA_DIR) in the environment.
# Keep the tag in sync with the playwright version in package-lock.json.
FROM mcr.microsoft.com/playwright:v1.65.0-noble

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app
ENV NODE_ENV=production

# Workspace manifests first for layer caching (npm ci needs every workspace's package.json).
COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm ci -w worker --include-workspace-root --include=dev --ignore-scripts

# Worker source + the generated Convex API it imports.
COPY convex/_generated convex/_generated
COPY apps/worker apps/worker

EXPOSE 8788
CMD ["npm", "start", "-w", "worker"]
