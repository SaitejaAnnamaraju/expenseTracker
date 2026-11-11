'use strict';
// Vercel entry point: Vercel calls this exported Express app for every request
// (it does not run src/server.js, so there is no app.listen here).
module.exports = require('../src/app').app;
