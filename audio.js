const SOUND_PACKS = {
    'Cherry MX Speed Silver': ['mx-speed-silver-1.wav', 'mx-speed-silver-2.wav', 'mx-speed-silver-3.wav', 'mx-speed-silver-4.wav', 'mx-speed-silver-5.wav', 'mx-speed-silver-6.wav'],
    'NK Cream': ['a.wav', 'b.wav', 'c.wav', 'd.wav', 'e.wav', 'f.wav', 'g.wav', 'h.wav', 'i.wav', 'j.wav', 'k.wav', 'l.wav', 'm.wav', 'n.wav', 'o.wav', 'p.wav', 'q.wav', 'r.wav', 's.wav', 't.wav', 'u.wav', 'v.wav', 'w.wav', 'x.wav', 'y.wav', 'z.wav', 'space.wav', 'enter.wav', 'backspace.wav'],
    'Razer Green Blackwidow Elite': ['key1.wav', 'key2.wav', 'key3.wav', 'key4.wav', 'key5.wav', 'key6.wav', 'space1.wav', 'space2.wav', 'ent.wav', 'back.wav'],
    'Steelseries Apex Pro V2': ['key1.wav', 'key3.wav', 'key4.wav', 'space.wav', 'enter.wav'],
    'Tealios V2 on PBT': ['key1.wav', 'key2.wav', 'key3.wav', 'key4.wav', 'key5.wav', 'key6.wav', 'space.wav', 'ent.wav', 'back.wav']
};

let audioBuffers = {};
let currentPackLoaded = null;

// Use Web Audio API for all sounds to guarantee zero latency
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

window.loadSoundPack = async function loadSoundPack(packName) {
    if (currentPackLoaded === packName) return;
    const files = SOUND_PACKS[packName];
    if (!files) return;

    audioBuffers = {};
    currentPackLoaded = packName;

    const loadPromises = files.map(async file => {
        try {
            // Use encodeURI so paths with spaces load correctly on all browsers
            const src = encodeURI(`Sound Packs/${packName}/${file}`);
            const response = await fetch(src);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            
            // Simple key mapping based on filename
            let key = file.replace('.wav', '').toLowerCase();
            if (key.includes('space')) key = 'space';
            else if (key.includes('ent')) key = 'enter';
            else if (key.includes('back')) key = 'backspace';
            else if (key.match(/^[a-z]$/)) key = key;
            else key = 'generic'; // fallback generic key

            if (!audioBuffers[key]) audioBuffers[key] = [];
            audioBuffers[key].push(audioBuffer);
        } catch (e) {
            console.error('Error loading audio file', file, e);
        }
    });

    await Promise.all(loadPromises);
};

window.playErrorSound = function (keyName) {
    const settings = window.usertypo_settings?.soundscape || {};
    if (settings.muted) return;

    const mode = settings.errorSounds || 'beep';
    
    if (mode === 'mute') return;
    
    if (mode === 'off') {
        // 'off' means don't play an error sound, just play the normal keystroke sound
        if (window.playKeystrokeSound) window.playKeystrokeSound(keyName);
        return;
    }
    
    // mode === 'beep' (or anything else) plays the synthetic error beep
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const volume = (settings.masterVolume || 50) / 100;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(volume * 0.7, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
};

window.playKeystrokeSound = function (keyName) {
    const settings = window.usertypo_settings?.soundscape || {};
    if (settings.muted || !settings.clickSounds) return;

    if (currentPackLoaded !== settings.soundPack) {
        loadSoundPack(settings.soundPack);
    }

    let mappedKey = 'generic';
    keyName = (keyName || '').toLowerCase();
    
    if (keyName === ' ') mappedKey = 'space';
    else if (keyName === 'enter') mappedKey = 'enter';
    else if (keyName === 'backspace') mappedKey = 'backspace';
    else if (keyName.match(/^[a-z]$/) && audioBuffers[keyName]) mappedKey = keyName;

    let buffers = audioBuffers[mappedKey];
    if (!buffers || buffers.length === 0) buffers = audioBuffers['generic'];
    if (!buffers || buffers.length === 0) return;

    const audioBuffer = buffers[Math.floor(Math.random() * buffers.length)];
    
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = (settings.masterVolume || 50) / 100;
    
    source.playbackRate.value = 0.95 + Math.random() * 0.1; // slight pitch variation
    
    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    source.start(0);
};

// Pre-load sound pack on page load so first keypress is never silent
document.addEventListener('DOMContentLoaded', () => {
    const settings = window.usertypo_settings?.soundscape || {};
    if (settings.clickSounds && !settings.muted && settings.soundPack) {
        loadSoundPack(settings.soundPack);
    }
});
