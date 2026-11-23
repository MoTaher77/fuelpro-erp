'use strict';
/* Outgoing e-mail. SMTP (implicit TLS on 465, STARTTLS otherwise) with no dependencies; console fallback for development. */
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

class Conn {
  constructor(sock) { this.attach(sock); }
  attach(sock) {
    this.sock = sock; this.buf = ''; this.cur = []; this.q = []; this.waiters = []; this.err = null;
    sock.on('data', (d) => this.onData(d));
    sock.on('error', (e) => this.fail(e));
    sock.on('close', () => this.fail(new Error('SMTP connection closed')));
  }
  onData(d) {
    this.buf += d.toString('utf8'); let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, ''); this.buf = this.buf.slice(i + 1);
      this.cur.push(line.slice(4));
      if (/^\d{3}(?!-)/.test(line)) {
        const r = { code: Number(line.slice(0, 3)), lines: this.cur }; this.cur = [];
        const w = this.waiters.shift(); if (w) w.res(r); else this.q.push(r);
      }
    }
  }
  fail(e) { if (!this.err) this.err = e; for (const w of this.waiters.splice(0)) w.rej(this.err); }
  read() {
    if (this.q.length) return Promise.resolve(this.q.shift());
    if (this.err) return Promise.reject(this.err);
    return new Promise((res, rej) => this.waiters.push({ res, rej }));
  }
  async cmd(line, expect, show = line) {
    if (line != null) this.sock.write(line + '\r\n');
    const r = await this.read();
    if (!expect.includes(r.code)) throw new Error(`SMTP ${show ? show.split(' ')[0] : 'greeting'} failed: ${r.code} ${r.lines.join(' ')}`);
    return r;
  }
}

const b64lines = (buf) => buf.toString('base64').replace(/.{1,76}/g, '$&\r\n');
const encWord = (s) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
const clean = (s) => { if (/[\r\n<>]/.test(String(s))) throw new Error('Invalid header value'); return String(s); };

function buildMessage({ from, fromName, to, subject, text }) {
  const domain = clean(from).split('@')[1] || 'localhost';
  return [
    `From: ${encWord(clean(fromName || 'FuelPro'))} <${clean(from)}>`, `To: <${clean(to)}>`, `Subject: ${encWord(clean(subject))}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(Buffer.from(text, 'utf8'))
  ].join('\r\n');
}

function smtpMailer(cfg) {
  const port = Number(cfg.port || 587), secure = cfg.secure ?? port === 465;
  async function send(msg) {
    const opts = { host: cfg.host, port, servername: cfg.host };
    const sock = secure ? tls.connect(opts) : net.connect(opts);
    sock.setTimeout(cfg.timeoutMs || 20_000, () => sock.destroy(new Error('SMTP timeout')));
    const c = new Conn(sock);
    try {
      await c.cmd(null, [220]);
      const helo = cfg.heloName || 'localhost';
      let ehlo = await c.cmd(`EHLO ${helo}`, [250]);
      if (!secure) {
        if (ehlo.lines.some(l => /^STARTTLS\b/i.test(l))) {
          await c.cmd('STARTTLS', [220]);
          sock.removeAllListeners('data'); sock.removeAllListeners('error'); sock.removeAllListeners('close'); sock.on('error', () => {});   // errors now surface on the TLS socket
          const t = tls.connect({ socket: sock, servername: cfg.host, rejectUnauthorized: cfg.rejectUnauthorized !== false });
          await new Promise((res, rej) => { t.once('secureConnect', res); t.once('error', rej); });
          c.attach(t); c.sock.setTimeout(cfg.timeoutMs || 20_000, () => c.sock.destroy(new Error('SMTP timeout')));
          ehlo = await c.cmd(`EHLO ${helo}`, [250]);
        } else if (!cfg.allowPlain) throw new Error('SMTP server does not offer STARTTLS (set SMTP_ALLOW_PLAIN=1 only for a local relay)');
      }
      if (cfg.user) await c.cmd('AUTH PLAIN ' + Buffer.from(`\0${cfg.user}\0${cfg.pass || ''}`).toString('base64'), [235], 'AUTH');
      await c.cmd(`MAIL FROM:<${clean(cfg.from)}>`, [250]);
      await c.cmd(`RCPT TO:<${clean(msg.to)}>`, [250, 251]);
      await c.cmd('DATA', [354]);
      await c.cmd(buildMessage({ ...msg, from: cfg.from, fromName: cfg.fromName }) + '\r\n.', [250], 'DATA-END');
      c.sock.write('QUIT\r\n');
    } finally { c.sock.end(); }
  }
  return { kind: 'smtp', send };
}

function createMailer(env = process.env) {
  if (env.SMTP_HOST) {
    if (!env.MAIL_FROM) throw new Error('MAIL_FROM is required when SMTP_HOST is set');
    return smtpMailer({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE ? env.SMTP_SECURE === '1' : undefined, user: env.SMTP_USER, pass: env.SMTP_PASS,
      from: env.MAIL_FROM, fromName: env.MAIL_FROM_NAME || 'FuelPro', allowPlain: env.SMTP_ALLOW_PLAIN === '1' });
  }
  return { kind: 'console', async send(m) { console.log(`[mail:console] to=${m.to}\nSubject: ${m.subject}\n${m.text}\n`); } };
}

module.exports = { createMailer, smtpMailer, buildMessage };
