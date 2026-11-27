'use strict';
const app = require('fastify')({ logger: false });
const { store, orgOf } = require('../node-common/core.js');
app.setErrorHandler((e, req, rep) => rep.code(e.status || e.statusCode || 500).send({ error: e.message }));
app.get('/stations/:sid/sales', async (req) => store.list(orgOf(req.headers['x-org']), Number(req.params.sid), Math.min(Number(req.query.limit) || 50, 200)));
app.get('/stations/:sid/summary', async (req) => store.summary(orgOf(req.headers['x-org']), Number(req.params.sid), req.query.day));
app.post('/stations/:sid/sales', async (req, rep) => { rep.code(201); return store.create(orgOf(req.headers['x-org']), Number(req.params.sid), req.body); });
app.listen({ port: Number(process.env.PORT || 8080), host: '127.0.0.1' });
