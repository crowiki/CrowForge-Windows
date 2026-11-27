"use strict";
const { EventEmitter } = require('node:events');
const { createChild } = require('./logger');

const log = createChild('event-bus');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  emit(event, ...args) {
    log.debug({ event }, 'Evento emitido');
    return super.emit(event, ...args);
  }

  on(event, listener) {
    const wrapped = async (...args) => {
      try {
        await listener(...args);
      } catch (err) {
        log.error({ err, event }, 'Erro em handler de evento');
      }
    };
    return super.on(event, wrapped);
  }

  once(event, listener) {
    const wrapped = async (...args) => {
      try {
        await listener(...args);
      } catch (err) {
        log.error({ err, event }, 'Erro em handler de evento (once)');
      }
    };
    return super.once(event, wrapped);
  }
}

const bus = new EventBus();

module.exports = { EventBus, bus };