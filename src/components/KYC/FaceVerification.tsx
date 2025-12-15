import React, { useState, useRef, useEffect, useCallback } from 'react';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';
import kycApiService, { SecureVerificationResponse } from '../../services/kycApiService';
import {
  initializeAudio,
  playBeep,
  stopAllAudio,
  logAvailableVoices
} from '../../services/audioService';
import { uiEventLoggerService } from '../../services/uiEventLoggerService';

// Visual feedback state - simplified to single mode to prevent flickers
export type VisualMode = 'idle' | 'countdown' | 'action' | 'recording';

export interface VisualFeedbackState {
  mode: VisualMode;
  countdownNumber: number | null;
}

interface FaceVerificationProps {
  sessionId: string;
  documentId: string;
  onVerified: () => void;
  onComplete: () => void;
  loading: boolean;
  onStepInstruction?: (instruction: string, playAudio?: boolean, waitForAudio?: boolean) => Promise<void>;
  // Callback to send visual feedback state to parent for rendering on main video
  onVisualFeedbackChange?: (state: VisualFeedbackState) => void;
  // Reference to main video element for frame capture (parent owns the only <video>)
  mainVideoRef: React.RefObject<HTMLVideoElement>;
  // Callback for escalation to human/manual review
  onEscalate?: (reason: string) => void;
}

type VerificationStatus = 
  | 'idle'           // Initial state - show instructions
  | 'get_ready'      // Countdown before starting
  | 'capturing_face' // Capturing initial face image
  | 'liveness'       // Performing liveness actions
  | 'verifying'      // Sending to backend for verification
  | 'otp_display'    // Displaying OTP for voice verification
  | 'otp_listening'  // Listening for spoken OTP
  | 'otp_verifying'  // Verifying spoken OTP
  | 'success'        // All checks passed
  | 'failed'         // One or more checks failed
  | 'escalated';     // Escalated to human/manual review

/**
 * Face & Liveness Verification Component
 * 
 * Performs combined face matching + liveness check with anti-spoofing:
 * 1. Captures initial face image (used for document matching AND consistency check)
 * 2. Performs liveness actions while capturing frames
 * 3. Verifies face consistency between initial capture and liveness frames
 * 
 * This prevents the attack where user shows document during face capture
 * but uses their actual face during liveness.
 */
const FaceVerification: React.FC<FaceVerificationProps> = ({
  sessionId,
  documentId,
  onVerified,
  onComplete,
  loading,
  onStepInstruction,
  onVisualFeedbackChange,
  mainVideoRef,
  onEscalate,
}) => {
  
  // State
  const [status, setStatus] = useState<VerificationStatus>('idle');
  const [error, setError] = useState<string>('');
  const [currentInstruction, setCurrentInstruction] = useState<string>('');
  const [result, setResult] = useState<SecureVerificationResponse | null>(null);
  
  // Intro audio state
  const [introAudioPlayed, setIntroAudioPlayed] = useState(false);
  const introAudioStartedRef = useRef(false);
  
  // Visual feedback state - single source of truth to prevent flickers
  const [visualMode, setVisualMode] = useState<VisualMode>('idle');
  const [countdownNumber, setCountdownNumber] = useState<number | null>(null);
  
  // Speech recognition hook for OTP
  const {
    transcript,
    listening,
    resetTranscript,
    browserSupportsSpeechRecognition,
  } = useSpeechRecognition();
  
  // OTP verification state
  const [generatedOTP, setGeneratedOTP] = useState<string>('');
  const [spokenOTP, setSpokenOTP] = useState<string>('');
  const [otpAttempts, setOtpAttempts] = useState(0);
  const [otpError, setOtpError] = useState<string>('');
  const otpListeningStartedRef = useRef(false);
  const otpProcessedRef = useRef(false);
  const statusRef = useRef<VerificationStatus>('idle');
  const transcriptRef = useRef<string>('');
  const otpDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const otpListeningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Track if backend verification (face + liveness + consistency) passed
  const [backendVerificationPassed, setBackendVerificationPassed] = useState(false);
  
  // Keep refs in sync with state
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);
  
  // Notify parent of visual feedback changes - batched updates
  useEffect(() => {
    if (onVisualFeedbackChange) {
      onVisualFeedbackChange({ mode: visualMode, countdownNumber });
    }
  }, [visualMode, countdownNumber, onVisualFeedbackChange]);

  // Play intro instruction when component mounts
  useEffect(() => {
    const playIntroInstruction = async () => {
      if (introAudioStartedRef.current) return;
      introAudioStartedRef.current = true;
      
      // Small delay to ensure component is mounted
      await new Promise(resolve => setTimeout(resolve, 300));
      
      if (onStepInstruction) {
        await onStepInstruction('Please be prepared to follow instructions to verify your presence.');
      }
      
      setIntroAudioPlayed(true);
    };
    
    playIntroInstruction();
  }, [onStepInstruction]);

  // Cleanup audio and speech recognition on unmount
  useEffect(() => {
    return () => {
      stopAllAudio();
      if (listening) {
        SpeechRecognition.stopListening();
      }
      // Clear OTP timers
      if (otpDebounceTimerRef.current) {
        clearTimeout(otpDebounceTimerRef.current);
      }
      if (otpListeningTimeoutRef.current) {
        clearTimeout(otpListeningTimeoutRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Generate a random 6-digit OTP
   */
  const generateOTP = (): string => {
    // Generate 6 random digits
    const digits = [];
    for (let i = 0; i < 6; i++) {
      digits.push(Math.floor(Math.random() * 10));
    }
    return digits.join('');
  };

  /**
   * Parse spoken digits from transcript
   * Handles both spoken digits ("one two three") and numeric ("123")
   */
  const parseSpokenDigits = (text: string): string => {
    const lower = text.toLowerCase().trim();
    
    // Word to digit mapping - comprehensive list
    const wordToDigit: Record<string, string> = {
      // Zero variants
      'zero': '0', 'oh': '0', 'o': '0', 'zeros': '0', 'hero': '0',
      // One variants
      'one': '1', 'won': '1', 'want': '1', 'wand': '1', 'once': '1',
      // Two variants
      'two': '2', 'to': '2', 'too': '2', 'tu': '2', 'tooth': '2',
      // Three variants
      'three': '3', 'tree': '3', 'free': '3', 'sri': '3',
      // Four variants
      'four': '4', 'for': '4', 'fore': '4', 'ford': '4', 'fort': '4',
      // Five variants
      'five': '5', 'fife': '5', 'hive': '5', 'fi': '5',
      // Six variants
      'six': '6', 'sex': '6', 'sax': '6', 'sick': '6', 'seeks': '6', 'sicks': '6',
      // Seven variants
      'seven': '7', 'sven': '7', 'heaven': '7',
      // Eight variants
      'eight': '8', 'ate': '8', 'ait': '8', 'hate': '8', 'late': '8',
      // Nine variants
      'nine': '9', 'nein': '9', 'mine': '9', 'line': '9', 'fine': '9', 'dine': '9',
    };
    
    // Split into words and convert
    const words = lower.split(/[\s,.\-;:!?]+/);
    let result = '';
    
    console.log(`[OTP Parse] Input: "${text}" -> Words: [${words.join(', ')}]`);
    
    for (const word of words) {
      const cleanWord = word.trim();
      if (!cleanWord) continue;
      
      // Check if it's a word number
      if (wordToDigit[cleanWord]) {
        result += wordToDigit[cleanWord];
        console.log(`[OTP Parse] Word "${cleanWord}" -> "${wordToDigit[cleanWord]}"`);
      } else {
        // Extract any digits from the word
        const digits = cleanWord.match(/\d/g);
        if (digits) {
          result += digits.join('');
          console.log(`[OTP Parse] Extracted digits from "${cleanWord}" -> "${digits.join('')}"`);
        } else {
          // Try partial matching for common misrecognitions
          for (const [pattern, digit] of Object.entries(wordToDigit)) {
            if (cleanWord.includes(pattern) || pattern.includes(cleanWord)) {
              result += digit;
              console.log(`[OTP Parse] Partial match "${cleanWord}" ~ "${pattern}" -> "${digit}"`);
              break;
            }
          }
        }
      }
    }
    
    console.log(`[OTP Parse] Result: "${result}"`);
    return result;
  };

  /**
   * Validate spoken OTP against generated OTP
   */
  const validateOTP = useCallback((spoken: string, generated: string): boolean => {
    const parsedSpoken = parseSpokenDigits(spoken);
    console.log(`[OTP Validation] Spoken: "${spoken}" -> Parsed: "${parsedSpoken}" vs Generated: "${generated}"`);
    return parsedSpoken === generated;
  }, []);

  /**
   * Process transcript for OTP validation
   * Uses debouncing to wait for transcript to stabilize before validating
   */
  useEffect(() => {
    // Only process if:
    // 1. Status is otp_listening
    // 2. We have a transcript
    // 3. Not already processed
    // 4. Listening has actually started (safety check for retry)
    if (status !== 'otp_listening' || !transcript || otpProcessedRef.current || !otpListeningStartedRef.current) {
      return;
    }
    
    const parsed = parseSpokenDigits(transcript);
    setSpokenOTP(parsed);
    
    // Clear any existing debounce timer
    if (otpDebounceTimerRef.current) {
      clearTimeout(otpDebounceTimerRef.current);
    }
    
    // Check if we have enough digits (6)
    if (parsed.length >= 6) {
      // Wait 1.5 seconds for transcript to stabilize before validating
      // This gives time for the last digit to be fully recognized
      otpDebounceTimerRef.current = setTimeout(() => {
        if (otpProcessedRef.current) return; // Already processed
        
        // Re-parse the latest transcript from ref (might have updated)
        const finalParsed = parseSpokenDigits(transcriptRef.current);
        console.log(`[OTP] Debounce complete. Final parsed: "${finalParsed}" from transcript: "${transcriptRef.current}"`);
        
        if (finalParsed.length >= 6) {
          otpProcessedRef.current = true;
          SpeechRecognition.stopListening();
          
          // Use first 6 digits for validation
          handleOTPValidation(finalParsed.substring(0, 6));
        }
      }, 1500);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript, status]);

  /**
   * Handle OTP validation result
   */
  const handleOTPValidation = async (spokenDigits: string) => {
    setStatus('otp_verifying');
    
    const isValid = validateOTP(spokenDigits, generatedOTP);
    
    uiEventLoggerService.logEvent('otp_voice_verification', {
      attempt: otpAttempts + 1,
      success: isValid,
      spokenDigits: spokenDigits.substring(0, 6), // Only log first 6 for privacy
    });
    
    if (isValid && backendVerificationPassed) {
      // ALL checks passed: face match + liveness + consistency + OTP voice verification
      setOtpError('');
      if (onStepInstruction) {
        await onStepInstruction('Thanks for your patience!', true, true);
      }
      
      // Update backend with OTP verification success
      try {
        await kycApiService.updateOTPVerification(
          sessionId,
          true,  // verified
          otpAttempts + 1,  // attempts
          false  // not escalated
        );
      } catch (err) {
        console.error('[FaceVerification] Failed to update OTP verification status:', err);
      }
      
      // Mark as success and proceed - only when ALL conditions are met
      setStatus('success');
      onVerified();
      
      uiEventLoggerService.logEvent('face_verification_success', {
        faceMatchScore: result?.faceMatch.matchScore,
        livenessScore: result?.liveness.confidenceScore,
        faceConsistencyPassed: result?.faceConsistency.isConsistent,
        otpVerified: true,
        allChecksPassed: true,
      });
      
      setTimeout(() => onComplete(), 1500);
    } else if (isValid && !backendVerificationPassed) {
      // OTP valid but backend verification didn't pass (shouldn't normally happen)
      // This is a safety check - escalate to manual review
      console.error('[FaceVerification] OTP valid but backend verification not passed - escalating');
      await handleEscalation('Verification state inconsistency detected');
    } else {
      // OTP failed
      const newAttempts = otpAttempts + 1;
      setOtpAttempts(newAttempts);
      
      // Log OTP failure to backend timeline
      try {
        await kycApiService.updateOTPVerification(
          sessionId,
          false,  // not verified
          newAttempts,  // attempts
          false,  // not escalated yet
          `OTP mismatch - attempt ${newAttempts}`  // reason for logging
        );
      } catch (err) {
        console.error('[FaceVerification] Failed to log OTP failure:', err);
      }
      
      if (newAttempts >= 2) {
        // Max retries exceeded - escalate to manual review
        handleEscalation('Voice OTP verification failed after maximum attempts');
      } else {
        // Allow one retry with new OTP
        setOtpError('The digits did not match. Please try again with a new code.');
        if (onStepInstruction) {
          await onStepInstruction('The digits did not match. Let me generate a new code for you.', true, true);
        }
        
        // Generate new OTP and restart
        await startOTPVerification();
      }
    }
  };

  /**
   * Handle escalation to human/manual review
   */
  const handleEscalation = async (reason: string) => {
    setStatus('escalated');
    setError('Presence verification could not be completed. Your session has been escalated for manual review.');
    
    uiEventLoggerService.logEvent('verification_escalated', {
      reason,
      otpAttempts,
    });
    
    // Update backend with escalation status
    try {
      await kycApiService.updateOTPVerification(
        sessionId,
        false,  // not verified
        otpAttempts,
        true,   // escalated
        reason  // escalation reason
      );
    } catch (err) {
      console.error('[FaceVerification] Failed to update escalation status:', err);
    }
    
    if (onStepInstruction) {
      await onStepInstruction('We could not complete the presence verification. Your session will be reviewed manually.', true, true);
    }
    
    stopAllAudio();
    
    // Notify parent about escalation
    if (onEscalate) {
      onEscalate(reason);
    }
    
    // Move to completion after delay
    setTimeout(() => onComplete(), 3000);
  };

  /**
   * Start OTP voice verification process
   */
  const startOTPVerification = async () => {
    // Reset state FIRST before anything else
    otpListeningStartedRef.current = false;
    otpProcessedRef.current = false;
    
    // Clear any existing timers from previous attempts
    if (otpDebounceTimerRef.current) {
      clearTimeout(otpDebounceTimerRef.current);
      otpDebounceTimerRef.current = null;
    }
    if (otpListeningTimeoutRef.current) {
      clearTimeout(otpListeningTimeoutRef.current);
      otpListeningTimeoutRef.current = null;
    }
    
    // Stop any existing listening and reset transcript
    SpeechRecognition.stopListening();
    resetTranscript();
    
    // Clear spoken OTP state
    setSpokenOTP('');
    setOtpError('');
    
    // Small delay to ensure transcript is fully reset
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Generate new OTP
    const newOTP = generateOTP();
    setGeneratedOTP(newOTP);
    setStatus('otp_display');
    
    console.log(`[OTP] Generated new OTP: ${newOTP}`);
    
    // Format OTP for speaking (with pauses between digits)
    const otpForSpeech = newOTP.split('').join(', ');
    
    // Show and speak the OTP
    const otpMessage = `Please read aloud the following code: ${otpForSpeech}`;
    setCurrentInstruction(otpMessage);
    
    if (onStepInstruction) {
      await onStepInstruction(otpMessage, true, true);
    }
    
    // Wait a moment then start listening
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Start listening for spoken OTP
    setStatus('otp_listening');
    setCurrentInstruction('Listening... Please speak the code now.');
    
    if (browserSupportsSpeechRecognition) {
      otpListeningStartedRef.current = true;
      SpeechRecognition.startListening({ continuous: true, language: 'en-US' });
      
      // Set a timeout for listening (20 seconds - increased to allow for debounce)
      // Store in ref so we can clear it if starting a new attempt
      otpListeningTimeoutRef.current = setTimeout(() => {
        // Use refs to get current values (avoid stale closure)
        if (statusRef.current === 'otp_listening' && !otpProcessedRef.current) {
          console.log('[OTP] Timeout reached, stopping listening');
          
          // Clear debounce timer if any
          if (otpDebounceTimerRef.current) {
            clearTimeout(otpDebounceTimerRef.current);
            otpDebounceTimerRef.current = null;
          }
          
          SpeechRecognition.stopListening();
          const parsed = parseSpokenDigits(transcriptRef.current);
          console.log(`[OTP] Timeout - Final transcript: "${transcriptRef.current}" -> Parsed: "${parsed}"`);
          
          if (parsed.length > 0) {
            // Use whatever digits we have (might be less than 6)
            handleOTPValidation(parsed.substring(0, 6));
          } else {
            // No speech detected - treat as failed attempt
            handleOTPValidation('');
          }
        }
      }, 20000);
    } else {
      // Speech recognition not supported - escalate
      handleEscalation('Voice verification is not supported on this browser');
    }
  };

  /**
   * Capture a single frame from the main video element (owned by parent)
   */
  const captureFrame = async (): Promise<Blob | null> => {
    if (!mainVideoRef.current) return null;

    const canvas = document.createElement('canvas');
    canvas.width = mainVideoRef.current.videoWidth;
    canvas.height = mainVideoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(mainVideoRef.current, 0, 0);

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.95);
    });
  };

  /**
   * Helper: Show instruction with audio
   * Uses onStepInstruction to both display and play the instruction
   */
  const showInstruction = async (
    text: string, 
    type: 'prepare' | 'action' | 'info' = 'info',
    waitForVoice: boolean = false
  ): Promise<void> => {
    setCurrentInstruction(text);
    
    // Use onStepInstruction which handles both display and audio
    if (onStepInstruction) {
      await onStepInstruction(text);
      if (waitForVoice) {
        // Estimate ~100ms per word for speech
        const wordCount = text.split(' ').length;
        await new Promise(resolve => setTimeout(resolve, wordCount * 120));
      }
    }
  };

  /**
   * Visual countdown (3-2-1) as fallback/supplement to audio beep
   * Shows large numbers on screen before action starts
   */
  const showVisualCountdown = async (): Promise<void> => {
    setVisualMode('countdown');
    for (let i = 3; i >= 1; i--) {
      setCountdownNumber(i);
      await new Promise(resolve => setTimeout(resolve, 600));
    }
    setCountdownNumber(null);
  };

  /**
   * Signal "GO!" with green pulsing border, then transition to recording
   */
  const triggerActionCue = async (): Promise<void> => {
    // Green pulse for "GO!"
    setVisualMode('action');
    await new Promise(resolve => setTimeout(resolve, 400));
    // Transition to recording mode
    setVisualMode('recording');
  };

  /**
   * End the recording visual indicator
   */
  const endRecordingIndicator = (): void => {
    setVisualMode('idle');
  };

  /**
   * Start the secure verification process
   */
  const startVerification = async () => {
    setError('');
    
    // Log verification started
    uiEventLoggerService.logEvent('face_verification_started', { sessionId, documentId });
    
    // Initialize audio on user interaction (button click)
    await initializeAudio();
    
    // Log available voices for debugging (check browser console)
    logAvailableVoices();
    
    // Step 0: Get Ready phase
    setStatus('get_ready');
    await showInstruction('Please perform the actions as instructed, after the countdown and beep', 'prepare', true);
    
    // Give user additional time to position themselves
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Instruction before face capture
    await showInstruction('Look straight at the camera.', 'prepare');
    
    // Step 1: Capture initial face image with countdown
    setStatus('capturing_face');
    uiEventLoggerService.logEvent('face_capture_started', {});
    
    // Visual countdown (3-2-1) before capture
    await showVisualCountdown();
    
    // BEEP + Green pulse to signal capture
    playBeep('action').catch(() => {
      console.warn('[FaceVerification] Audio beep failed for face capture');
    });
    await triggerActionCue();
    
    const faceImage = await captureFrame();
    
    // End visual feedback
    endRecordingIndicator();
    
    if (!faceImage) {
      setError('Failed to capture face image');
      setStatus('failed');
      uiEventLoggerService.logError('face_capture_failed', 'Failed to capture face image');
      stopAllAudio();
      setTimeout(() => onComplete(), 3000);
      return;
    }
    
    uiEventLoggerService.logEvent('face_captured', { success: true });
    console.log('[SecureVerification] Captured initial face image');
    
    // Step 2: Perform liveness actions
    setStatus('liveness');
    const frames = await performLivenessActions();
    
    // Step 3: Send to backend for verification
    await verify(faceImage, frames);
  };

  /**
   * Perform liveness actions and capture frames
   * Includes visual countdown (3-2-1) and flash effect as fallback/supplement to audio
   */
  const performLivenessActions = async (): Promise<Blob[]> => {
    const instructions = [
      { text: 'Blink your eyes naturally', voiceText: 'Please blink your eyes naturally, after the beep', duration: 3000, captureCount: 6, action: 'blink' },
      { text: 'Turn head slowly to the left', voiceText: 'Turn your head slowly to the left, after the beep', duration: 2500, captureCount: 5, action: 'turn_left' },
      { text: 'Turn head slowly to the right', voiceText: 'Turn your head slowly to the right, after the beep', duration: 2500, captureCount: 5, action: 'turn_right' },
      { text: 'Please smile', voiceText: 'Please smile, after the beep', duration: 2000, captureCount: 4, action: 'smile' },
      { text: 'Look straight at the camera', voiceText: 'Look straight at the camera, after the beep', duration: 1500, captureCount: 3, action: 'look_straight' },
    ];

    const frames: Blob[] = [];
    
    // Log liveness check started
    uiEventLoggerService.logEvent('liveness_check_started', { 
      totalActions: instructions.length 
    });

    for (let i = 0; i < instructions.length; i++) {
      const instruction = instructions[i];
      
      // Log each liveness action
      uiEventLoggerService.logEvent('liveness_action', {
        action: instruction.action,
        step: i + 1,
        totalSteps: instructions.length,
        instruction: instruction.text
      });
      
      // Show instruction and speak it
      const prepareText = `${instruction.text}`;
      setCurrentInstruction(prepareText);
      
      if (onStepInstruction) {
        await onStepInstruction(prepareText);
      } else {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      
      // Visual countdown (3-2-1) - works even if audio fails
      await showVisualCountdown();
      
      // BEEP + Green pulse together at the end of countdown to signal "GO!"
      playBeep('action').catch(() => {
        console.warn('[FaceVerification] Audio beep failed, visual pulse still active');
      });
      await triggerActionCue();
      
      // Action NOW - show in instruction
      const actionText = `${instruction.text} - NOW!`;
      setCurrentInstruction(actionText);
      if (onStepInstruction) {
        await onStepInstruction(actionText, false); // Don't play audio for "NOW" - just display
      }
      
      // Small delay before starting capture
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const captureInterval = instruction.duration / instruction.captureCount;
      
      for (let j = 0; j < instruction.captureCount; j++) {
        const frame = await captureFrame();
        if (frame) {
          frames.push(frame);
        }
        
        if (j < instruction.captureCount - 1) {
          await new Promise(resolve => setTimeout(resolve, captureInterval));
        }
      }
      
      // End the recording indicator after capture completes
      endRecordingIndicator();
      
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    console.log(`[SecureVerification] Captured ${frames.length} liveness frames`);
    return frames;
  };

  /**
   * Send verification request to backend
   */
  const verify = async (faceImage: Blob, frames: Blob[]) => {
    setStatus('verifying');
    const verifyingText = 'Please wait while we verify your face and identity.';
    setCurrentInstruction(verifyingText);
    
    // Stop any playing audio and show verifying instruction
    stopAllAudio();
    if (onStepInstruction) {
      onStepInstruction(verifyingText);
    }
    
    try {
      const verificationResult = await kycApiService.runSecureVerification(
        sessionId,
        documentId,
        faceImage,
        frames
      );
      
      setResult(verificationResult);
      stopAllAudio();
      
      // Log face verification results for timeline replay
      uiEventLoggerService.logFaceCheckResult(
        verificationResult.faceMatch.isMatch,
        verificationResult.faceMatch.matchScore,
        verificationResult.faceMatch.confidence
      );
      uiEventLoggerService.logLivenessCheckResult(
        verificationResult.liveness.overallResult,
        verificationResult.liveness.confidenceScore,
        verificationResult.liveness.checks
      );
      
      if (verificationResult.overallResult) {
        // Backend verification passed (face match + liveness + consistency)
        setBackendVerificationPassed(true);
        
        uiEventLoggerService.logEvent('liveness_passed_starting_otp', {
          faceMatchScore: verificationResult.faceMatch.matchScore,
          livenessScore: verificationResult.liveness.confidenceScore
        });
        
        if (onStepInstruction) {
          await onStepInstruction('Now let us verify your presence with a voice check.', true, true);
        }
        
        // Start OTP voice verification
        await startOTPVerification();
      } else {
        // Action-based liveness failed - escalate to manual review
        uiEventLoggerService.logEvent('liveness_failed_escalating', {
          reason: verificationResult.message,
          faceMatchScore: verificationResult.faceMatch.matchScore,
          livenessScore: verificationResult.liveness.confidenceScore
        });
        
        // Escalate to human/manual review
        await handleEscalation(`Action-based liveness check failed: ${verificationResult.message}`);
      }
    } catch (err: any) {
      console.error('[SecureVerification] Verification error:', err);
      // Log verification error and escalate
      uiEventLoggerService.logError('face_verification_error', err.message || 'Verification failed');
      
      // Escalate to human/manual review
      await handleEscalation(`Verification error: ${err.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="face-verification">
      {/* Initial state - start button only */}
      {status === 'idle' && (
        <div className="face-actions-standalone">
          <button 
            className="btn-primary" 
            onClick={startVerification} 
            disabled={loading || !introAudioPlayed}
          >
            {introAudioPlayed ? 'Start Verification' : 'Please wait...'}
          </button>
        </div>
      )}

      {/* Capturing initial face - spinner */}
      {status === 'capturing_face' && (
        <div className="face-status-standalone">
          <div className="spinner"></div>
        </div>
      )}

      {/* Liveness actions - show recording indicator (visual feedback on main video handles the rest) */}
      {status === 'liveness' && visualMode === 'recording' && (
        <div className="face-status-standalone">
          <div className="recording-indicator">
            <span className="recording-dot"></span>
            Recording...
          </div>
        </div>
      )}

      {/* Verifying - spinner only */}
      {status === 'verifying' && (
        <div className="face-status-standalone">
          <div className="spinner"></div>
        </div>
      )}

      {/* OTP Display - Show OTP code to be spoken */}
      {status === 'otp_display' && (
        <div className="otp-verification-card">
          <div className="otp-header">
            <svg className="otp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
            <h3>Voice Verification</h3>
          </div>
          <p className="otp-instruction">Please read aloud the code below:</p>
          <div className="otp-display">
            {generatedOTP.split('').map((digit, index) => (
              <span key={index} className="otp-digit">{digit}</span>
            ))}
          </div>
          {otpAttempts > 0 && (
            <div className="otp-retry-notice">
              Attempt {otpAttempts + 1} of 2
            </div>
          )}
          {otpError && (
            <div className="otp-error">
              {otpError}
            </div>
          )}
          <div className="otp-preparing">
            <div className="spinner small"></div>
            <span>Preparing to listen...</span>
          </div>
        </div>
      )}

      {/* OTP Listening - Actively listening for spoken OTP */}
      {status === 'otp_listening' && (
        <div className="otp-verification-card listening">
          <div className="otp-header">
            <div className="mic-listening-animation">
              <svg className="otp-icon mic-active" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
              <div className="mic-pulse-ring"></div>
            </div>
            <h3>Listening...</h3>
          </div>
          <p className="otp-instruction">Speak the code now:</p>
          <div className="otp-display">
            {generatedOTP.split('').map((digit, index) => (
              <span key={index} className="otp-digit">{digit}</span>
            ))}
          </div>
          <div className="spoken-digits">
            <span className="spoken-label">Heard:</span>
            <span className="spoken-value">{spokenOTP || '...'}</span>
            <span className="spoken-count">({spokenOTP.length}/6 digits)</span>
          </div>
          {transcript && (
            <div className="raw-transcript">
              "{transcript}"
            </div>
          )}
        </div>
      )}

      {/* OTP Verifying */}
      {status === 'otp_verifying' && (
        <div className="otp-verification-card verifying">
          <div className="otp-header">
            <div className="spinner"></div>
            <h3>Verifying...</h3>
          </div>
          <p className="otp-instruction">Checking your voice input</p>
        </div>
      )}

      {/* Success state */}
      {status === 'success' && (
        <div className="face-status-standalone success">
          <div className="success-checkmark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <span>Verification Complete!</span>
        </div>
      )}

      {/* Escalated state */}
      {status === 'escalated' && (
        <div className="otp-verification-card escalated">
          <div className="otp-header">
            <svg className="otp-icon warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <h3>Manual Review Required</h3>
          </div>
          <p className="escalation-message">
            {error || 'Presence verification could not be completed. Your session has been escalated for manual review.'}
          </p>
          <div className="escalation-info">
            <span>Reference ID: {sessionId}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default FaceVerification;
