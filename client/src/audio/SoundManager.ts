/**
 * SoundManager – Web Audio API-based sound engine for CityZen.
 *
 * All sounds are synthesized at runtime (no external files).
 * Five audio layers:
 *   1. Background music  – ambient synth pad loop
 *   2. Traffic ambience   – filtered noise scaled by road count
 *   3. Construction       – rhythmic noise bursts, fades after inactivity
 *   4. Bulldoze SFX       – one-shot pitch-sweep noise
 *   5. Notification chime – two-tone sine ping
 *
 * Zoom-dependent mixing:
 *   - zoomFactor = 1 at max zoom-in  (frustumSize ≈ 5)
 *   - zoomFactor = 0 at max zoom-out (frustumSize ≈ 120)
 *   - Ambient layers scale with zoomFactor
 *   - BGM stays audible but grows louder when zoomed out
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a noise buffer filled with white noise. */
function createNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * seconds;
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    return buffer;
}

// ---------------------------------------------------------------------------
// SoundManager
// ---------------------------------------------------------------------------

export class SoundManager {
    private ctx: AudioContext | null = null;
    private masterGain!: GainNode;
    private musicGain!: GainNode;
    private sfxGain!: GainNode;

    // User-configurable volumes (0-1)
    private _masterVolume = 0.5;
    private _musicVolume = 0.7;
    private _sfxVolume = 0.8;
    private _enabled = true;

    // Zoom state
    private zoomFactor = 0.5; // 0 = far, 1 = close

    // BGM nodes
    private bgmOscillators: OscillatorNode[] = [];
    private bgmGainNode: GainNode | null = null;
    private bgmStarted = false;

    // Traffic ambience
    private trafficSource: AudioBufferSourceNode | null = null;
    private trafficFilter: BiquadFilterNode | null = null;
    private trafficGainNode: GainNode | null = null;
    private trafficLevel = 0; // 0-1 based on road count

    // Construction ambience
    private constructionGainNode: GainNode | null = null;
    private constructionSource: AudioBufferSourceNode | null = null;
    private constructionActive = false;
    private constructionFadeTimer: ReturnType<typeof setTimeout> | null = null;

    // Noise buffer (reused)
    private noiseBuffer: AudioBuffer | null = null;

    // ---------------------------------------------------------------------------
    // Initialization
    // ---------------------------------------------------------------------------

    /** Lazily creates the AudioContext (must be called after a user gesture). */
    resume(): void {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
            return;
        }

        this.ctx = new AudioContext();

        // Master gain
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this._enabled ? this._masterVolume : 0;
        this.masterGain.connect(this.ctx.destination);

        // Music sub-mix
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = this._musicVolume;
        this.musicGain.connect(this.masterGain);

        // SFX sub-mix
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this._sfxVolume;
        this.sfxGain.connect(this.masterGain);

        // Pre-generate noise buffer
        this.noiseBuffer = createNoiseBuffer(this.ctx, 2);

        // Start persistent layers
        this.startBGM();
        this.startTrafficAmbience();
        this.startConstructionAmbience();
    }

    // ---------------------------------------------------------------------------
    // Background Music (ambient synth pad)
    // ---------------------------------------------------------------------------

    private startBGM(): void {
        if (!this.ctx || this.bgmStarted) return;
        this.bgmStarted = true;

        this.bgmGainNode = this.ctx.createGain();
        this.bgmGainNode.gain.value = 0.25;
        this.bgmGainNode.connect(this.musicGain);

        // Create a gentle evolving pad with several detuned oscillators
        const chordFreqs = [130.81, 164.81, 196.0, 261.63]; // C3, E3, G3, C4
        for (const freq of chordFreqs) {
            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = freq;

            // Slight detune for warmth
            osc.detune.value = (Math.random() - 0.5) * 10;

            const oscGain = this.ctx.createGain();
            oscGain.gain.value = 0.06;

            // Slow LFO for volume modulation (breathing effect)
            const lfo = this.ctx.createOscillator();
            lfo.type = 'sine';
            lfo.frequency.value = 0.1 + Math.random() * 0.15;
            const lfoGain = this.ctx.createGain();
            lfoGain.gain.value = 0.02;
            lfo.connect(lfoGain);
            lfoGain.connect(oscGain.gain);
            lfo.start();

            osc.connect(oscGain);
            oscGain.connect(this.bgmGainNode);
            osc.start();

            this.bgmOscillators.push(osc);
        }

        // Add a low sub bass drone
        const subOsc = this.ctx.createOscillator();
        subOsc.type = 'triangle';
        subOsc.frequency.value = 65.41; // C2
        const subGain = this.ctx.createGain();
        subGain.gain.value = 0.04;
        subOsc.connect(subGain);
        subGain.connect(this.bgmGainNode);
        subOsc.start();
        this.bgmOscillators.push(subOsc);
    }

    // ---------------------------------------------------------------------------
    // Traffic Ambience (filtered noise loop)
    // ---------------------------------------------------------------------------

    private startTrafficAmbience(): void {
        if (!this.ctx || !this.noiseBuffer) return;

        this.trafficGainNode = this.ctx.createGain();
        this.trafficGainNode.gain.value = 0;
        this.trafficGainNode.connect(this.sfxGain);

        this.trafficFilter = this.ctx.createBiquadFilter();
        this.trafficFilter.type = 'lowpass';
        this.trafficFilter.frequency.value = 800;
        this.trafficFilter.Q.value = 0.5;
        this.trafficFilter.connect(this.trafficGainNode);

        this.trafficSource = this.ctx.createBufferSource();
        this.trafficSource.buffer = this.noiseBuffer;
        this.trafficSource.loop = true;
        this.trafficSource.connect(this.trafficFilter);
        this.trafficSource.start();
    }

    // ---------------------------------------------------------------------------
    // Construction Ambience (rhythmic noise bursts)
    // ---------------------------------------------------------------------------

    private startConstructionAmbience(): void {
        if (!this.ctx || !this.noiseBuffer) return;

        this.constructionGainNode = this.ctx.createGain();
        this.constructionGainNode.gain.value = 0;
        this.constructionGainNode.connect(this.sfxGain);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1200;
        filter.Q.value = 2;
        filter.connect(this.constructionGainNode);

        this.constructionSource = this.ctx.createBufferSource();
        this.constructionSource.buffer = this.noiseBuffer;
        this.constructionSource.loop = true;
        this.constructionSource.connect(filter);
        this.constructionSource.start();

        // Rhythmic pulsing via a script — use a periodic gain modulation
        this.pulseConstruction();
    }

    private pulseConstruction(): void {
        if (!this.ctx || !this.constructionGainNode) return;

        // Pulse the gain to simulate hammer hits
        const now = this.ctx.currentTime;
        const g = this.constructionGainNode.gain;
        const baseVol = this.constructionActive ? 0.15 * this.zoomFactor : 0;

        // Schedule 4 "hits" over the next 2 seconds
        for (let i = 0; i < 4; i++) {
            const t = now + i * 0.5;
            g.setValueAtTime(0, t);
            g.linearRampToValueAtTime(baseVol, t + 0.05);
            g.exponentialRampToValueAtTime(Math.max(0.001, baseVol * 0.1), t + 0.25);
        }

        // Schedule the next pulse cycle
        setTimeout(() => this.pulseConstruction(), 2000);
    }

    // ---------------------------------------------------------------------------
    // One-shot SFX
    // ---------------------------------------------------------------------------

    /** Play a bulldoze / demolition sound effect. */
    triggerBulldoze(): void {
        if (!this.ctx || !this._enabled) return;

        const duration = 0.4;
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(400, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(60, this.ctx.currentTime + duration);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

        // Add some noise for the crunch
        const noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = this.noiseBuffer;
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.2, this.ctx.currentTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = 600;
        noiseFilter.Q.value = 1;

        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.sfxGain);
        noiseSource.start();
        noiseSource.stop(this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.sfxGain);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    /** Play a notification chime (two-tone ping). */
    triggerNotification(): void {
        if (!this.ctx || !this._enabled) return;

        const now = this.ctx.currentTime;

        // First tone
        const osc1 = this.ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.value = 880; // A5
        const g1 = this.ctx.createGain();
        g1.gain.setValueAtTime(0.25, now);
        g1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc1.connect(g1);
        g1.connect(this.sfxGain);
        osc1.start(now);
        osc1.stop(now + 0.15);

        // Second tone (higher, slightly delayed)
        const osc2 = this.ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = 1318.5; // E6
        const g2 = this.ctx.createGain();
        g2.gain.setValueAtTime(0, now);
        g2.gain.setValueAtTime(0.2, now + 0.1);
        g2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc2.connect(g2);
        g2.connect(this.sfxGain);
        osc2.start(now + 0.1);
        osc2.stop(now + 0.35);
    }

    /** Play a construction placement sound (quick tap). */
    triggerConstruction(): void {
        if (!this.ctx || !this._enabled) return;

        // One-shot placement "tap"
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.15);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        osc.connect(gain);
        gain.connect(this.sfxGain);
        osc.start(now);
        osc.stop(now + 0.15);

        // Also activate the ambient construction loop
        this.activateConstructionAmbience();
    }

    private activateConstructionAmbience(): void {
        this.constructionActive = true;

        // Clear any existing fade timer
        if (this.constructionFadeTimer) {
            clearTimeout(this.constructionFadeTimer);
        }

        // Fade out construction after 5 seconds of no new events
        this.constructionFadeTimer = setTimeout(() => {
            this.constructionActive = false;
        }, 5000);
    }

    // ---------------------------------------------------------------------------
    // Zoom & Traffic Updates (called each frame or on change)
    // ---------------------------------------------------------------------------

    /** Update the zoom factor. Called each frame from game loop. */
    updateZoom(frustumSize: number): void {
        // frustumSize ranges from 5 (close) to 120 (far)
        this.zoomFactor = Math.max(0, Math.min(1, 1 - (frustumSize - 5) / 115));
        this.applyZoomMix();
    }

    /** Update traffic intensity based on road count. */
    updateTrafficLevel(roadCount: number): void {
        // Scale: 0 roads = 0, 50+ roads = 1.0
        this.trafficLevel = Math.min(1, roadCount / 50);
        this.applyZoomMix();
    }

    private applyZoomMix(): void {
        if (!this.ctx) return;

        const t = this.ctx.currentTime + 0.1; // smooth ramp

        // BGM: always audible, louder when zoomed out
        if (this.bgmGainNode) {
            const bgmVol = 0.15 + 0.15 * (1 - this.zoomFactor);
            this.bgmGainNode.gain.linearRampToValueAtTime(bgmVol, t);
        }

        // Traffic: scales with road count and zoom proximity
        if (this.trafficGainNode) {
            const trafficVol = 0.12 * this.trafficLevel * this.zoomFactor;
            this.trafficGainNode.gain.linearRampToValueAtTime(trafficVol, t);
        }

        // Construction ambient volume is handled inside pulseConstruction
    }

    // ---------------------------------------------------------------------------
    // Volume Controls
    // ---------------------------------------------------------------------------

    setEnabled(enabled: boolean): void {
        this._enabled = enabled;
        if (this.masterGain) {
            this.masterGain.gain.linearRampToValueAtTime(
                enabled ? this._masterVolume : 0,
                (this.ctx?.currentTime ?? 0) + 0.1,
            );
        }
    }

    setMasterVolume(v: number): void {
        this._masterVolume = v;
        if (this.masterGain && this._enabled) {
            this.masterGain.gain.linearRampToValueAtTime(v, (this.ctx?.currentTime ?? 0) + 0.1);
        }
    }

    setMusicVolume(v: number): void {
        this._musicVolume = v;
        if (this.musicGain) {
            this.musicGain.gain.linearRampToValueAtTime(v, (this.ctx?.currentTime ?? 0) + 0.1);
        }
    }

    setSfxVolume(v: number): void {
        this._sfxVolume = v;
        if (this.sfxGain) {
            this.sfxGain.gain.linearRampToValueAtTime(v, (this.ctx?.currentTime ?? 0) + 0.1);
        }
    }
}
