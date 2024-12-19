FROM node:18-bookworm-slim AS base

# Install curl
RUN apt-get update && apt-get install -y curl python3 cmake g++ && rm -rf /var/lib/apt/lists/*
# Enable corepack to manage Yarn versions
RUN corepack enable

FROM base AS deps
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock* .yarnrc.yml ./
COPY .yarn/releases/yarn-4.5.3.cjs .yarn/releases/yarn-4.5.3.cjs
# Use corepack to ensure correct Yarn version
RUN corepack prepare yarn@4.5.3 --activate
RUN yarn install --frozen-lockfile --network-timeout 100000

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY public ./public
COPY src ./src
COPY .eslintrc.json ./
COPY .eslintignore ./
COPY .prettierrc ./
COPY next.config.js ./
COPY tsconfig.json ./
COPY yarn.lock ./
COPY package.json ./
COPY .yarnrc.yml ./
COPY .yarn/releases/yarn-4.5.3.cjs .yarn/releases/yarn-4.5.3.cjs

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
# ENV NEXT_TELEMETRY_DISABLED 1

RUN corepack prepare yarn@4.5.3 --activate
RUN yarn build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED 1

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY migrations ./migrations
COPY knexfile.js ./knexfile.js
# COPY .yarnrc.yml ./
# COPY .yarn/releases/yarn-4.5.3.cjs .yarn/releases/yarn-4.5.3.cjs

# # Use corepack instead of yarn set version
# RUN corepack prepare yarn@4.5.3 --activate
# RUN yarn dlx knex@latest migrate:latest

EXPOSE 3000

ENV PORT 3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD yarn dlx knex migrate:latest && HOSTNAME="0.0.0.0" node server.js
# CMD knex migrate:latest && HOSTNAME="0.0.0.0" node server.js
