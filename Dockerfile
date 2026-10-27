FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && chown -R node:node /app
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "--import", "tsx", "server/launch.ts"]
