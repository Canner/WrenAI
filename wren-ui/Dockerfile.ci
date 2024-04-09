
# Production image, copy all the files and run next
FROM node:16-alpine
WORKDIR /app

COPY public ./public

ENV NODE_ENV production

# Set the correct permission for prerender cache
RUN mkdir .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY ./.next/standalone ./
COPY ./.next/static ./.next/static
COPY migrations ./migrations
COPY knexfile.js ./knexfile.js
RUN yarn global add knex

EXPOSE 3000

ENV PORT 3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD knex migrate:latest && HOSTNAME="0.0.0.0" node server.js
