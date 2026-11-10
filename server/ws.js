/* 最小的 WebSocket 伺服端（RFC 6455），只做這個遊戲用得到的：文字訊息、ping/pong、close。
   不用 npm 套件，server 目錄 clone 下來直接 node 就能跑。 */
'use strict';
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 1 << 20;   // 一則訊息最大 1 MB（重連快照約數十 KB）

class Socket extends EventEmitter {
  constructor(sock) {
    super();
    this.sock = sock; this.buf = Buffer.alloc(0); this.frag = null; this.closed = false;
    sock.setNoDelay(true);
    sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); try { this._parse(); } catch (e) { this.close(1002); } });
    sock.on('close', () => this._gone());
    sock.on('error', () => this._gone());
  }
  _gone() { if (this.closed) return; this.closed = true; this.emit('close'); }
  _parse() {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_PAYLOAD) throw new Error('payload too large');
      if (!masked) throw new Error('client frame must be masked');
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4), data = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this._send(0xA, data); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x2) this.frag = [data];
      else if (op === 0x0 && this.frag) this.frag.push(data);
      else continue;
      if (fin) { const msg = Buffer.concat(this.frag).toString('utf8'); this.frag = null; this.emit('message', msg); }
    }
  }
  _send(op, payload) {
    if (this.closed) return;
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    this.sock.write(Buffer.concat([head, payload]));
  }
  send(text) { this._send(0x1, Buffer.from(text, 'utf8')); }
  // 慢連線不拖住房間：送出緩衝積太多（對方網路卡住）就回報，由呼叫端決定跳過
  get backlog() { return this.sock.writableLength; }
  close(code = 1000) {
    if (this.closed) return;
    try { const p = Buffer.alloc(2); p.writeUInt16BE(code, 0); this._send(0x8, p); } catch (e) { /* 已經斷了 */ }
    this.sock.end(); this._gone();
  }
}

// http server 的 upgrade 事件交給這裡；握手成功回傳 Socket
function accept(req, sock) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return null; }
  const acceptKey = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acceptKey + '\r\n\r\n');
  return new Socket(sock);
}

module.exports = { accept };
