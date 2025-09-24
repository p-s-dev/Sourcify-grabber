import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import logger from './log.js';

const CACHE_DIR = 'cache';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_MAX_RETRY_DELAY = 10000;

// Ensure cache directory exists
await fs.mkdir(CACHE_DIR, { recursive: true });

/**
 * HTTP client with retry logic, caching, and rate limiting
 */
export class HttpClient {
  constructor(options = {}) {
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries || DEFAULT_MAX_RETRIES;
    this.retryDelay = options.retryDelay || DEFAULT_RETRY_DELAY;
    this.maxRetryDelay = options.maxRetryDelay || DEFAULT_MAX_RETRY_DELAY;
    this.userAgent = options.userAgent || 'sourcify-grabber/1.0.0';
    
    this.client = axios.create({
      timeout: this.timeout,
      headers: {
        'User-Agent': this.userAgent
      }
    });
  }

  /**
   * Generate cache key for URL
   * @param {string} url - The URL to cache
   * @returns {string} Cache key
   */
  getCacheKey(url) {
    return crypto.createHash('sha256').update(url).digest('hex');
  }

  /**
   * Get cache file path
   * @param {string} cacheKey - Cache key
   * @returns {string} Cache file path
   */
  getCacheFilePath(cacheKey) {
    return path.join(CACHE_DIR, `${cacheKey}.json`);
  }

  /**
   * Load cached response
   * @param {string} url - Request URL
   * @returns {Promise<Object|null>} Cached response or null
   */
  async loadFromCache(url) {
    try {
      const cacheKey = this.getCacheKey(url);
      const cacheFile = this.getCacheFilePath(cacheKey);
      const cacheData = await fs.readFile(cacheFile, 'utf8');
      const cached = JSON.parse(cacheData);
      
      // Check if cache is still valid (24 hours)
      const cacheAge = Date.now() - cached.timestamp;
      if (cacheAge > 24 * 60 * 60 * 1000) {
        return null;
      }
      
      logger.debug('Cache hit', { url, cacheKey });
      return cached;
    } catch {
      return null;
    }
  }

  /**
   * Save response to cache
   * @param {string} url - Request URL
   * @param {Object} response - Response data
   * @param {Object} headers - Response headers
   */
  async saveToCache(url, response, headers) {
    try {
      const cacheKey = this.getCacheKey(url);
      const cacheFile = this.getCacheFilePath(cacheKey);
      
      const cacheData = {
        url,
        timestamp: Date.now(),
        headers: {
          etag: headers.etag,
          'last-modified': headers['last-modified'],
          'content-type': headers['content-type'],
          'content-length': headers['content-length']
        },
        data: response
      };
      
      await fs.writeFile(cacheFile, JSON.stringify(cacheData, null, 2));
      logger.debug('Response cached', { url, cacheKey });
    } catch (error) {
      logger.warn('Failed to cache response', { url, error: error.message });
    }
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   * @param {number} attempt - Attempt number (0-based)
   * @returns {number} Delay in milliseconds
   */
  calculateRetryDelay(attempt) {
    const exponentialDelay = this.retryDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay;
    return Math.min(exponentialDelay + jitter, this.maxRetryDelay);
  }

  /**
   * Sleep for specified duration
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if error is retryable
   * @param {Error} error - The error to check
   * @returns {boolean} True if error is retryable
   */
  isRetryableError(error) {
    if (!error.response) {
      // Network errors are retryable
      return true;
    }
    
    const status = error.response.status;
    // Retry on 5xx server errors and 429 rate limiting
    return status >= 500 || status === 429;
  }

  /**
   * Get retry delay from 429 response
   * @param {Object} response - HTTP response
   * @returns {number} Retry delay in milliseconds
   */
  getRetryAfterDelay(response) {
    const retryAfter = response.headers['retry-after'];
    if (retryAfter) {
      const delay = parseInt(retryAfter) * 1000;
      return Math.min(delay, this.maxRetryDelay);
    }
    return this.calculateRetryDelay(0);
  }

  /**
   * Make HTTP request with retry logic
   * @param {string} method - HTTP method
   * @param {string} url - Request URL
   * @param {Object} options - Request options
   * @returns {Promise<Object>} Response data
   */
  async request(method, url, options = {}) {
    const startTime = Date.now();
    logger.logRequest(method, url, options);

    // Check cache for GET requests
    if (method.toLowerCase() === 'get' && !options.ignoreCache) {
      const cached = await this.loadFromCache(url);
      if (cached && cached.headers.etag && !options.ignoreEtag) {
        options.headers = {
          ...options.headers,
          'If-None-Match': cached.headers.etag
        };
      }
    }

    let lastError;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.request({
          method,
          url,
          ...options
        });

        const duration = Date.now() - startTime;
        logger.logResponse(method, url, response.status, response.headers, duration);

        // Handle 304 Not Modified
        if (response.status === 304) {
          const cached = await this.loadFromCache(url);
          if (cached) {
            return cached.data;
          }
        }

        // Cache successful GET responses
        if (method.toLowerCase() === 'get' && response.status === 200) {
          await this.saveToCache(url, response.data, response.headers);
        }

        return response.data;
        
      } catch (error) {
        lastError = error;
        
        if (attempt === this.maxRetries) {
          break;
        }
        
        if (!this.isRetryableError(error)) {
          break;
        }

        let delay;
        if (error.response && error.response.status === 429) {
          delay = this.getRetryAfterDelay(error.response);
        } else {
          delay = this.calculateRetryDelay(attempt);
        }

        logger.logRetry(attempt + 1, this.maxRetries + 1, delay, error);
        await this.sleep(delay);
      }
    }

    // Log final error
    const duration = Date.now() - startTime;
    const status = lastError.response ? lastError.response.status : 'network_error';
    logger.error('Request failed after retries', {
      method,
      url,
      status,
      duration: `${duration}ms`,
      error: lastError.message
    });

    throw lastError;
  }

  /**
   * GET request
   * @param {string} url - Request URL
   * @param {Object} options - Request options
   * @returns {Promise<Object>} Response data
   */
  async get(url, options = {}) {
    return this.request('GET', url, options);
  }

  /**
   * POST request
   * @param {string} url - Request URL
   * @param {Object} data - Request data
   * @param {Object} options - Request options
   * @returns {Promise<Object>} Response data
   */
  async post(url, data, options = {}) {
    return this.request('POST', url, { ...options, data });
  }
}

// Export default instance
export default new HttpClient();