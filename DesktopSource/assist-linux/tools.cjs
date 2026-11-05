'use strict';
const { auth } = require('./pulsoid.cjs');
const crypto = require('node:crypto');
function bot(port, password, action = null, args = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return Promise.reject(Error('Invalid port'));
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/'),
      id = crypto.randomUUID();
    let done = false,
      sent = false;
    const timer = setTimeout(() => finish(Error('Streamer.bot timed out')), 8000);
    function finish(error, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.close();
      error ? reject(error) : resolve(value);
    }
    function send() {
      if (sent) return;
      sent = true;
      ws.send(
        JSON.stringify(
          action ? { request: 'DoAction', id, action: { id: action }, args } : { request: 'GetActions', id }
        )
      );
    }
    ws.onerror = () => finish(Error('Streamer.bot connection failed'));
    ws.onclose = () => finish(Error('Streamer.bot disconnected'));
    ws.onmessage = e => {
      try {
        if (typeof e.data !== 'string' || e.data.length > 1048576) throw Error();
        const m = JSON.parse(e.data);
        if (m.request === 'Hello') {
          if (m.authentication)
            ws.send(
              JSON.stringify({
                request: 'Authenticate',
                id: 'auth',
                authentication: auth(password, m.authentication.salt, m.authentication.challenge)
              })
            );
          else send();
        } else if (m.id === 'auth') {
          if (m.status !== 'ok') return finish(Error('Streamer.bot password rejected'));
          send();
        } else if (m.id === id)
          finish(m.status === 'ok' ? null : Error('Streamer.bot rejected the request'), m);
      } catch {
        finish(Error('Invalid Streamer.bot response'));
      }
    };
  });
}
async function lumia(token, command) {
  if (!token || !command) throw Error('Set the Lumia token and command');
  const r = await fetch('http://127.0.0.1:39231/api/send?token=' + encodeURIComponent(token), {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'chat-command', params: { value: command } })
  });
  if (!r.ok) throw Error('Lumia rejected the command');
  const text = await r.text();
  if (text.length > 65536) throw Error('Invalid Lumia response');
  const d = JSON.parse(text);
  if (Number(d.status) >= 400) throw Error('Lumia rejected the command');
}
function category(k) {
  return (
    {
      Follow: 'Follows',
      Subscription: 'Subscriptions',
      Resubscription: 'Resubscriptions',
      GiftSubscription: 'Gift subscriptions',
      Cheer: 'Bits',
      Tip: 'Tips',
      Donation: 'Tips',
      Raid: 'Raids',
      SuperChat: 'Super Chats and Stickers',
      SuperSticker: 'Super Chats and Stickers',
      NewSponsor: 'Memberships',
      MemberMileStone: 'Memberships',
      MembershipGift: 'Memberships',
      KicksGifted: 'Kicks and gifts'
    }[k] || 'Other'
  );
}
function settings(d) {
  if (
    !Number.isInteger(d.port) ||
    d.port < 1024 ||
    d.port > 65535 ||
    !Array.isArray(d.mappings) ||
    d.mappings.length > 50
  )
    throw Error('Invalid integration settings');
  return {
    bot: !!d.bot,
    lumia: !!d.lumia,
    port: d.port,
    mappings: d.mappings.map(m => {
      if (
        typeof m.trigger !== 'string' ||
        m.trigger.length > 150 ||
        typeof m.action !== 'string' ||
        m.action.length > 100 ||
        typeof m.command !== 'string' ||
        m.command.length > 200
      )
        throw Error('Invalid action mapping');
      return { trigger: m.trigger, action: m.action, command: m.command };
    })
  };
}
module.exports = { bot, lumia, category, settings };
