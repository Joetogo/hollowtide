// The soundscape: an underwater ambience synthesised live with Web Audio. No sample files.
//
// One fixed graph, built on the first click, key or touch (browsers do not let a page make sound before that) and
// driven by a timer ten times a second, not by the frame loop. Layers: a low rumble, the wash of the surface, the
// rush of water past the swimmer (which follows their speed, so it surges with every stroke), a slow drone, the
// scooter's motor, and now and then bubbles, chimes and distant whale calls.
import type { Camera } from '../camera/camera';
import { Random } from '../math/random';
import { clamp } from '../math/scalar';

/** Master level: about -18.5 LUFS, peaks near -5.5 dBFS. */
const VOLUME = 0.78;
/** D major pentatonic, in semitones above A4. */
const CHIME_NOTES = [0, 2, 5, 7, 9, 12, 14, 17, 19];

interface Voice {
  pan: StereoPannerNode;
  gain: GainNode;
  oscillator: OscillatorNode;
}

export interface Soundscape {
  /** Call on every click, key and touch: builds the graph the first time, and resumes it when the browser allows. */
  wake(): void;
  setMuted(muted: boolean): void;
  /** 0..1, on top of the mix's own level. */
  setVolume(volume: number): void;
  /** How hard the scooter's motor is running, 0..1; call as often as it changes. */
  scooter(throttle: number): void;
}

export function createSoundscape(camera: Camera, startMuted: boolean): Soundscape {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = startMuted;
  let throttle = 0;
  let volume = 1;
  // its own random stream: the sound never disturbs anything else that draws random numbers
  const random = new Random();
  random.reseed(300);
  const rnd = () => random.next();
  const rr = (a: number, b: number) => random.range(a, b);

  /** Builds the graph and returns the function the timer calls. */
  const build = (ac: AudioContext): (() => void) => {
    const rate = ac.sampleRate;
    /** Connects a node to every node or parameter in `to`; sources start at once. */
    const wire = <T extends AudioNode>(node: T, to: (AudioNode | AudioParam)[]): T => {
      for (const target of to) node.connect(target as AudioNode);
      if ('start' in node) (node as unknown as AudioScheduledSourceNode).start();
      return node;
    };
    const gain = (value: number, ...to: (AudioNode | AudioParam)[]) => wire(new GainNode(ac, { gain: value }), to);
    const filter = (type: BiquadFilterType, frequency: number, Q: number, ...to: AudioNode[]) =>
      wire(new BiquadFilterNode(ac, { type, frequency, Q }), to);
    const lfo = (frequency: number, depth: number, to: AudioParam) =>
      wire(new OscillatorNode(ac, { frequency }), [gain(depth, to)]);
    const noise = (seconds: number, fill: (channel: Float32Array, length: number) => void) => {
      const length = (rate * seconds) | 0;
      const buffer = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: rate });
      fill(buffer.getChannelData(0), length);
      fill(buffer.getChannelData(1), length);
      return buffer;
    };
    // a seamless loop of brown noise: the end cross-fades into the start
    const brown = noise(11, (d, n) => {
      for (let i = 0, b = 0; i < n + 4096; i++) {
        b = (b + 0.02 * (rnd() * 2 - 1)) / 1.02;
        if (i < n) d[i] = b * 3.5;
        else {
          const k = (i - n) / 4096;
          d[i - n] = d[i - n]! * k + b * 3.5 * (1 - k);
        }
      }
    });
    // the reverb's impulse response: five seconds of noise that fades out and gets darker
    const impulse = noise(5, (d, n) => {
      for (let i = 0, b = 0; i < n; i++) {
        const t = i / rate;
        b += (rnd() * 2 - 1 - b) * (0.04 + 0.5 * Math.exp(-t * 2));
        d[i] = b * (1 - Math.exp(-t * 30)) * Math.exp(-t * 1.5) * (1 - i / n);
      }
    });

    const limiter = wire(
      new DynamicsCompressorNode(ac, { threshold: -6, knee: 6, ratio: 20, attack: 0.003, release: 0.3 }),
      [ac.destination],
    );
    const out = (master = gain(0, limiter));
    const wet = wire(new ConvolverNode(ac, { buffer: impulse }), [out]);
    const loop = (playbackRate: number, ...to: AudioNode[]) =>
      wire(new AudioBufferSourceNode(ac, { buffer: brown, loop: true, playbackRate }), to);
    // rumble
    const rumble = gain(0.34, out);
    loop(1, filter('lowpass', 150, 0.7, rumble));
    lfo(0.07, 0.11, rumble.gain);
    lfo(0.113, 0.08, rumble.gain);
    // surface wash and water rush: the same noise played at another speed, so the loops never line up
    const wash = gain(0.25, out),
      wave = gain(1, wash),
      rush = gain(0, out),
      rushFilter = filter('bandpass', 300, 0.9, rush);
    loop(0.63, filter('bandpass', 420, 0.5, wave), rushFilter);
    lfo(0.09, 0.3, wave.gain);
    lfo(0.151, 0.25, wave.gain);
    // drone: stacked fifths on D, each note a pair of slightly detuned sines that slowly beat
    const pad = gain(1, out, gain(1.5, wet));
    [73.42, 110, 164.81, 246.94, 369.99].forEach((f, i) => {
      const g = gain(0.022 - i * 0.003, pad);
      wire(new OscillatorNode(ac, { frequency: f }), [g]);
      wire(new OscillatorNode(ac, { frequency: f + rr(0.03, 0.11) }), [g]);
    });
    // the scooter's motor: a buzz and its octave, muffled the way everything is under water, wavering a little
    const motor = gain(0, out, gain(0.25, wet));
    const motorFilter = filter('lowpass', 380, 1.4, motor);
    const motorLow = wire(new OscillatorNode(ac, { type: 'sawtooth', frequency: 50 }), [gain(0.5, motorFilter)]);
    const motorHigh = wire(new OscillatorNode(ac, { type: 'square', frequency: 100 }), [gain(0.16, motorFilter)]);
    lfo(9.5, 2.2, motorLow.frequency);
    // pooled voices: oscillator -> envelope -> pan -> dry + reverb
    const pool = (count: number, send: number, type: OscillatorType = 'sine'): Voice[] =>
      Array.from({ length: count }, () => {
        const pan = wire(new StereoPannerNode(ac), [out, gain(send, wet)]);
        const g = gain(0, pan);
        return { pan, gain: g, oscillator: wire(new OscillatorNode(ac, { type }), [g]) };
      });
    const bubbles = pool(4, 0.12),
      chimes = pool(3, 1.2),
      whales = pool(2, 2, 'triangle');
    /** One note: the pitch glides from f0 to f1 over `duration`, the level rises to `volume` in `attack` and dies away. */
    const play = (
      voices: Voice[],
      t: number,
      f0: number,
      f1: number,
      duration: number,
      volume: number,
      attack: number,
    ) => {
      const voice = voices.shift()!;
      voices.push(voice);
      voice.pan.pan.setValueAtTime(rr(-0.7, 0.7), t);
      const f = voice.oscillator.frequency,
        g = voice.gain.gain;
      f.setValueAtTime(f0, t);
      f.exponentialRampToValueAtTime(f1, t + duration);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(volume, t + attack);
      g.setTargetAtTime(0, t + attack, (duration - attack) / 5);
    };

    let last = ac.currentTime,
      nextBubbles = last + 1.5,
      nextChime = last + 5,
      nextWhale = last + 12;
    let lx = camera.x,
      ly = camera.y,
      lz = camera.z;
    out.gain.setTargetAtTime(muted ? 0 : VOLUME * volume, last, 1);
    return () => {
      const now = ac.currentTime,
        t = now + 0.05,
        dt = now - last;
      if (dt <= 0) return;
      let speed = Math.hypot(camera.x - lx, camera.y - ly, camera.z - lz) / dt;
      if (speed > 60) speed = 0; // a jump to a viewpoint, not swimming
      last = now;
      lx = camera.x;
      ly = camera.y;
      lz = camera.z;
      rush.gain.setTargetAtTime(0.5 * Math.pow(Math.min(speed / 26, 1), 1.2), t, 0.3);
      rushFilter.frequency.setTargetAtTime(220 + speed * 14, t, 0.3);
      // the motor winds up and down with the throttle
      motor.gain.setTargetAtTime(0.17 * throttle, t, 0.12);
      motorLow.frequency.setTargetAtTime(50 + 34 * throttle, t, 0.18);
      motorHigh.frequency.setTargetAtTime((50 + 34 * throttle) * 2.01, t, 0.18);
      motorFilter.frequency.setTargetAtTime(300 + 260 * throttle, t, 0.2);
      // the surface is louder the nearer it is
      const shallow = clamp(1 + ly / 30, 0, 1);
      wash.gain.setTargetAtTime(0.25 + 0.55 * shallow * shallow, t, 0.5);
      if (t > nextBubbles) {
        // a burst of one to six bubbles: short rising blips, smaller bubbles higher and shorter
        let tt = t;
        for (let n = (1 + rnd() * rnd() * 6) | 0; n--;) {
          const f = rr(380, 1300);
          play(bubbles, tt, f, f * rr(1.4, 2.2), 0.05 + 40 / f, rr(0.03, 0.08), 0.006);
          tt += rr(0.07, 0.2);
        }
        nextBubbles = tt + rr(0.5, 5);
      }
      if (t > nextChime) {
        const f = 440 * Math.pow(2, CHIME_NOTES[(rnd() * 9) | 0]! / 12);
        play(chimes, t, f, f, 5, rr(0.02, 0.04), 0.03);
        nextChime = t + rr(2.5, 9);
      }
      if (t > nextWhale) {
        // a phrase of two or three slow glides
        let tt = t;
        for (let n = (2 + rnd() * 2) | 0; n--;) {
          const f = rr(170, 380),
            d = rr(1.6, 3.2);
          play(whales, tt, f, f * rr(0.6, 1.7), d, 0.08, d * 0.4);
          tt += d * 0.8;
        }
        nextWhale = tt + rr(20, 50);
      }
    };
  };

  document.addEventListener('visibilitychange', () => {
    if (context) void (document.hidden ? context.suspend() : context.resume());
  });

  return {
    wake() {
      if (!context) {
        context = new AudioContext({ latencyHint: 'playback' });
        setInterval(build(context), 100);
      }
      if (context.state === 'suspended' && !document.hidden) void context.resume();
    },
    setVolume(value) {
      volume = value;
      if (context && master) master.gain.setTargetAtTime(muted ? 0 : VOLUME * volume, context.currentTime, 0.08);
    },
    scooter(value) {
      throttle = value;
    },
    setMuted(value) {
      muted = value;
      if (context && master) master.gain.setTargetAtTime(muted ? 0 : VOLUME * volume, context.currentTime, 0.08);
    },
  };
}
