"use strict";
const pino = require('pino');

const level = process.env.LOG_LEVEL || 'info';
const pretty = process.env.NODE_ENV !== 'production';

// === Sanitização de secrets nos logs (M05) ===
const TOKEN_PATTERN = /(?:Bot\s+)?([A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,})/g;

function sanitizeToken(value) {
  if (typeof value !== 'string') return value;
  return value.replace(TOKEN_PATTERN, '[REDACTED_TOKEN]');
}

// Serializer customizado que sanitiza strings contendo tokens Discord
function safeStringifier(key, value) {
  if (typeof value === 'string') return sanitizeToken(value);
  return value;
}

const logger = pino({
  level,
  transport: pretty ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:dd/mm/yyyy HH:MM:ss',
      ignore: 'pid,hostname',
      messageFormat: '[{module}] {msg}'
    }
  } : undefined,
  base: { module: 'core' },
  formatters: {
    log(obj) {
      // Sanitiza todos os valores string do objeto de log
      const sanitized = {};
      for (const [k, v] of Object.entries(obj)) {
        sanitized[k] = typeof v === 'string' ? sanitizeToken(v) : v;
      }
      return sanitized;
    }
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res
  }
});

function createChild(moduleName) {
  return logger.child({ module: moduleName });
}

module.exports = { logger, createChild };