"use strict";
const { createChild } = require('./logger');
const { bus } = require('./event-bus');

const log = createChild('module-manager');

class ModuleManager {
  constructor() {
    this.modules = new Map();
    this.started = false;
  }

  register(name, mod) {
    if (this.modules.has(name)) {
      throw new Error(`Módulo '${name}' já registrado`);
    }
    const contract = ['init', 'start', 'stop', 'health'];
    for (const method of contract) {
      if (typeof mod[method] !== 'function') {
        throw new Error(`Módulo '${name}' não implementa '${method}()'`);
      }
    }
    this.modules.set(name, { instance: mod, status: 'registered' });
    log.info({ module: name }, 'Módulo registrado');
  }

  async initAll(context) {
    for (const [name, entry] of this.modules) {
      try {
        await entry.instance.init(context);
        entry.status = 'initialized';
        log.info({ module: name }, 'Módulo inicializado');
      } catch (err) {
        entry.status = 'init_failed';
        log.error({ err, module: name }, 'Falha ao inicializar módulo');
        bus.emit('module:init:failed', { name, error: err });
      }
    }
  }

  async startAll() {
    for (const [name, entry] of this.modules) {
      if (entry.status !== 'initialized') continue;
      try {
        await entry.instance.start();
        entry.status = 'running';
        log.info({ module: name }, 'Módulo iniciado');
        bus.emit('module:started', { name });
      } catch (err) {
        entry.status = 'start_failed';
        log.error({ err, module: name }, 'Falha ao iniciar módulo');
        bus.emit('module:start:failed', { name, error: err });
      }
    }
    this.started = true;
  }

  async stopAll() {
    const entries = [...this.modules.entries()].reverse();
    for (const [name, entry] of entries) {
      if (entry.status !== 'running') continue;
      try {
        await entry.instance.stop();
        entry.status = 'stopped';
        log.info({ module: name }, 'Módulo parado');
      } catch (err) {
        entry.status = 'stop_failed';
        log.error({ err, module: name }, 'Falha ao parar módulo');
      }
    }
    this.started = false;
  }

  healthCheck() {
    const results = {};
    for (const [name, entry] of this.modules) {
      try {
        results[name] = {
          status: entry.status,
          health: entry.instance.health()
        };
      } catch (err) {
        results[name] = { status: entry.status, health: 'error', error: err.message };
      }
    }
    return results;
  }

  get(name) {
    const entry = this.modules.get(name);
    return entry ? entry.instance : null;
  }

  list() {
    return [...this.modules.entries()].map(([name, entry]) => ({
      name,
      status: entry.status
    }));
  }
}

const manager = new ModuleManager();

module.exports = { ModuleManager, manager };