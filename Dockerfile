FROM node:20-slim
WORKDIR /app

# ffmpeg para procesar audio/video. La imagen de Playwright ya no se usa
# (nadie importa playwright; solo se usa ffmpeg-static y ffmpeg del sistema).
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "npx drizzle-kit push || echo 'WARNING: Database schema push failed. Please check DATABASE_URL and database connectivity.'; node dist/index.cjs"]
