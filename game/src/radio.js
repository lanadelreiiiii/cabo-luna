// Cabo Luna — original procedural radio (Phase 6).
// Three invented stations, all music composed here as note patterns
// (semitone offsets from a root) and synthesised live with raw Web
// Audio oscillators — no audio files, no network, no copied music.
// ZzFX is one-shot only and its music sequencer (ZzFXM) was evaluated
// and NOT included in the audio skill, so the loops below are native
// Web Audio: a triangle melody blip + a sine bass + a soft chord pad,
// scheduled ahead in 16th-note steps.
//
// Hard rules (from the audio skill, adapted for music):
// - AudioContext ONLY after a user gesture, and NEVER in shot mode
//   (?shot=): dossier captures stay deterministic and silent-safe.
// - Radio defaults OFF (stationIndex -1). The player opts in with V.
// - No nodes per frame: notes are scheduled on a 90 ms timer, each
//   note creates its oscillators, plays, and disconnects on ended.
// - The pure part (stations, patterns, cycling, note lookup) is
//   renderer-free and Node-testable; only RadioPlayer touches audio.
export const STATIONS = [
  {
    id: 'luna-fm', name: 'LUNA FM', freq: '88.1', tagline: 'Sunset Drive',
    bpm: 92, root: 69, // A4
    // 32 sixteenth-note steps, one bar looped twice: null = rest.
    melody: [0, null, 3, null, 7, null, 5, 3, 0, null, 10, null, 7, null, 5, null,
      12, null, 10, null, 7, null, 5, 3, 0, null, 3, null, 5, null, 7, null],
    bass: [0, null, null, null, 0, null, null, null, -4, null, null, null, -4, null, null, null,
      3, null, null, null, 3, null, null, null, -2, null, null, null, -2, null, 5, null],
    chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], // one per 8 steps
  },
  {
    id: 'brisa-beat', name: 'BRISA BEAT', freq: '95.4', tagline: 'Night Cruise',
    bpm: 112, root: 62, // D4
    melody: [0, null, null, 3, null, 5, null, null, 7, null, 5, null, 3, null, null, 0,
      0, null, null, 3, null, 5, null, 7, 10, null, 7, null, 5, null, 3, null],
    bass: [0, 0, null, 0, null, 0, null, null, -2, null, 0, null, -2, null, null, 0,
      3, null, 0, null, 3, null, 0, null, 5, null, 3, null, 5, null, null, 0],
    chords: [[0, 3, 7], [0, 3, 7], [-2, 2, 5], [3, 7, 10]],
  },
  {
    id: 'faro', name: 'FARO', freq: '101.7', tagline: 'Harbor Lights',
    bpm: 76, root: 60, // C4
    melody: [0, null, null, null, 4, null, null, null, 7, null, null, null, 4, null, 0, null,
      12, null, null, null, 7, null, null, null, 4, null, null, null, 0, null, null, null],
    bass: [0, null, null, null, null, null, null, null, -4, null, null, null, null, null, null, null,
      -2, null, null, null, null, null, null, null, 3, null, null, null, null, null, null, null],
    chords: [[0, 4, 7], [-4, 0, 3], [-2, 2, 5], [3, 7, 11]],
  },
];

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Seconds per 16th-note step at the station tempo.
export function stepDuration(station) {
  return 60 / station.bpm / 4;
}

// The notes sounding on one step: { melody, bass } as MIDI numbers
// (null = rest). Step wraps over the 32-step loop.
export function noteAt(station, step) {
  const i = ((step % 32) + 32) % 32;
  const m = station.melody[i];
  const b = station.bass[i];
  return {
    melody: m === null || m === undefined ? null : station.root + m,
    bass: b === null || b === undefined ? null : station.root - 24 + b,
  };
}

// The chord pad sounding at a bar boundary (every 8 steps): MIDI notes.
export function chordAt(station, step) {
  const bar = Math.floor((((step % 32) + 32) % 32) / 8) % station.chords.length;
  return station.chords[bar].map((o) => station.root + o);
}

export function createRadio() {
  return { stationIndex: -1, step: 0 };
}

export function currentStation(radio) {
  return radio.stationIndex < 0 ? null : STATIONS[radio.stationIndex];
}

// V key: OFF -> Luna -> Brisa -> Faro -> OFF. Resets the step so a
// station always starts on its first note.
export function cycleRadio(radio) {
  radio.stationIndex = radio.stationIndex >= STATIONS.length - 1
    ? -1
    : radio.stationIndex + 1;
  radio.step = 0;
  return currentStation(radio);
}

export function radioHud(radio) {
  const s = currentStation(radio);
  // Station + frequency + the station's tagline ("Sunset Drive" is
  // LUNA FM's show line) — the HUD line reads like the top entries'
  // named station + song lines, and every word of it is real state.
  return s ? `${s.name} ${s.freq} · ${s.tagline}` : 'RADIO OFF';
}

export function advanceStep(radio) {
  const station = currentStation(radio);
  radio.step += 1;
  return station ? noteAt(station, radio.step - 1) : { melody: null, bass: null };
}

// --- Browser player ---------------------------------------------------
// Thin Web Audio scheduler around a radio state object. Every method
// is a safe no-op before init() (gesture-only) or when the context
// factory fails — the game never throws for audio. Shot mode never
// constructs a player (see main.js), so captures stay silent.
export function createRadioPlayer(radio, contextFactory) {
  let ctx = null;
  let master = null;
  let timer = null;
  let playing = false;
  let nextTime = 0;
  let nextStep = 0;
  let notesScheduled = 0;

  function blip(freq, time, dur, type, gain) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(time);
    osc.stop(time + dur + 0.02);
    osc.onended = () => { osc.disconnect(); g.disconnect(); };
  }

  function scheduleStep(step, time) {
    const station = currentStation(radio);
    if (!station) return;
    const note = noteAt(station, step);
    if (note.melody !== null) blip(midiToFreq(note.melody), time, 0.16, 'triangle', 0.12);
    if (note.bass !== null) blip(midiToFreq(note.bass), time, 0.22, 'sine', 0.18);
    if (step % 8 === 0) {
      for (const m of chordAt(station, step)) {
        blip(midiToFreq(m), time, 1.6, 'triangle', 0.025);
      }
    }
    notesScheduled += 1;
  }

  function scheduleAhead() {
    if (!playing || !ctx) return;
    const station = currentStation(radio);
    if (!station) return;
    while (nextTime < ctx.currentTime + 0.25) {
      scheduleStep(nextStep, nextTime);
      nextTime += stepDuration(station);
      nextStep += 1;
    }
  }

  return {
    init() {
      if (ctx) return true;
      try {
        ctx = contextFactory();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
        return true;
      } catch {
        ctx = null;
        return false;
      }
    },
    start() {
      if (playing || !ctx || !currentStation(radio)) return false;
      if (ctx.state === 'suspended' && ctx.resume) {
        try { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); } catch { /* stay silent */ }
      }
      playing = true;
      nextTime = ctx.currentTime + 0.05;
      nextStep = radio.step;
      timer = setInterval(scheduleAhead, 90);
      return true;
    },
    stop() {
      if (timer !== null) { clearInterval(timer); timer = null; }
      playing = false;
      return true;
    },
    // Called after cycleRadio: re-anchor the scheduler to the new
    // station's first step; a no-op while stopped.
    retune() {
      if (!playing || !ctx) return;
      nextTime = ctx.currentTime + 0.05;
      nextStep = radio.step;
    },
    dispose() {
      this.stop();
      if (ctx && ctx.close) { try { ctx.close(); } catch { /* ignore */ } }
      ctx = null; master = null;
    },
    getStats() {
      return {
        initialized: !!ctx,
        contextState: ctx ? ctx.state : 'none',
        playing,
        station: currentStation(radio)?.id ?? null,
        notesScheduled,
      };
    },
  };
}
