FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
ENV PORT=7000
EXPOSE 7000
RUN npm run build
CMD ["npm","run","start"]
