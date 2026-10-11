'use strict';
const sources = require('./obs-sources.cjs');
const name = v => {
  if (typeof v !== 'string' || !v.trim() || v.length > 512) throw Error('Choose a valid OBS name.');
  return v;
};
const num = (v, min, max) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw Error('OBS value is outside its allowed range.');
  return v;
};
const bool = v => {
  if (typeof v !== 'boolean') throw Error('Invalid checkbox value.');
  return v;
};
// Clip needs OBS's replay buffer, which is switched on per OBS profile. OBS applies the change when nothing is
// streaming or recording.
const REPLAY_OFF =
  "OBS's replay buffer is switched off in this OBS profile. Stop streaming and recording, then in OBS: Settings → Output → Replay Buffer → tick Enable Replay Buffer → OK. Press Clip again after that.";
// Recording scene (1.2.0): with the Source Record plugin (exeldro, obsproject.com) a scene can be recorded on its
// own while another scene is streamed. UniversalCollab puts one Source Record filter, "UniversalCollab recording",
// on the chosen scene and starts or stops it by switching its record mode between Always and None (the same thing
// the plugin's own record_start / record_stop do). The file goes to OBS's recordings folder.
const SCENE_FILTER = 'UniversalCollab recording',
  SOURCE_RECORD = 'source_record_filter',
  SOURCE_RECORD_PAGE = 'https://obsproject.com/forum/resources/source-record.1285/';
const SOURCE_RECORD_MISSING =
  'The Source Record plugin is not installed in OBS, so the recording scene cannot be recorded. Install it (Settings → OBS → Recording scene → Get Source Record), restart OBS, then try again.';
const RECORD_WHAT = ['program', 'scene', 'both'];
// What Record records: the normal OBS recording (what's on stream), the recording scene, or both.
function recording(i) {
  const scene = typeof i?.recordScene === 'string' && i.recordScene.length <= 512 ? i.recordScene : '';
  const what = scene && RECORD_WHAT.includes(i?.recordWhat) ? i.recordWhat : 'program';
  return { scene: what === 'program' ? '' : scene, program: what !== 'scene' };
}
class OBSControls {
  constructor(link) {
    this.link = link;
    this.available = null;
    this.ownVirtualCam = false;
    // The recording scene being recorded: { scene, since }.
    this.sceneRec = null;
  }
  async call(type, data = {}) {
    if (this.available && !this.available.has(type))
      throw Error('This OBS version does not support ' + type + '.');
    return this.link.request(type, data);
  }
  async init() {
    const v = await this.link.request('GetVersion');
    this.available = new Set(v.availableRequests || []);
    return { connected: true, version: v.obsVersion, available: [...this.available] };
  }
  async quiet() {
    let resume = false;
    if (this.ownVirtualCam && this.available?.has('StopVirtualCam')) {
      try {
        if ((await this.call('GetVirtualCamStatus')).outputActive) {
          await this.call('StopVirtualCam');
          resume = true;
        }
      } catch {}
      this.ownVirtualCam = false;
    }
    try {
      for (const t of ['GetStreamStatus', 'GetRecordStatus', 'GetReplayBufferStatus', 'GetVirtualCamStatus'])
        if (this.available?.has(t) && (await this.call(t)).outputActive)
          throw Error(
            'Stop streaming, recording, replay buffer and virtual camera before changing video settings.'
          );
    } catch (e) {
      if (resume) await this.virtualCam(true).catch(() => {});
      throw e;
    }
    return resume;
  }
  async virtualCam(enabled) {
    if (!this.available?.has('GetVirtualCamStatus') || !this.available.has('StartVirtualCam'))
      throw Error('This OBS version has no virtual camera (OBS 28 or newer needed).');
    const active = !!(await this.call('GetVirtualCamStatus')).outputActive;
    if (enabled) {
      if (!active) {
        try {
          await this.call('StartVirtualCam');
        } catch {
          throw Error(
            'OBS could not start its virtual camera. In OBS, check Tools → Virtual Camera / Start Virtual Camera works.'
          );
        }
        this.ownVirtualCam = true;
      }
      return { active: true, startedByApp: this.ownVirtualCam };
    }
    if (this.ownVirtualCam && active) await this.call('StopVirtualCam').catch(() => {});
    this.ownVirtualCam = false;
    return { active: false };
  }
  // Clips use OBS's replay buffer: OBS keeps the last few seconds in memory and saves them as a file
  // in its recording folder on the OBS computer when asked.
  async replayStatus() {
    if (!this.available?.has('GetReplayBufferStatus') || !this.available.has('SaveReplayBuffer'))
      return { supported: false };
    // OBS refuses GetReplayBufferStatus when the replay buffer is turned off in the current profile.
    let active;
    try {
      active = !!(await this.call('GetReplayBufferStatus')).outputActive;
    } catch {
      return { supported: true, enabled: false, active: false };
    }
    let seconds = null;
    if (this.available.has('GetProfileParameter'))
      try {
        const mode = (
          await this.call('GetProfileParameter', { parameterCategory: 'Output', parameterName: 'Mode' })
        ).parameterValue;
        const r = await this.call('GetProfileParameter', {
          parameterCategory: mode === 'Advanced' ? 'AdvOut' : 'SimpleOutput',
          parameterName: 'RecRBTime'
        });
        seconds = Number(r.parameterValue ?? r.defaultParameterValue) || null;
      } catch {}
    return { supported: true, active, seconds };
  }
  async replayStart() {
    const s = await this.replayStatus();
    if (!s.supported) throw Error('This OBS version has no replay buffer, so it cannot save clips.');
    if (s.active) return s;
    try {
      await this.call('StartReplayBuffer');
    } catch {
      throw Error(REPLAY_OFF);
    }
    return { ...s, active: true, started: true };
  }
  async lastReplay() {
    if (!this.available?.has('GetLastReplayBufferReplay')) return '';
    try {
      return (await this.call('GetLastReplayBufferReplay')).savedReplayPath || '';
    } catch {
      return '';
    }
  }
  async clip() {
    const s = await this.replayStatus();
    // A buffer that has only just started holds nothing yet, so the first press starts it.
    if (s.enabled === false) throw Error(REPLAY_OFF);
    if (!s.active) return this.replayStart();
    const before = await this.lastReplay();
    await this.call('SaveReplayBuffer');
    // OBS writes the file in the background and then reports its path.
    for (let i = 0; i < 40 && this.available.has('GetLastReplayBufferReplay'); i++) {
      await new Promise(r => setTimeout(r, 250));
      const now = await this.lastReplay();
      if (now && now !== before) {
        this.clips = [now, ...(this.clips || []).filter(p => p !== now)].slice(0, 50);
        return { ...s, saved: true, path: now };
      }
    }
    return { ...s, saved: true, path: '' };
  }
  // Source Record installed in this OBS: true, false, or null when this OBS cannot say (obs-websocket before 5.4).
  async sourceRecordInstalled() {
    if (!this.available.has('GetSourceFilterKindList')) return null;
    try {
      return (await this.call('GetSourceFilterKindList')).sourceFilterKinds.includes(SOURCE_RECORD);
    } catch {
      return null;
    }
  }
  async sceneFilter(scene) {
    try {
      return await this.link.request('GetSourceFilter', { sourceName: scene, filterName: SCENE_FILTER });
    } catch (e) {
      if (e.obsCode === 600) return null;
      throw e;
    }
  }
  // Is the recording scene recording? { scene, active, since }.
  async sceneStatus(scene) {
    if (!scene) return null;
    let f = null;
    try {
      f = await this.sceneFilter(scene);
    } catch {}
    const active = !!(
      f &&
      f.filterKind === SOURCE_RECORD &&
      f.filterEnabled &&
      f.filterSettings?.record_mode === 1
    );
    if (!active && this.sceneRec?.scene === scene) this.sceneRec = null;
    // Started outside this run of the app (or before a restart): count from when it was first seen.
    if (active && this.sceneRec?.scene !== scene) this.sceneRec = { scene, since: Date.now() };
    return { scene, active, since: active ? this.sceneRec.since : 0 };
  }
  async sceneStart(scene) {
    const { scenes } = await this.call('GetSceneList');
    if (!scenes.some(s => s.sceneName === scene))
      throw Error(
        'OBS has no scene called "' + scene + '". Choose the recording scene again in Settings → OBS.'
      );
    if ((await this.sourceRecordInstalled()) === false) throw Error(SOURCE_RECORD_MISSING);
    const directory = this.available.has('GetRecordDirectory')
      ? (await this.call('GetRecordDirectory')).recordDirectory
      : '';
    const filterSettings = {
      record_mode: 1,
      filename_formatting: '%CCYY-%MM-%DD %hh-%mm-%ss Recording scene',
      ...(directory ? { path: directory } : {})
    };
    const f = await this.sceneFilter(scene);
    if (f && f.filterKind !== SOURCE_RECORD)
      throw Error('The filter "' + SCENE_FILTER + '" on "' + scene + '" is not a Source Record filter.');
    if (!f)
      try {
        await this.call('CreateSourceFilter', {
          sourceName: scene,
          filterName: SCENE_FILTER,
          filterKind: SOURCE_RECORD,
          filterSettings
        });
      } catch (e) {
        if (e.obsCode === 607) throw Error(SOURCE_RECORD_MISSING);
        throw e;
      }
    else
      await this.call('SetSourceFilterSettings', {
        sourceName: scene,
        filterName: SCENE_FILTER,
        filterSettings,
        overlay: true
      });
    await this.call('SetSourceFilterEnabled', {
      sourceName: scene,
      filterName: SCENE_FILTER,
      filterEnabled: true
    });
    this.sceneRec = { scene, since: Date.now() };
  }
  async sceneStop(scene) {
    if (!scene || !(await this.sceneFilter(scene))) return;
    await this.call('SetSourceFilterSettings', {
      sourceName: scene,
      filterName: SCENE_FILTER,
      filterSettings: { record_mode: 0 },
      overlay: true
    });
    this.sceneRec = null;
  }
  // The recording state the window shows: OBS's own recording and the recording scene together. The timer counts
  // the OBS recording when there is one, else the recording scene.
  async recordState(i) {
    const program = await this.call('GetRecordStatus');
    const rec = recording(i);
    const scene = await this.sceneStatus(rec.scene || this.sceneRec?.scene || '');
    if (!scene?.active) return { ...program, programActive: !!program.outputActive, scene };
    return {
      ...program,
      outputActive: true,
      outputDuration: program.outputActive ? program.outputDuration : Date.now() - scene.since,
      outputPaused: program.outputActive ? program.outputPaused : false,
      programActive: !!program.outputActive,
      scene
    };
  }
  async recordStart(i) {
    const rec = recording(i);
    if (rec.scene) await this.sceneStart(rec.scene);
    if (rec.program)
      try {
        if (!(await this.call('GetRecordStatus')).outputActive) await this.call('StartRecord');
      } catch (e) {
        if (rec.scene) await this.sceneStop(rec.scene).catch(() => {});
        throw e;
      }
    return this.recordState(i);
  }
  // Stops everything that is recording: OBS's recording and the recording scene (also one chosen before).
  async recordStop(i) {
    const rec = recording(i);
    const errors = [];
    for (const scene of new Set([rec.scene, this.sceneRec?.scene].filter(Boolean)))
      await this.sceneStop(scene).catch(e => errors.push(e));
    if ((await this.call('GetRecordStatus')).outputActive) await this.call('StopRecord');
    if (errors.length) throw errors[0];
    return this.recordState(i);
  }
  // Settings → OBS → Recording scene: is Source Record there, and is the chosen scene recording.
  async sceneRecordInfo(i) {
    const scene = typeof i.recordScene === 'string' ? i.recordScene : '';
    const installed = await this.sourceRecordInstalled();
    const f = scene ? await this.sceneFilter(scene).catch(() => null) : null;
    return {
      installed: installed ?? (f?.filterKind === SOURCE_RECORD ? true : null),
      page: SOURCE_RECORD_PAGE,
      ...(scene ? await this.sceneStatus(scene) : {})
    };
  }
  // Pre-stream readiness (readiness.js): read-only. The encoders come from the OBS profile (Simple or Advanced
  // output mode); the relay needs H.264 video and AAC audio.
  async readiness(i = {}) {
    const param = async (parameterCategory, parameterName) => {
      try {
        return (
          (await this.call('GetProfileParameter', { parameterCategory, parameterName })).parameterValue || ''
        );
      } catch {
        return '';
      }
    };
    const mode = (await param('Output', 'Mode')) || 'Simple';
    const advanced = mode === 'Advanced';
    const encoder = advanced
      ? await param('AdvOut', 'Encoder')
      : await param('SimpleOutput', 'StreamEncoder');
    const audioEncoder = advanced ? await param('AdvOut', 'AudioEncoder') : '';
    // Replay buffer turned on in the profile (needed for Clip).
    const replayEnabled = (await param(advanced ? 'AdvOut' : 'SimpleOutput', 'RecRB')) === 'true';
    const safe = p => p.catch(() => null);
    const [video, stream, record, replay] = await Promise.all([
      safe(this.call('GetVideoSettings')),
      safe(this.call('GetStreamStatus')),
      safe(this.call('GetRecordStatus')),
      safe(this.replayStatus())
    ]);
    const rec = recording(i);
    let sceneRecord = null;
    if (rec.scene) {
      const { scenes } = await this.call('GetSceneList').catch(() => ({ scenes: [] }));
      sceneRecord = {
        scene: rec.scene,
        exists: scenes.some(s => s.sceneName === rec.scene),
        installed: await this.sourceRecordInstalled(),
        program: rec.program
      };
    }
    return {
      mode,
      encoder,
      sceneRecord,
      audioEncoder,
      video,
      streaming: !!stream?.outputActive,
      recording: !!record?.outputActive,
      replay: replay && {
        supported: !!replay.supported,
        enabled: replayEnabled && replay.enabled !== false,
        active: !!replay.active
      }
    };
  }
  // The device list of a new source (cameras, screens, windows, microphones), from OBS itself.
  async choices(inputName, type) {
    const t = sources.TYPES[type];
    if (!t || !this.available.has('GetInputPropertiesListPropertyItems'))
      return { property: null, items: [] };
    for (const propertyName of t.choose) {
      try {
        const { propertyItems } = await this.call('GetInputPropertiesListPropertyItems', {
          inputName,
          propertyName
        });
        if (propertyItems?.length) {
          const { inputSettings } = await this.call('GetInputSettings', { inputName }).catch(() => ({}));
          return {
            property: propertyName,
            current: inputSettings?.[propertyName] ?? null,
            items: propertyItems
              .filter(p => p.itemEnabled !== false)
              .slice(0, 200)
              .map(p => ({ name: String(p.itemName || p.itemValue), value: p.itemValue }))
          };
        }
      } catch {}
    }
    return { property: null, items: [] };
  }
  async handle(op, i = {}) {
    if (!this.link.ready) throw Error('Connect OBS first.');
    if (!this.available) await this.init();
    if (op === 'snapshot') {
      const [scenes, stream, record, inputs] = await Promise.all([
        this.call('GetSceneList'),
        this.call('GetStreamStatus'),
        this.call('GetRecordStatus'),
        this.call('GetInputList')
      ]);
      let studioMode = false;
      if (this.available.has('GetStudioModeEnabled')) {
        try {
          studioMode = !!(await this.call('GetStudioModeEnabled')).studioModeEnabled;
        } catch {}
      }
      const preview = studioMode ? scenes.currentPreviewSceneName || null : null;
      const sceneName = i.sceneName ? name(i.sceneName) : preview || scenes.currentProgramSceneName;
      const items = sceneName ? (await this.call('GetSceneItemList', { sceneName })).sceneItems : [];
      const mixer = [];
      for (const input of (inputs.inputs || []).slice(0, 64)) {
        try {
          const [volume, mute] = await Promise.all([
            this.call('GetInputVolume', { inputName: input.inputName }),
            this.call('GetInputMute', { inputName: input.inputName })
          ]);
          mixer.push({ inputName: input.inputName, ...volume, ...mute });
        } catch {}
      }
      let virtualCam = null;
      if (this.available.has('GetVirtualCamStatus')) {
        try {
          virtualCam = !!(await this.call('GetVirtualCamStatus')).outputActive;
        } catch {}
      }
      return {
        connected: true,
        scenes: scenes.scenes,
        current: scenes.currentProgramSceneName,
        preview,
        studioMode,
        sceneName,
        items,
        inputs: inputs.inputs,
        mixer,
        stream,
        record: await this.recordState(i).catch(() => record),
        virtualCam,
        available: [...this.available]
      };
    }
    if (op === 'preview') {
      const width = num(i.width, 160, 2560);
      // Studio mode: the editor shows the preview scene; otherwise the program scene.
      let sourceName = (await this.call('GetCurrentProgramScene')).currentProgramSceneName;
      if (i.scene === 'preview') {
        try {
          sourceName = (await this.call('GetCurrentPreviewScene')).currentPreviewSceneName || sourceName;
        } catch {}
      }
      const r = await this.call('GetSourceScreenshot', {
        sourceName,
        imageFormat: 'jpeg',
        imageWidth: width,
        imageCompressionQuality: 65
      });
      if (
        typeof r.imageData !== 'string' ||
        r.imageData.length > 3 * 1024 * 1024 ||
        !r.imageData.startsWith('data:image/jpeg;base64,')
      )
        throw Error('OBS preview image is unavailable.');
      return { image: r.imageData };
    }
    if (op === 'virtualcam') return this.virtualCam(bool(i.enabled));
    if (op === 'meters') {
      this.link.subscribe(bool(i.enabled));
      return {};
    }
    if (op === 'settings')
      return {
        video: await this.call('GetVideoSettings'),
        record: this.available.has('GetRecordDirectory') ? await this.call('GetRecordDirectory') : null
      };
    if (op === 'video') {
      const data = {};
      for (const k of ['baseWidth', 'baseHeight', 'outputWidth', 'outputHeight'])
        data[k] = num(i[k], 16, 8192);
      data.fpsNumerator = num(i.fpsNumerator, 1, 240000);
      data.fpsDenominator = num(i.fpsDenominator, 1, 1001);
      if (data.fpsNumerator / data.fpsDenominator > 240) throw Error('Maximum 240 frames per second.');
      for (const v of Object.values(data))
        if (!Number.isInteger(v)) throw Error('Video settings must be whole numbers.');
      const resume = await this.quiet();
      try {
        return await this.call('SetVideoSettings', data);
      } finally {
        if (resume) await this.virtualCam(true).catch(() => {});
      }
    }
    if (op === 'record-directory') {
      if ((await this.call('GetRecordStatus')).outputActive)
        throw Error('Stop recording before changing its folder.');
      return this.call('SetRecordDirectory', { recordDirectory: name(i.directory) });
    }
    if (op === 'readiness') return this.readiness(i);
    if (op === 'scene-record-info') return this.sceneRecordInfo(i);
    if (op === 'replay-status') return this.replayStatus();
    if (op === 'replay-start') return this.replayStart();
    if (op === 'clip') return this.clip();
    if (op === 'record-start') return this.recordStart(i);
    if (op === 'record-stop') return this.recordStop(i);
    if (op === 'stream-stop') return this.call('StopStream');
    if (op === 'studio-mode') {
      await this.call('SetStudioModeEnabled', { studioModeEnabled: bool(i.enabled) });
      return { studioMode: bool(i.enabled) };
    }
    if (op === 'preview-scene') return this.call('SetCurrentPreviewScene', { sceneName: name(i.sceneName) });
    if (op === 'transition') return this.call('TriggerStudioModeTransition');
    if (op === 'scene-switch') return this.call('SetCurrentProgramScene', { sceneName: name(i.sceneName) });
    if (op === 'scene-create') return this.call('CreateScene', { sceneName: name(i.sceneName) });
    if (op === 'scene-rename')
      return this.call('SetSceneName', { sceneName: name(i.sceneName), newSceneName: name(i.newName) });
    if (op === 'scene-delete') {
      const s = await this.call('GetSceneList');
      if (s.scenes.length <= 1) throw Error('Keep at least one OBS scene.');
      return this.call('RemoveScene', { sceneName: name(i.sceneName) });
    }
    // New sources (obs-sources.cjs).
    if (op === 'source-types') {
      if (!this.available.has('GetInputKindList')) return [];
      const { inputKinds } = await this.call('GetInputKindList', { unversioned: false });
      return sources.available(inputKinds).map(({ type, label }) => ({ type, label }));
    }
    if (op === 'source-create') {
      const t = sources.TYPES[i.type];
      if (!t) throw Error('Choose what kind of source to add.');
      const { inputKinds } = await this.call('GetInputKindList', { unversioned: false });
      const kind = sources.available(inputKinds).find(a => a.type === i.type)?.kind;
      if (!kind) throw Error('This OBS cannot make that kind of source.');
      const inputName = sources.sourceName(i.name);
      const settings = sources.settingsFor(i.type, {
        ...i,
        file: t.file ? sources.file(i.type, i.file) : undefined
      });
      try {
        await this.call('CreateInput', {
          sceneName: name(i.sceneName),
          inputName,
          inputKind: kind,
          inputSettings: settings,
          sceneItemEnabled: true
        });
      } catch (e) {
        if (e.obsCode === 601)
          throw Error('OBS already has a source called "' + inputName + '". Choose another name.');
        throw e;
      }
      return { inputName, kind, ...(await this.choices(inputName, i.type)) };
    }
    if (op === 'source-choices') return this.choices(name(i.inputName), i.type);
    if (op === 'source-choose') {
      if (!sources.CHOOSABLE.has(i.property)) throw Error('That setting cannot be changed here.');
      if (!['string', 'number'].includes(typeof i.value)) throw Error('Invalid choice.');
      return this.call('SetInputSettings', {
        inputName: name(i.inputName),
        inputSettings: { [i.property]: i.value }
      });
    }
    if (op === 'source-add')
      return this.call('CreateSceneItem', {
        sceneName: name(i.sceneName),
        sourceName: name(i.sourceName),
        sceneItemEnabled: true
      });
    if (op === 'volume')
      return this.call('SetInputVolume', { inputName: name(i.inputName), inputVolumeDb: num(i.db, -100, 0) });
    if (op === 'mute')
      return this.call('SetInputMute', { inputName: name(i.inputName), inputMuted: bool(i.muted) });
    if (op.startsWith('source-')) {
      const data = { sceneName: name(i.sceneName), sceneItemId: num(i.id, 0, 2147483647) };
      if (!Number.isInteger(data.sceneItemId)) throw Error('Invalid source.');
      if (op === 'source-visible')
        return this.call('SetSceneItemEnabled', { ...data, sceneItemEnabled: bool(i.enabled) });
      if (op === 'source-lock')
        return this.call('SetSceneItemLocked', { ...data, sceneItemLocked: bool(i.locked) });
      if (op === 'source-delete') return this.call('RemoveSceneItem', data);
      if (op === 'source-order')
        return this.call('SetSceneItemIndex', { ...data, sceneItemIndex: num(i.index, 0, 10000) });
      if (op === 'source-transform') {
        if ((await this.call('GetSceneItemLocked', data)).sceneItemLocked)
          throw Error('Unlock this OBS source before moving or resizing it.');
        const sceneItemTransform = {
          positionX: num(i.x, -16384, 16384),
          positionY: num(i.y, -16384, 16384),
          scaleX: num(i.scaleX, 0.01, 100),
          scaleY: num(i.scaleY, 0.01, 100),
          rotation: num(i.rotation, -360, 360)
        };
        return this.call('SetSceneItemTransform', { ...data, sceneItemTransform });
      }
    }
    throw Error('Unknown OBS control.');
  }
}
module.exports = { OBSControls, SCENE_FILTER, SOURCE_RECORD_PAGE, recording };
