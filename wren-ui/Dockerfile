FROM node:18-bookworm-slim AS base

# Install required packages
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED 1
ENV NODE_ENV production

WORKDIR /app

# Enable corepack to manage yarn versions and set the correct yarn version
RUN corepack enable
COPY .yarnrc.yml package.json yarn.lock ./
COPY .yarn/releases/yarn-4.5.3.cjs .yarn/releases/yarn-4.5.3.cjs
RUN corepack prepare yarn@4.5.3 --activate

FROM base AS deps
WORKDIR /app

# Install dependencies based on the preferred package manager
RUN yarn install --immutable

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

RUN yarn build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY migrations ./migrations
COPY knexfile.js ./knexfile.js

EXPOSE 3000

ENV PORT 3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD yarn knex migrate:latest && HOSTNAME="0.0.0.0" node server.js
