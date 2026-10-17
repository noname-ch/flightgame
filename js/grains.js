// The jets' screech player (an AudioWorklet, loaded by sound.js): a recording played in short overlapping grains,
// so its pitch and its speed are set apart (the mixer's screech pitch and speed, F6). Each grain plays a piece of the
// recording at `pitch` (1: as recorded) from where the playhead is, the playhead moving on at `speed` (1: as
// recorded; 0.5 half as fast, the scream wavering half as fast). Every grain starts a little before or after the
// playhead and a little sharp or flat, and the whole pitch wanders slowly: the recording never repeats exactly, so a
// slowed-down take stays rough instead of turning into a hum (the stretching before it, WSOLA, locked onto the
// take's steadiest tone and repeated it: "some screeches still sound like drones").
class Grains extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitch', defaultValue: 1, minValue: 0.05, maxValue: 8, automationRate: 'k-rate' },
      { name: 'speed', defaultValue: 1, minValue: 0, maxValue: 8, automationRate: 'k-rate' },
    ];
  }

  // processorOptions: data (Float32Array, the recording, looping), sr (its sample rate), grain (s), jitter (s
  // either way), spread (each grain's pitch ± that much), wander (the slow pitch drift ± that much).
  constructor(o) {
    super();
    const p = o.processorOptions;
    this.x = p.data;
    this.n = this.x.length;
    this.k = p.sr / sampleRate; // (recording samples a sample at pitch 1)
    this.len = Math.max(64, Math.round(sampleRate * p.grain));
    this.hop = this.len / 4; // (four at a time)
    this.w = new Float32Array(this.len);
    for (let i = 0; i < this.len; i++) this.w[i] = (0.5 - 0.5 * Math.cos(2 * Math.PI * i / this.len)) / Math.sqrt(1.5); // (Hann; four of them, not in step, at the recording's level)
    this.jit = p.jitter * p.sr;
    this.spread = p.spread;
    this.wander = p.wander;
    this.ph = [0, 1, 2].map(() => Math.random() * 2 * Math.PI);
    this.t = 0;
    this.pos = Math.random() * this.n;
    this.next = 0;
    this.g = [];
    this.live = true;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.live = false; };
  }

  process(inputs, outputs, P) {
    const out = outputs[0][0];
    if (!out) return this.live;
    const pitch = P.pitch[0];
    const adv = P.speed[0] * this.k;
    const { x, n, w, len, g } = this;
    for (let i = 0; i < out.length; i++) {
      if (this.next <= 0) {
        this.next += this.hop;
        const t = this.t / sampleRate;
        const drift = 1 + this.wander * (0.5 * Math.sin(1.9 * t + this.ph[0]) + 0.3 * Math.sin(4.8 * t + this.ph[1]) + 0.2 * Math.sin(11 * t + this.ph[2]));
        let at = (this.pos + (Math.random() * 2 - 1) * this.jit) % n;
        if (at < 0) at += n;
        g.push({ at, step: pitch * this.k * drift * (1 + this.spread * (Math.random() * 2 - 1)), i: 0 });
      }
      this.next--;
      let y = 0;
      for (let j = g.length - 1; j >= 0; j--) {
        const gr = g[j];
        const a = gr.at | 0;
        const f = gr.at - a;
        y += (x[a] + (x[a + 1 < n ? a + 1 : 0] - x[a]) * f) * w[gr.i];
        gr.at += gr.step;
        if (gr.at >= n) gr.at -= n;
        if (++gr.i >= len) g.splice(j, 1);
      }
      out[i] = y;
      this.pos += adv;
      if (this.pos >= n) this.pos -= n;
      this.t++;
    }
    return this.live;
  }
}
registerProcessor('fg-grains', Grains);
