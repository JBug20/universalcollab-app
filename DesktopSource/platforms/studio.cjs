'use strict';
const crypto = require('node:crypto');
const { PlatformError } = require('./service.cjs');
const safeText = (v, n) => {
  if (typeof v !== 'string' || !v.trim() || v.length > n)
    throw new PlatformError('Check the stream title or connection name.');
  return v.trim();
};
function target(url, key = '') {
  try {
    const u = new URL(url);
    if (!['rtmp:', 'rtmps:'].includes(u.protocol) || u.username || u.password || u.search || u.hash)
      throw Error();
    if (!key) {
      const at = u.pathname.lastIndexOf('/');
      key = u.pathname.slice(at + 1);
      u.pathname = u.pathname.slice(0, at);
    }
    if (!/^[A-Za-z0-9_.-]{1,512}$/.test(key) || ['.', '..'].includes(key)) throw Error();
    return { url: u.href.replace(/\/$/, ''), key };
  } catch {
    throw new PlatformError('Enter a valid RTMP/RTMPS URL and stream key.');
  }
}
class StudioService {
  constructor(platform) {
    this.p = platform;
    this.db = platform.db;
    this.db.customConnections ??= [];
    this.db.streamDrafts ??= {};
  }
  snapshot() {
    return {
      custom: this.db.customConnections.map(({ id, name }) => ({ id, name })),
      drafts: Object.values(this.db.streamDrafts)
        .slice(-20)
        .map(d => ({
          id: d.id,
          title: d.input.title,
          broadcastId: d.broadcastId || '',
          state: d.state || 'draft'
        }))
    };
  }
  custom(input) {
    const name = safeText(input.name, 80),
      v = target(input.url, input.key);
    const id = input.id || crypto.randomUUID();
    if (['twitch', 'youtube'].includes(id) || !/^[A-Za-z0-9_-]{1,64}$/.test(id))
      throw new PlatformError('Invalid connection.');
    const next = this.db.customConnections.filter(c => c.id !== id);
    if (next.length >= 20) throw new PlatformError('Remove an unused custom connection first.');
    this.db.customConnections = [...next, { id, name, ...v }];
    this.p.save();
    return this.snapshot();
  }
  remove(id) {
    this.db.customConnections = this.db.customConnections.filter(c => c.id !== id);
    this.p.save();
    return this.snapshot();
  }
  validate(input) {
    for (const value of Object.values(input.resolutions || {}))
      if (!['', '2560x1440', '1920x1080', '1600x900', '1280x720', '854x480', '640x360'].includes(value))
        throw new PlatformError('Choose a supported output resolution.');
    if (
      input.qualities !== undefined &&
      (typeof input.qualities !== 'object' || input.qualities === null || Array.isArray(input.qualities))
    )
      throw new PlatformError('Invalid destination quality.');
    for (const q of Object.values(input.qualities || {})) {
      if (!q || typeof q !== 'object') throw new PlatformError('Invalid destination quality.');
      if (
        q.bitrateKbps != null &&
        (!Number.isInteger(q.bitrateKbps) || q.bitrateKbps < 500 || q.bitrateKbps > 20000)
      )
        throw new PlatformError('Destination bitrate must be 500–20000 kbps.');
      if (q.fps != null && ![24, 25, 30, 48, 50, 60].includes(q.fps))
        throw new PlatformError('Choose a supported destination frame rate.');
    }
    safeText(input.title, 100);
    if (typeof input.description !== 'string' || input.description.length > 5000)
      throw new PlatformError('Description is too long.');
    if (
      !Array.isArray(input.selected) ||
      !input.selected.length ||
      input.selected.length > 8 ||
      new Set(input.selected).size !== input.selected.length
    )
      throw new PlatformError('Choose 1–8 different destinations.');
    for (const id of input.selected) {
      if (['twitch', 'youtube'].includes(id)) this.p.account(id);
      else if (!this.db.customConnections.some(c => c.id === id))
        throw new PlatformError('Custom connection no longer exists.');
    }
    if (input.selected.includes('youtube') && !['private', 'unlisted', 'public'].includes(input.privacy))
      throw new PlatformError('Choose YouTube visibility.');
    for (const p of ['twitch', 'youtube'])
      if (input.selected.includes(p)) safeText(this.metadata(input, p).title, p === 'youtube' ? 100 : 140);
  }
  metadata(input, p) {
    return {
      title: input.sync === false ? input[p + 'Title'] || input.title : input.title,
      description:
        p === 'youtube'
          ? input.sync === false
            ? input.youtubeDescription || ''
            : input.description
          : undefined,
      categoryId: input.categoryId || '20',
      gameId: input.gameId || '',
      language: input.language || 'en'
    };
  }
  async prepare(input, progress = () => {}) {
    this.validate(input);
    if (!/^[a-f0-9-]{36}$/.test(input.id)) throw new PlatformError('Start a new stream draft.');
    let d = this.db.streamDrafts[input.id];
    if (!d) {
      d = { id: input.id, input, targets: [], state: 'preparing', accountIds: {} };
      this.db.streamDrafts[input.id] = d;
      this.p.save();
    }
    const report = (platform, message) => progress({ platform, message });
    const fail = (platform, e) => {
      const error =
        e instanceof PlatformError
          ? e
          : new PlatformError('Temporary platform failure. Retry preparation; completed resources are kept.');
      error.platform = platform;
      throw error;
    };
    const credentials = {};
    // Read-only checks for every selected platform precede all creation and metadata writes.
    for (const id of input.selected) {
      report(
        id,
        'Checking ' +
          (id === 'twitch' ? 'Twitch' : id === 'youtube' ? 'YouTube' : 'custom destination') +
          ' access…'
      );
      try {
        if (['twitch', 'youtube'].includes(id)) {
          const account = this.p.account(id);
          if (d.accountIds[id] && d.accountIds[id] !== account.id)
            throw new PlatformError('Linked account changed. Start a new stream for this account.');
          d.accountIds[id] = account.id;
        }
        if (id === 'twitch') {
          const v = await this.p.validateTwitch();
          if (
            !v.scopes?.includes('channel:read:stream_key') ||
            !v.scopes?.includes('channel:manage:broadcast')
          )
            throw new PlatformError(
              'Reconnect Twitch and approve stream-key access, then retry.',
              403,
              'reconnect'
            );
          const key = (
            await this.p.api(
              'twitch',
              'streams/key?broadcaster_id=' + encodeURIComponent(this.p.account(id).id)
            )
          ).data?.[0]?.stream_key;
          if (typeof key !== 'string' || !key)
            throw new PlatformError(
              'Twitch did not return a stream key. Reconnect Twitch and retry.',
              403,
              'reconnect'
            );
          const ingest = await this.p.raw('https://ingest.twitch.tv/ingests');
          const t = ingest.ingests?.find(x => x.default)?.url_template || ingest.ingests?.[0]?.url_template;
          if (!t || !t.endsWith('/{stream_key}'))
            throw new PlatformError('Twitch ingest address is unavailable. Retry preparation.');
          credentials[id] = { id, name: 'Twitch', ...target(t.slice(0, -'/{stream_key}'.length), key) };
        } else if (id === 'youtube') {
          await this.p.api('youtube', 'liveBroadcasts?part=id&mine=true&maxResults=1');
          if (d.uncertain)
            throw new PlatformError(
              'YouTube did not confirm a previous creation. Open YouTube Studio and check for an extra event before starting a new draft.'
            );
          if (d.broadcastId) {
            const item = (
              await this.p.api(
                'youtube',
                'liveBroadcasts?part=status&id=' + encodeURIComponent(d.broadcastId)
              )
            ).items?.[0];
            if (!item || ['complete', 'revoked'].includes(item.status?.lifeCycleStatus))
              throw new PlatformError('This YouTube event has ended or was removed. Click New stream.');
            if (['live', 'testing'].includes(item.status?.lifeCycleStatus))
              throw new PlatformError(
                'This YouTube event is already running. End it before preparing again.'
              );
            const settings = d.youtubeSettings || {
              privacy: d.input.privacy,
              madeForKids: !!d.input.madeForKids
            };
            if (settings.privacy !== input.privacy || settings.madeForKids !== !!input.madeForKids)
              throw new PlatformError(
                'This YouTube event already exists. Keep its original visibility and audience to retry, or use New stream to change them.'
              );
          }
        } else {
          credentials[id] = { ...this.db.customConnections.find(c => c.id === id) };
        }
      } catch (e) {
        if (id === 'twitch' && [401, 403].includes(e.status))
          e = new PlatformError(
            'Reconnect Twitch and approve stream-key access, then retry.',
            e.status,
            'reconnect'
          );
        fail(id, e);
      }
    }
    d.input = structuredClone(input);
    this.p.save();
    for (const id of input.selected) {
      report(
        id,
        'Preparing ' +
          (id === 'twitch' ? 'Twitch' : id === 'youtube' ? 'YouTube' : 'custom destination') +
          '…'
      );
      try {
        let prepared = credentials[id];
        if (id === 'twitch') {
          const meta = this.metadata(input, id),
            current = await this.p.twitchInfo();
          await this.p.updateTwitch({
            ...meta,
            gameId: meta.gameId || current.gameId,
            language: current.language || 'en'
          });
        } else if (id === 'youtube') {
          const meta = this.metadata(input, id);
          const create = async (fn, field) => {
            d.uncertain = true;
            this.p.save();
            try {
              const v = await fn();
              if (!v.id) throw Error();
              d[field] = v.id;
              d.uncertain = false;
              this.p.save();
              return v;
            } catch (e) {
              if (e.status >= 400 && e.status < 500) {
                d.uncertain = false;
                this.p.save();
              }
              throw e;
            }
          };
          if (!d.broadcastId) {
            d.youtubeSettings = { privacy: input.privacy, madeForKids: !!input.madeForKids };
            await create(
              () =>
                this.p.api('youtube', 'liveBroadcasts?part=snippet,status,contentDetails', {
                  method: 'POST',
                  body: {
                    snippet: {
                      title: meta.title,
                      description: meta.description,
                      scheduledStartTime: new Date(this.p.now() + 60000).toISOString()
                    },
                    status: {
                      privacyStatus: input.privacy,
                      selfDeclaredMadeForKids: input.madeForKids === true
                    },
                    contentDetails: {
                      enableAutoStart: true,
                      enableAutoStop: true,
                      monitorStream: { enableMonitorStream: false }
                    }
                  }
                }),
              'broadcastId'
            );
          }
          if (!d.streamId)
            await create(
              () =>
                this.p.api('youtube', 'liveStreams?part=snippet,cdn,contentDetails', {
                  method: 'POST',
                  body: {
                    snippet: { title: meta.title },
                    cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' },
                    contentDetails: { isReusable: false }
                  }
                }),
              'streamId'
            );
          await this.p.api(
            'youtube',
            'liveBroadcasts/bind?part=id,contentDetails&id=' +
              encodeURIComponent(d.broadcastId) +
              '&streamId=' +
              encodeURIComponent(d.streamId),
            { method: 'POST' }
          );
          await this.p.updateYoutube({ id: d.broadcastId, ...meta });
          const info = (
            await this.p.api('youtube', 'liveStreams?part=cdn&id=' + encodeURIComponent(d.streamId))
          ).items?.[0]?.cdn?.ingestionInfo;
          if (!info || typeof info.streamName !== 'string' || !info.streamName)
            throw new PlatformError('YouTube ingest details are not ready. Retry this draft.');
          prepared = {
            id,
            name: 'YouTube',
            ...target(info.rtmpsIngestionAddress || info.ingestionAddress, info.streamName)
          };
        }
        d.targets = d.targets.filter(t => t.id !== id);
        d.targets.push(prepared);
        this.p.save();
      } catch (e) {
        fail(id, e);
      }
    }
    d.state = 'prepared';
    this.p.save();
    return {
      id: input.id,
      title: input.title,
      record: !!input.record,
      destinations: input.selected.map(id => ({
        ...d.targets.find(t => t.id === id),
        resolution: input.resolutions?.[id] || null,
        bitrateKbps: input.qualities?.[id]?.bitrateKbps ?? null,
        fps: input.qualities?.[id]?.fps ?? null
      }))
    };
  }
  async update(input) {
    this.validate(input);
    const d = this.db.streamDrafts[input.id],
      results = [];
    for (const p of input.selected.filter(x => ['twitch', 'youtube'].includes(x))) {
      try {
        const meta = this.metadata(input, p);
        if (p === 'twitch') {
          const current = await this.p.twitchInfo();
          // Keep the channel's language, as prepare() does; the form has no language field.
          await this.p.updateTwitch({
            ...meta,
            gameId: meta.gameId || current.gameId,
            language: current.language || 'en'
          });
        } else {
          if (!d?.broadcastId) throw new PlatformError('Create a YouTube broadcast first.');
          await this.p.updateYoutube({ id: d.broadcastId, ...meta });
        }
        results.push({ platform: p, ok: true });
      } catch (e) {
        results.push({
          platform: p,
          ok: false,
          error: e instanceof PlatformError ? e.message : 'Update failed.'
        });
      }
    }
    return { results };
  }
}
module.exports = { StudioService, target };
