'use strict';
const config = require('./config');
const { ping, pool } = require('./config/db');
const { app, sessionStore } = require('./app');

async function start() {
  try {
    await ping();
    console.log(`✔ Connected to MySQL ${config.db.host}:${config.db.port}/${config.db.database}`);
  } catch (e) {
    console.error(`✖ Cannot connect to MySQL (${e.code || e.message}). Is the server running and is .env correct?`);
    process.exit(1);
  }
  const server = app.listen(config.port, () => {
    console.log(`✔ Business Expense Tracker running at http://localhost:${config.port}`);
  });

  const shutdown = () => {
    server.close(async () => {
      try { await sessionStore.close(); } catch { /* ignore */ }
      try { await pool.end(); } catch { /* ignore */ }
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
