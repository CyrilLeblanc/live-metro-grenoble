# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app

# Copy installed node_modules from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Download GTFS data and write public/gtfs/ (requires internet at build time)
RUN node scripts/parse-gtfs.js

# Build the Next.js app (produces .next/standalone)
RUN npm run build

# ── Stage 3: production runner ────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# standalone server + static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public           ./public

# Persistent directories (tile cache + GPS speed graphs) — mounted as volumes
RUN mkdir -p .cache/tiles data/segment-speeds && \
    chown -R nextjs:nodejs .cache data

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
