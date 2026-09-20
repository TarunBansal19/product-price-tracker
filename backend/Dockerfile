# Backend Dockerfile for Render deployment
# Using matching Playwright noble image for system libraries and Chromium runtime
FROM mcr.microsoft.com/playwright:v1.50.1-noble

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev
RUN npx playwright install chromium

# Copy source files
COPY src/ ./src/

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3001
ENV NODE_OPTIONS="--max-old-space-size=384"
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT}/api/health/live || exit 1

CMD ["node", "src/server.js"]

