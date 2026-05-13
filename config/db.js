'use strict';

const mongoose = require('mongoose');
const logger   = require('../utils/logger');

const MAX_RETRIES    = 5;
const RETRY_DELAY_MS = 5000;
let   retries        = 0;

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS:          45000,
      maxPoolSize:              10,
    });

    retries = 0;
    logger.info(`MongoDB connected: ${mongoose.connection.host} / ${mongoose.connection.name}`);

  } catch (err) {
    logger.error(`MongoDB connection error: ${err.message}`);

    if (retries < MAX_RETRIES) {
      retries++;
      logger.warn(`Retrying MongoDB connection (${retries}/${MAX_RETRIES}) in ${RETRY_DELAY_MS / 1000}s...`);
      setTimeout(connectDB, RETRY_DELAY_MS);
    } else {
      logger.error('Max MongoDB retries reached. Exiting.');
      process.exit(1);
    }
  }
}

// Auto-reconnect on disconnect
mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected — attempting reconnect...');
  setTimeout(connectDB, RETRY_DELAY_MS);
});

mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB error: ${err.message}`);
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected successfully.');
});

// Graceful shutdown
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

async function gracefulShutdown(signal) {
  logger.info(`${signal} received — closing MongoDB connection...`);
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed cleanly.');
  } catch (err) {
    logger.error(`Error closing MongoDB: ${err.message}`);
  }
  process.exit(0);
}

module.exports = connectDB;
