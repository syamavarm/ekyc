/**
 * Audio Service for Liveness Check
 * 
 * Provides voice instructions using Web Speech API and beep sounds using Web Audio API.
 * Handles browser autoplay policies by requiring user interaction before audio playback.
 */

type BeepType = 'prepare' | 'action';

// Audio context singleton - created on first user interaction
let audioContext: AudioContext | null = null;
let isAudioEnabled = true;
let isInitialized = false;

// Speech synthesis
let speechSynthesis: SpeechSynthesis | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;

// Track if we're currently playing audio to prevent overlap
let isPlayingVoice = false;
let isPlayingBeep = false;

// Preferred voice name (can be set by user)
let preferredVoiceName: string | null = null;

/**
 * Initialize audio context - must be called from user interaction (click, etc.)
 * This unlocks audio playback on browsers with autoplay restrictions.
 */
export const initializeAudio = async (): Promise<boolean> => {
  if (isInitialized) return isAudioEnabled;
  
  try {
    // Initialize Web Audio API
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Resume context if suspended (required by some browsers)
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    
    // Play a silent sound to unlock audio
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0; // Silent
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.001);
    
    // Initialize Speech Synthesis
    if ('speechSynthesis' in window) {
      speechSynthesis = window.speechSynthesis;
      
      // Some browsers need voices to be loaded
      if (speechSynthesis.getVoices().length === 0) {
        await new Promise<void>((resolve) => {
          speechSynthesis!.onvoiceschanged = () => resolve();
          // Timeout fallback
          setTimeout(resolve, 1000);
        });
      }
    }
    
    isInitialized = true;
    isAudioEnabled = true;
    console.log('[AudioService] Audio initialized successfully');
    return true;
    
  } catch (error) {
    console.warn('[AudioService] Failed to initialize audio, falling back to text-only mode:', error);
    isAudioEnabled = false;
    isInitialized = true;
    return false;
  }
};

/**
 * Check if audio is enabled and ready
 */
export const isAudioReady = (): boolean => {
  return isInitialized && isAudioEnabled;
};

/**
 * Generate a beep sound using Web Audio API
 * @param type - 'prepare' for soft beep, 'action' for sharp beep
 */
export const playBeep = async (type: BeepType): Promise<void> => {
  if (!isAudioEnabled || !audioContext || isPlayingBeep) {
    return;
  }
  
  try {
    isPlayingBeep = true;
    
    // Resume context if needed
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    if (type === 'prepare') {
      // Soft beep: lower frequency, gentle envelope
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(660, audioContext.currentTime); // E5 note
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
    } else if (type === 'action') {
      // Sharp beep: higher frequency, quick attack
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // A5 note
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.4, audioContext.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.15);
      
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    isPlayingBeep = false;
    
  } catch (error) {
    console.warn('[AudioService] Failed to play beep:', error);
    isPlayingBeep = false;
  }
};

/**
 * Play voice instruction using Web Speech API
 * @param text - Text to speak
 * @param waitForCompletion - If true, returns promise that resolves when speech ends
 */
export const playVoice = async (text: string, waitForCompletion: boolean = false): Promise<void> => {
  if (!isAudioEnabled || !speechSynthesis) {
    return;
  }
  
  try {
    // Cancel any ongoing speech
    if (currentUtterance) {
      speechSynthesis.cancel();
    }
    
    isPlayingVoice = true;
    
    const utterance = new SpeechSynthesisUtterance(text);
    currentUtterance = utterance;
    
    // Configure voice settings for clarity
    utterance.rate = 0.95;  // Slightly slower for clarity
    utterance.pitch = 1.0;  // Normal pitch
    utterance.volume = 1.0; // Full volume
    
    // Try to get a natural female English voice
    const voices = speechSynthesis.getVoices();
    
    // Common female voice names across different browsers/OS
    const femaleVoiceNames = [
      'samantha', 'victoria', 'karen', 'moira', 'tessa', 'fiona', // macOS
      'zira', 'hazel', 'susan', 'linda', 'catherine', // Windows
      'google us english female', 'google uk english female', // Chrome
      'female', 'woman'
    ];
    
    // Priority 1: Natural/premium female English voice (local service = more natural)
    let selectedVoice = voices.find(voice => {
      const nameLower = voice.name.toLowerCase();
      return voice.lang.startsWith('en') && 
             voice.localService && 
             femaleVoiceNames.some(fn => nameLower.includes(fn));
    });
    
    // Priority 2: Any female English voice
    if (!selectedVoice) {
      selectedVoice = voices.find(voice => {
        const nameLower = voice.name.toLowerCase();
        return voice.lang.startsWith('en') && 
               femaleVoiceNames.some(fn => nameLower.includes(fn));
      });
    }
    
    // Priority 3: Voices with "enhanced" or "premium" quality (often female by default)
    if (!selectedVoice) {
      selectedVoice = voices.find(voice => 
        voice.lang.startsWith('en') && 
        (voice.name.toLowerCase().includes('enhanced') || 
         voice.name.toLowerCase().includes('premium') ||
         voice.name.toLowerCase().includes('natural'))
      );
    }
    
    // Priority 4: Any local English voice (usually better quality)
    if (!selectedVoice) {
      selectedVoice = voices.find(voice => 
        voice.lang.startsWith('en') && voice.localService
      );
    }
    
    // Priority 5: Any English voice
    if (!selectedVoice) {
      selectedVoice = voices.find(voice => voice.lang.startsWith('en'));
    }
    
    // Check if user has set a preferred voice
    if (preferredVoiceName) {
      const preferredVoice = voices.find(v => 
        v.name.toLowerCase().includes(preferredVoiceName!.toLowerCase())
      );
      if (preferredVoice) {
        selectedVoice = preferredVoice;
      }
    }
    
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      console.log('[AudioService] Using voice:', selectedVoice.name);
    }
    
    if (waitForCompletion) {
      return new Promise((resolve, reject) => {
        utterance.onend = () => {
          isPlayingVoice = false;
          currentUtterance = null;
          resolve();
        };
        utterance.onerror = (event) => {
          console.warn('[AudioService] Speech error:', event.error);
          isPlayingVoice = false;
          currentUtterance = null;
          resolve(); // Resolve anyway to not block the flow
        };
        speechSynthesis!.speak(utterance);
      });
    } else {
      utterance.onend = () => {
        isPlayingVoice = false;
        currentUtterance = null;
      };
      utterance.onerror = () => {
        isPlayingVoice = false;
        currentUtterance = null;
      };
      speechSynthesis.speak(utterance);
    }
    
  } catch (error) {
    console.warn('[AudioService] Failed to play voice:', error);
    isPlayingVoice = false;
    currentUtterance = null;
  }
};

/**
 * Play beep followed by voice instruction (with proper sequencing)
 * @param text - Text to speak
 * @param beepType - Type of beep to play before voice
 */
export const playBeepThenVoice = async (text: string, beepType: BeepType): Promise<void> => {
  if (!isAudioEnabled) return;
  
  // Play beep first
  await playBeep(beepType);
  
  // Small gap between beep and voice
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Play voice (don't wait for completion - let it play in background)
  playVoice(text, false);
};

/**
 * Stop all currently playing audio
 */
export const stopAllAudio = (): void => {
  try {
    // Stop speech
    if (speechSynthesis) {
      speechSynthesis.cancel();
    }
    currentUtterance = null;
    isPlayingVoice = false;
    isPlayingBeep = false;
  } catch (error) {
    console.warn('[AudioService] Error stopping audio:', error);
  }
};

/**
 * Disable audio (for graceful degradation)
 */
export const disableAudio = (): void => {
  isAudioEnabled = false;
  stopAllAudio();
};

/**
 * Enable audio
 */
export const enableAudio = (): void => {
  if (isInitialized) {
    isAudioEnabled = true;
  }
};

/**
 * Check if currently playing audio
 */
export const isPlaying = (): boolean => {
  return isPlayingVoice || isPlayingBeep;
};

/**
 * Get list of available voices (for debugging/configuration)
 */
export const getAvailableVoices = (): { name: string; lang: string; local: boolean }[] => {
  if (!speechSynthesis) {
    if ('speechSynthesis' in window) {
      speechSynthesis = window.speechSynthesis;
    } else {
      return [];
    }
  }
  
  return speechSynthesis.getVoices().map(voice => ({
    name: voice.name,
    lang: voice.lang,
    local: voice.localService
  }));
};

/**
 * Get list of female English voices
 */
export const getFemaleVoices = (): { name: string; lang: string; local: boolean }[] => {
  const femaleVoiceNames = [
    'samantha', 'victoria', 'karen', 'moira', 'tessa', 'fiona',
    'zira', 'hazel', 'susan', 'linda', 'catherine',
    'google us english female', 'google uk english female',
    'female', 'woman'
  ];
  
  return getAvailableVoices().filter(voice => {
    const nameLower = voice.name.toLowerCase();
    return voice.lang.startsWith('en') && 
           femaleVoiceNames.some(fn => nameLower.includes(fn));
  });
};

/**
 * Set preferred voice by name
 */
export const setPreferredVoice = (voiceName: string | null): void => {
  preferredVoiceName = voiceName;
  console.log('[AudioService] Preferred voice set to:', voiceName);
};

/**
 * Log all available voices to console (for debugging)
 */
export const logAvailableVoices = (): void => {
  const voices = getAvailableVoices();
  console.log('[AudioService] Available voices:');
  voices.forEach((v, i) => {
    console.log(`  ${i + 1}. ${v.name} (${v.lang}) ${v.local ? '[Local]' : ''}`);
  });
  
  const femaleVoices = getFemaleVoices();
  if (femaleVoices.length > 0) {
    console.log('[AudioService] Female English voices:');
    femaleVoices.forEach((v, i) => {
      console.log(`  ${i + 1}. ${v.name} (${v.lang}) ${v.local ? '[Local]' : ''}`);
    });
  }
};

// Export types
export type { BeepType };

