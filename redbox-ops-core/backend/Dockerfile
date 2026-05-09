FROM node:18-bullseye-slim

RUN apt-get update \
  && apt-get install -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN mkdir -p /app/uploads /app/data

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/index.js"]
