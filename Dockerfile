FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy source & build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm install --include=dev && npm run build

# Remove dev deps after build
RUN npm prune --omit=dev

EXPOSE 3001

CMD ["node", "dist/index.js"]
