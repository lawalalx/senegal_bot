# Use Node 22 slim image
FROM node:22-slim AS build

# set working directory
WORKDIR /usr/src/app

# Install build tools and enable Corepack (for pnpm)
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@10.33.2 --activate

# Copy package manifests and lockfile first for better caching
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (includes dev deps like tsx which this project uses at runtime)
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Optional: run the project build step if present
RUN if [ -f package.json ] && pnpm -s -w --silent --reporter=silent run build; then echo "built"; fi

# ---- Runtime image ----
FROM node:22-slim
WORKDIR /usr/src/app

# Install runtime dependencies required (corepack & pnpm) and cleanup
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@10.33.2 --activate

# Copy installed node_modules and built artifacts from build stage
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app .

# Environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start the app using the project's start script
CMD ["sh", "-c", "pnpm start"]
