'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const TOTP = require('../src/totp');
const { smtpMailer } = require('../src/mailer');

test('TOTP matches RFC 6238 test vectors (SHA-1)', () => {
  const key = Buffer.from('12345678901234567890');
  assert.equal(TOTP.totp(key, 59_000, 8), '94287082');
  assert.equal(TOTP.totp(key, 1111111109_000, 8), '07081804');
  assert.equal(TOTP.totp(key, 1234567890_000, 8), '89005924');
  assert.equal(TOTP.totp(key, 20000000000_000, 8), '65353130');
  assert.equal(TOTP.hotp(key, 0), '755224');   // RFC 4226
  assert.equal(TOTP.hotp(key, 9), '520489');
});

test('TOTP verify: drift window, replay guard, base32 round trip', () => {
  const key = Buffer.from('abcdefghij0123456789'), t = 1_800_000_000_000, step = TOTP.stepAt(t);
  assert.equal(TOTP.b32decode(TOTP.b32encode(key)).toString(), key.toString());
  assert.equal(TOTP.b32encode(Buffer.from('12345678901234567890')), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(TOTP.verifyTotp(key, TOTP.totp(key, t), 0, t), step);
  assert.equal(TOTP.verifyTotp(key, TOTP.totp(key, t - 30_000), 0, t), step - 1);
  assert.equal(TOTP.verifyTotp(key, TOTP.totp(key, t - 90_000), 0, t), null);
  assert.equal(TOTP.verifyTotp(key, TOTP.totp(key, t), step, t), null);
  assert.equal(TOTP.verifyTotp(key, '12345', 0, t), null);
});

test('SMTP client talks to a server and sends a UTF-8 message', async () => {
  const log = []; let data = '';
  const srv = net.createServer((s) => {
    s.write('220 fake ESMTP\r\n'); let buf = '', inData = false;
    s.on('data', (d) => {
      buf += d;
      if (inData) { const i = buf.indexOf('\r\n.\r\n'); if (i >= 0) { data = buf.slice(0, i); buf = buf.slice(i + 5); inData = false; s.write('250 queued\r\n'); } return; }
      let i; while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2); log.push(line);
        if (/^EHLO/.test(line)) s.write('250-fake\r\n250-SIZE 1000000\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH PLAIN/.test(line)) s.write('235 ok\r\n');
        else if (/^(MAIL|RCPT)/.test(line)) s.write('250 ok\r\n');
        else if (line === 'DATA') { s.write('354 go\r\n'); inData = true; const j = buf.indexOf('\r\n.\r\n'); if (j >= 0) { data = buf.slice(0, j); buf = buf.slice(j + 5); inData = false; s.write('250 queued\r\n'); } break; }
        else if (line === 'QUIT') { s.end('221 bye\r\n'); }
      }
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const m = smtpMailer({ host: '127.0.0.1', port: srv.address().port, secure: false, allowPlain: true, user: 'u', pass: 'p', from: 'no-reply@fuel.example' });
  await m.send({ to: 'a@b.example', subject: 'إعادة تعيين', text: 'مرحباً\nlink' });
  srv.close();
  assert.ok(log.includes('MAIL FROM:<no-reply@fuel.example>')); assert.ok(log.includes('RCPT TO:<a@b.example>'));
  assert.equal(Buffer.from(log.find(l => l.startsWith('AUTH PLAIN')).slice(11), 'base64').toString(), '\0u\0p');
  assert.match(data, /Subject: =\?UTF-8\?B\?/);
  const body = data.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), 'مرحباً\nlink');
});

test('SMTP refuses to send credentials in clear text unless allowed', async () => {
  const srv = net.createServer((s) => { s.write('220 x\r\n'); s.on('data', () => s.write('250 x\r\n')); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const m = smtpMailer({ host: '127.0.0.1', port: srv.address().port, secure: false, from: 'a@b.c' });
  await assert.rejects(m.send({ to: 'x@y.z', subject: 's', text: 't' }), /STARTTLS/);
  srv.close();
});
