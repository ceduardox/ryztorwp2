FROM mcr.microsoft.com/playwright:v1.60.0-noble
WORKDIR /app
RUN echo "USING_PLAYWRIGHT_DOCKER_IMAGE=v1.60.0-noble"
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "npx drizzle-kit push || echo 'WARNING: Database schema push failed. Please check DATABASE_URL and database connectivity.'; node dist/index.cjs"]
