'use strict';
const path = require('path');
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

const app = next({
  dev: false,
  dir: path.join(__dirname, 'apps', 'web'),
});
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => {
    handle(req, res, parse(req.url, true));
  }).listen(process.env.PORT || 3000);
});
