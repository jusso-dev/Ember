# Production Next.js dashboard. Proxies /api/* to CONTROL_PLANE_URL at runtime via rewrites
# baked at build time — pass CONTROL_PLANE_URL as build arg for compose networking.
# Uses Next standalone output so the runner image has no npm tree / full node_modules
# (keeps Trivy image HIGH/CRITICAL clean for node-pkg noise in global npm).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Prefer npm in images: pnpm 10+ fails the build when optional native scripts
# (sharp) are not pre-approved via onlyBuiltDependencies.
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN if [ -f package-lock.json ]; then npm ci; \
    elif [ -f pnpm-lock.yaml ]; then \
      corepack enable && corepack prepare pnpm@9.15.0 --activate && \
      pnpm install --frozen-lockfile; \
    else npm install; fi

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Rewrites are evaluated at build for next.config; default to compose service name.
ARG CONTROL_PLANE_URL=http://control-plane:8080
ENV CONTROL_PLANE_URL=$CONTROL_PLANE_URL
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    CONTROL_PLANE_URL=http://control-plane:8080
RUN useradd --system --uid 10001 nextjs \
    && mkdir -p /app/.next \
    && chown -R nextjs:nextjs /app
# Standalone server + static assets only (no npm / full node_modules tree).
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
