# Sourcify Grabber Docker Image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY src/ ./src/
COPY config/ ./config/

# Create necessary directories
RUN mkdir -p data exports logs cache incoming

# Set proper permissions
RUN chmod -R 755 src/

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S sourcify -u 1001

# Change ownership of app directory
RUN chown -R sourcify:nodejs /app

# Switch to non-root user
USER sourcify

# Set environment variables
ENV NODE_ENV=production
ENV LOG_LEVEL=info

# Default command shows help
CMD ["node", "src/cli.js", "--help"]

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('Sourcify Grabber is healthy')" || exit 1

# Labels
LABEL maintainer="Sourcify Grabber"
LABEL description="Production-grade Node.js app for archiving Ethereum smart contracts from Sourcify"
LABEL version="1.0.0"