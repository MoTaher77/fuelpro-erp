'use strict';
const { Hono } = require('hono'); const { serve } = require('@hono/node-server');
const { store, orgOf } = require('../node-common/core.js');
const app = new Hono();
app.onError((e, c) => c.json({ error: e.message }, e.status || 500));
app.get('/stations/:sid/sales', async (c) => c.json(await store.list(orgOf(c.req.header('x-org')), Number(c.req.param('sid')), Math.min(Number(c.req.query('limit')) || 50, 200))));
app.get('/stations/:sid/summary', async (c) => c.json(await store.summary(orgOf(c.req.header('x-org')), Number(c.req.param('sid')), c.req.query('day'))));
app.post('/stations/:sid/sales', async (c) => { let b; try { b = await c.req.json(); } catch { b = null; } return c.json(await store.create(orgOf(c.req.header('x-org')), Number(c.req.param('sid')), b), 201); });
serve({ fetch: app.fetch, port: Number(process.env.PORT || 8080), hostname: '127.0.0.1' });
