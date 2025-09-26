# Sourcify Grabber Dev Container
FROM node:18-alpine

# Set working directory
WORKDIR /workspace

# Create non-root user for development
RUN addgroup -g 1001 -S nodejs && \
    adduser -S sourcify -u 1001 -G nodejs -s /bin/sh

# Create necessary directories with proper permissions
RUN mkdir -p data exports logs cache incoming && \
    chown -R sourcify:nodejs /workspace

# Switch to non-root user
USER sourcify

# Set environment variables for development
ENV NODE_ENV=development
ENV LOG_LEVEL=debug

# Default command for development (keep container running)
CMD ["tail", "-f", "/dev/null"]