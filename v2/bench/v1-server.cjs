// v1 server in its own process for the comparison (node v1-server.cjs <db> <port>)
const { createApp } = require('../../src/server');
const { server } = createApp({ dbPath: process.argv[2], mailer: { kind: 'none', send: async () => {} } });
server.listen(Number(process.argv[3]), '127.0.0.1', () => console.log('ready'));
