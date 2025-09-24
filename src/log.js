import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

const logsDir = 'logs';

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for structured logging
const structuredFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let output = `${timestamp} [${level}] ${message}`;
    if (Object.keys(meta).length > 0) {
      output += ` ${JSON.stringify(meta)}`;
    }
    return output;
  })
);

// Create daily rotating file transport
const fileTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'sourcify-grabber-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '10m',
  maxFiles: '30d',
  format: structuredFormat
});

// Create error file transport
const errorTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxSize: '10m',
  maxFiles: '30d',
  format: structuredFormat
});

// Create console transport
const consoleTransport = new winston.transports.Console({
  format: consoleFormat,
  level: process.env.LOG_LEVEL || 'info'
});

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    fileTransport,
    errorTransport,
    consoleTransport
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(logsDir, 'exceptions.log') })
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: path.join(logsDir, 'rejections.log') })
  ]
});

// Add request/response logging helpers
logger.logRequest = function(method, url, options = {}) {
  this.debug('HTTP Request', {
    method,
    url,
    headers: options.headers,
    body: options.body ? 'present' : 'none'
  });
};

logger.logResponse = function(method, url, status, headers = {}, duration = 0) {
  this.info('HTTP Response', {
    method,
    url,
    status,
    duration: `${duration}ms`,
    etag: headers.etag,
    'content-length': headers['content-length']
  });
};

logger.logRetry = function(attempt, maxAttempts, delay, error) {
  this.warn('Retry attempt', {
    attempt,
    maxAttempts,
    delay: `${delay}ms`,
    error: error.message
  });
};

export default logger;