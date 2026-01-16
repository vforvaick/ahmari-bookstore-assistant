FROM node:20-slim

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src ./src

# Copy test files (for running tests in container)
COPY jest.config.js ./
COPY __tests__ ./__tests__

# Build TypeScript
RUN npm run build

# Create necessary directories
RUN mkdir -p /app/sessions /app/data /app/media

# Expose port (if needed for health checks)
EXPOSE 3000

# Health check using actual /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD curl -sf http://localhost:3000/health || exit 1

# Run application
CMD ["npm", "start"]
