"use strict";
const { logger, createChild } = require('./logger');
const { EventBus, bus } = require('./event-bus');
const { ModuleManager, manager } = require('./module-manager');
const validators = require('./validators');

module.exports = {
  logger,
  createChild,
  EventBus,
  bus,
  ModuleManager,
  manager,
  ...validators
};