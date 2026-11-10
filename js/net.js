/* 連線對戰的傳輸層：連到提供這個網頁的那台 server 的 /ws，訊息是 JSON、以 type 分流。
   每秒送一次 ping 當心跳（server 5 秒沒收到就當斷線），pong 回來順便量來回延遲。協定見 docs/DESIGN.md〈連線對戰〉。 */
'use strict';

const Net = (() => {
  let ws = null, timer = 0, h = null;
  const state = { rtt: 0 };

  function url() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  }

  // handlers：{ open(), message(m), close(wasOpen) }
  function connect(handlers) {
    close();
    h = handlers;
    const u = url();
    if (!u) { setTimeout(() => h && h.close(false), 0); return; }
    let opened = false;
    const sock = ws = new WebSocket(u);
    sock.onopen = () => {
      if (sock !== ws) return;
      opened = true;
      timer = setInterval(() => send({ type: 'ping', t: performance.now() }), 1000);
      h.open();
    };
    sock.onmessage = ev => {
      if (sock !== ws) return;
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'pong') { state.rtt = Math.round(performance.now() - m.t); return; }
      h.message(m);
    };
    sock.onclose = () => {
      if (sock !== ws) return;
      clearInterval(timer); ws = null;
      const hh = h; h = null;
      if (hh) hh.close(opened);
    };
  }

  function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  // 主動關：不觸發 close 回呼
  function close() {
    clearInterval(timer);
    const s = ws; ws = null; h = null;
    if (s) try { s.close(); } catch (e) { /* 已經關了 */ }
  }

  return { connect, send, close, state, available: () => !!url() };
})();
