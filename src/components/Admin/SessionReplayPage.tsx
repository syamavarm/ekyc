/**
 * Session Replay Page
 * Admin page to replay KYC sessions with synchronized video and timeline
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import './SessionReplayPage.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

interface TimelineEntry {
  id: string;
  timestamp: number;
  type: 'video_chunk' | 'ui_event' | 'backend_decision' | 'recording_started' | 'recording_ended';
  subType?: string;
  data: any;
}

interface RecordingMetadata {
  sessionId: string;
  totalChunks: number;
  totalDuration: number;
  startTime: number;
  endTime: number;
  merged: boolean;
}

interface SessionTimeline {
  sessionId: string;
  hasVideo: boolean;
  videoUrl: string | null;
  chunksCount: number;
  eventsCount: number;
  decisionsCount: number;
  recordingMetadata?: RecordingMetadata;
  timeline: TimelineEntry[];
}

interface SessionDetails {
  userId?: string;
  email?: string;
  mobileNumber?: string;
  status?: string;
  createdAt?: string;
  completedAt?: string;
  consent?: any;
  location?: any;
  document?: any;
  secureVerification?: any;
  questionnaire?: any;
  verificationResults?: any;
  overallScore?: number;
}

interface DocumentInfo {
  type: string;
  url: string;
  filename: string;
}

interface SessionDetailsResponse {
  sessionDetails: SessionDetails | null;
  documents: DocumentInfo[];
  ocrResults: any;
  reportData: any;
}

interface SessionReplayPageProps {
  sessionId: string;
  onBack?: () => void;
}

const SessionReplayPage: React.FC<SessionReplayPageProps> = ({ sessionId, onBack }) => {
  const [timeline, setTimeline] = useState<SessionTimeline | null>(null);
  const [sessionDetails, setSessionDetails] = useState<SessionDetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<TimelineEntry | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [filterType, setFilterType] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'timeline' | 'documents' | 'ocr' | 'report'>('timeline');
  
  // Chunked playback state
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [useChunkedPlayback, setUseChunkedPlayback] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Fetch session timeline and details
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch both timeline and session details in parallel
        const [timelineResponse, detailsResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/admin/session/${sessionId}/timeline`),
          fetch(`${API_BASE_URL}/admin/session/${sessionId}/details`),
        ]);
        
        if (!timelineResponse.ok) {
          throw new Error('Failed to fetch timeline');
        }
        
        const timelineData = await timelineResponse.json();
        setTimeline(timelineData);
        
        if (detailsResponse.ok) {
          const detailsData = await detailsResponse.json();
          setSessionDetails(detailsData);
        }
        
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Failed to load session data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [sessionId]);

  // Handle video metadata loaded - check if merged video is valid
  const handleVideoLoadedMetadata = useCallback(() => {
    if (videoRef.current && timeline?.recordingMetadata) {
      const videoDuration = videoRef.current.duration;
      const expectedDuration = timeline.recordingMetadata.totalDuration / 1000;
      
      // If video duration is much shorter than expected (< 10% of expected), switch to chunked playback
      if (videoDuration < expectedDuration * 0.1) {
        console.log(`[SessionReplay] Merged video is invalid (${videoDuration}s vs expected ${expectedDuration}s), switching to chunked playback`);
        setUseChunkedPlayback(true);
        setVideoError('Merged video is invalid. Using chunked playback.');
      }
    }
  }, [timeline]);

  // Handle video error - switch to chunked playback
  const handleVideoError = useCallback(() => {
    console.log('[SessionReplay] Video error, switching to chunked playback');
    setUseChunkedPlayback(true);
    setVideoError('Failed to load merged video. Using chunked playback.');
  }, []);

  // Get current chunk URL
  const getCurrentChunkUrl = useCallback(() => {
    return `${API_BASE_URL}/admin/session/${sessionId}/chunk/${currentChunkIndex}`;
  }, [sessionId, currentChunkIndex]);

  // Handle chunk ended - play next chunk
  const handleChunkEnded = useCallback(() => {
    if (timeline?.chunksCount && currentChunkIndex < timeline.chunksCount - 1) {
      setCurrentChunkIndex(prev => prev + 1);
    } else {
      setIsPlaying(false);
    }
  }, [timeline, currentChunkIndex]);

  // Auto-play next chunk when chunk index changes
  useEffect(() => {
    if (useChunkedPlayback && videoRef.current && isPlaying) {
      videoRef.current.play().catch(console.error);
    }
  }, [currentChunkIndex, useChunkedPlayback, isPlaying]);

  // Sync video time with timeline
  const handleVideoTimeUpdate = useCallback(() => {
    if (videoRef.current && timeline?.recordingMetadata) {
      if (useChunkedPlayback) {
        // In chunked mode, calculate time based on chunk index + current video time
        const chunkDuration = 3000; // 3 seconds per chunk
        const chunkStartTime = currentChunkIndex * chunkDuration;
        const videoTime = videoRef.current.currentTime * 1000;
        const absoluteTime = timeline.recordingMetadata.startTime + chunkStartTime + videoTime;
        setCurrentTime(absoluteTime);
      } else {
        const videoTime = videoRef.current.currentTime * 1000; // Convert to ms
        const absoluteTime = timeline.recordingMetadata.startTime + videoTime;
        setCurrentTime(absoluteTime);
      }
    }
  }, [timeline, useChunkedPlayback, currentChunkIndex]);

  // Seek video to specific timeline entry
  const seekToEvent = useCallback((entry: TimelineEntry) => {
    if (videoRef.current && timeline?.recordingMetadata) {
      const relativeTime = entry.timestamp - timeline.recordingMetadata.startTime;
      
      if (useChunkedPlayback) {
        // In chunked mode, find the right chunk and seek within it
        const chunkDuration = 3000; // 3 seconds per chunk
        const targetChunk = Math.floor(relativeTime / chunkDuration);
        const timeWithinChunk = (relativeTime % chunkDuration) / 1000;
        
        if (targetChunk !== currentChunkIndex) {
          setCurrentChunkIndex(targetChunk);
          // Wait for video to load, then seek
          setTimeout(() => {
            if (videoRef.current) {
              videoRef.current.currentTime = timeWithinChunk;
            }
          }, 100);
        } else {
          videoRef.current.currentTime = timeWithinChunk;
        }
      } else {
        videoRef.current.currentTime = relativeTime / 1000;
      }
      setSelectedEvent(entry);
    }
  }, [timeline, useChunkedPlayback, currentChunkIndex]);

  // Handle play/pause
  const togglePlayback = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  // Handle playback rate change
  const handlePlaybackRateChange = (rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
      setPlaybackRate(rate);
    }
  };

  // Get icon for event type
  const getEventIcon = (entry: TimelineEntry): string => {
    if (entry.type === 'backend_decision') {
      const result = entry.data.result;
      switch (entry.subType) {
        case 'face_match':
          return result ? '✅' : '❌';
        case 'liveness_check':
          return result ? '🔴' : '⚫';
        case 'ocr_result':
          return result ? '📄' : '📄';
        case 'location_check':
          return result ? '📍' : '📍';
        case 'questionnaire_result':
          return result ? '❓' : '❓';
        case 'session_complete':
          return result ? '🎉' : '⚠️';
        default:
          return '⚙️';
      }
    }
    
    if (entry.type === 'ui_event') {
      switch (entry.subType) {
        case 'step_started':
          return '▶️';
        case 'step_completed':
          return '✓';
        case 'button_clicked':
          return '🖱️';
        case 'error_displayed':
          return '⚠️';
        case 'consent_given':
          return '📝';
        case 'document_captured':
        case 'document_front_captured':
        case 'document_back_captured':
          return '📷';
        case 'face_captured':
          return '🤳';
        default:
          return '📌';
      }
    }
    
    if (entry.type === 'recording_started') return '🎬';
    if (entry.type === 'recording_ended') return '🔚';
    if (entry.type === 'video_chunk') return '🎥';
    
    return '•';
  };

  // Get label for event
  const getEventLabel = (entry: TimelineEntry): string => {
    if (entry.type === 'backend_decision') {
      const result = entry.data.result ? 'PASS' : 'FAIL';
      switch (entry.subType) {
        case 'face_match':
          return `Face Match: ${result} (${((entry.data.score || 0) * 100).toFixed(0)}%)`;
        case 'liveness_check':
          return `Liveness: ${result} (${((entry.data.confidence || 0) * 100).toFixed(0)}%)`;
        case 'ocr_result':
          return `Document OCR: ${result}`;
        case 'location_check':
          return `Location: ${result}`;
        case 'questionnaire_result':
          return `Questionnaire: ${result} (${((entry.data.score || 0) * 100).toFixed(0)}%)`;
        case 'session_complete':
          return `Session ${result === 'PASS' ? 'Completed' : 'Failed'}`;
        default:
          return entry.subType || 'Decision';
      }
    }
    
    if (entry.type === 'ui_event') {
      const payload = entry.data.payload || {};
      switch (entry.subType) {
        case 'step_started':
          return `Started: ${payload.stepName || 'Step'}`;
        case 'step_completed':
          return `Completed: ${payload.stepName || 'Step'}`;
        case 'button_clicked':
          return `Clicked: ${payload.buttonLabel || payload.buttonId || 'Button'}`;
        case 'error_displayed':
          return `Error: ${payload.errorMessage || 'Unknown'}`;
        case 'consent_given':
          return 'User gave consent';
        case 'document_captured':
          return `Document captured: ${payload.documentType || 'ID'}`;
        case 'document_front_captured':
          return 'Front of document captured';
        case 'document_back_captured':
          return 'Back of document captured';
        case 'face_captured':
          return 'Face captured';
        case 'instruction_shown':
          return payload.message || 'Instruction shown';
        default:
          return entry.subType?.replace(/_/g, ' ') || 'Event';
      }
    }
    
    if (entry.type === 'recording_started') return 'Recording Started';
    if (entry.type === 'recording_ended') return 'Recording Ended';
    if (entry.type === 'video_chunk') return `Video Chunk ${entry.data.chunkIndex}`;
    
    return entry.type;
  };

  // Filter timeline entries
  const filteredTimeline = timeline?.timeline.filter(entry => {
    if (filterType === 'all') return true;
    if (filterType === 'decisions') return entry.type === 'backend_decision';
    if (filterType === 'ui_events') return entry.type === 'ui_event';
    if (filterType === 'video') return entry.type === 'video_chunk';
    return true;
  }) || [];

  // Get progress percentage
  const getProgressPercentage = (): number => {
    if (!timeline?.recordingMetadata) return 0;
    const { startTime, endTime } = timeline.recordingMetadata;
    const duration = endTime - startTime;
    if (duration <= 0) return 0;
    return ((currentTime - startTime) / duration) * 100;
  };

  // Check if event is active (current)
  const isEventActive = (entry: TimelineEntry): boolean => {
    if (!timeline?.recordingMetadata) return false;
    const { startTime, endTime } = timeline.recordingMetadata;
    const duration = endTime - startTime;
    const tolerance = duration * 0.02; // 2% tolerance
    return Math.abs(entry.timestamp - currentTime) < tolerance;
  };

  // Format timestamp
  const formatTimestamp = (timestamp: number): string => {
    if (!timeline?.recordingMetadata) return '--:--';
    const relativeMs = timestamp - timeline.recordingMetadata.startTime;
    const totalSeconds = Math.floor(relativeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Format duration
  const formatDuration = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  };

  if (loading) {
    return (
      <div className="session-replay-page">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading session replay...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="session-replay-page">
        <div className="error-container">
          <span className="error-icon">⚠️</span>
          <p>{error}</p>
          {onBack && (
            <button className="btn-secondary" onClick={onBack}>
              Go Back
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="session-replay-page">
      <header className="replay-header">
        <div className="header-left">
          {onBack && (
            <button className="btn-back" onClick={onBack}>
              ← Back
            </button>
          )}
          <h1>🎬 Session Replay</h1>
          <span className="session-id">Session: {sessionId.slice(0, 8)}...</span>
        </div>
        <div className="header-right">
          {timeline?.recordingMetadata && (
            <div className="session-stats">
              <span className="stat">
                <span className="stat-icon">⏱️</span>
                {formatDuration(timeline.recordingMetadata.totalDuration)}
              </span>
              <span className="stat">
                <span className="stat-icon">📹</span>
                {timeline.chunksCount} chunks
              </span>
              <span className="stat">
                <span className="stat-icon">📊</span>
                {timeline.eventsCount} events
              </span>
              <span className="stat">
                <span className="stat-icon">⚖️</span>
                {timeline.decisionsCount} decisions
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="replay-content">
        {/* Video Player Panel */}
        <div className="video-panel">
          <div className="video-container">
            {timeline?.hasVideo || (timeline?.chunksCount && timeline.chunksCount > 0) ? (
              <>
                <video
                  ref={videoRef}
                  src={useChunkedPlayback 
                    ? getCurrentChunkUrl() 
                    : `${API_BASE_URL}${timeline?.videoUrl}`
                  }
                  onTimeUpdate={handleVideoTimeUpdate}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onLoadedMetadata={handleVideoLoadedMetadata}
                  onError={handleVideoError}
                  onEnded={useChunkedPlayback ? handleChunkEnded : undefined}
                  controls={false}
                />
                {useChunkedPlayback && (
                  <div className="chunked-playback-indicator">
                    <span>📦 Chunk {currentChunkIndex + 1}/{timeline?.chunksCount || 0}</span>
                  </div>
                )}
                {videoError && (
                  <div className="video-warning">
                    <span>⚠️ {videoError}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="no-video">
                <span className="no-video-icon">📹</span>
                <p>No video available for this session</p>
                <p className="no-video-hint">Video may still be processing or was not recorded</p>
              </div>
            )}
          </div>
          
          {/* Custom Video Controls */}
          <div className="video-controls">
            <button className="btn-playback" onClick={togglePlayback}>
              {isPlaying ? '⏸️' : '▶️'}
            </button>
            
            <div className="progress-container">
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ width: `${getProgressPercentage()}%` }}
                />
                {/* Event markers on progress bar */}
                {filteredTimeline
                  .filter(e => e.type === 'backend_decision')
                  .map(entry => {
                    if (!timeline?.recordingMetadata) return null;
                    const { startTime, endTime } = timeline.recordingMetadata;
                    const position = ((entry.timestamp - startTime) / (endTime - startTime)) * 100;
                    return (
                      <div
                        key={entry.id}
                        className={`progress-marker ${entry.data.result ? 'success' : 'failure'}`}
                        style={{ left: `${position}%` }}
                        title={getEventLabel(entry)}
                        onClick={() => seekToEvent(entry)}
                      />
                    );
                  })}
              </div>
              <span className="time-display">
                {formatTimestamp(currentTime)} / {timeline?.recordingMetadata ? formatDuration(timeline.recordingMetadata.totalDuration) : '--:--'}
              </span>
            </div>
            
            <div className="playback-rate">
              <label>Speed:</label>
              <select 
                value={playbackRate} 
                onChange={(e) => handlePlaybackRateChange(parseFloat(e.target.value))}
              >
                <option value={0.5}>0.5x</option>
                <option value={1}>1x</option>
                <option value={1.5}>1.5x</option>
                <option value={2}>2x</option>
              </select>
            </div>
          </div>
        </div>

        {/* Timeline/Data Panel with Tabs */}
        <div className="timeline-panel" ref={timelineRef}>
          <div className="panel-tabs">
            <button 
              className={`tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
              onClick={() => setActiveTab('timeline')}
            >
              📊 Timeline
            </button>
            <button 
              className={`tab-btn ${activeTab === 'documents' ? 'active' : ''}`}
              onClick={() => setActiveTab('documents')}
            >
              📄 Documents
            </button>
            <button 
              className={`tab-btn ${activeTab === 'ocr' ? 'active' : ''}`}
              onClick={() => setActiveTab('ocr')}
            >
              🔍 OCR Data
            </button>
            <button 
              className={`tab-btn ${activeTab === 'report' ? 'active' : ''}`}
              onClick={() => setActiveTab('report')}
            >
              📋 Report
            </button>
          </div>

          {/* Timeline Tab */}
          {activeTab === 'timeline' && (
            <>
              <div className="timeline-header">
                <h2>Timeline</h2>
                <div className="timeline-filters">
                  <button 
                    className={`filter-btn ${filterType === 'all' ? 'active' : ''}`}
                    onClick={() => setFilterType('all')}
                  >
                    All
                  </button>
                  <button 
                    className={`filter-btn ${filterType === 'decisions' ? 'active' : ''}`}
                    onClick={() => setFilterType('decisions')}
                  >
                    Decisions
                  </button>
                  <button 
                    className={`filter-btn ${filterType === 'ui_events' ? 'active' : ''}`}
                    onClick={() => setFilterType('ui_events')}
                  >
                    UI Events
                  </button>
                </div>
              </div>
              
              <div className="timeline-list">
                {filteredTimeline.map((entry) => (
                  <div
                    key={entry.id}
                    className={`timeline-entry ${entry.type} ${isEventActive(entry) ? 'active' : ''} ${selectedEvent?.id === entry.id ? 'selected' : ''}`}
                    onClick={() => seekToEvent(entry)}
                  >
                    <div className="entry-time">{formatTimestamp(entry.timestamp)}</div>
                    <div className="entry-icon">{getEventIcon(entry)}</div>
                    <div className="entry-content">
                      <div className="entry-label">{getEventLabel(entry)}</div>
                      {entry.type === 'backend_decision' && entry.data.score !== undefined && (
                        <div className="entry-score">
                          Score: {((entry.data.score || 0) * 100).toFixed(1)}%
                        </div>
                      )}
                    </div>
                    {entry.type === 'backend_decision' && (
                      <div className={`entry-result ${entry.data.result ? 'pass' : 'fail'}`}>
                        {entry.data.result ? 'PASS' : 'FAIL'}
                      </div>
                    )}
                  </div>
                ))}
                
                {filteredTimeline.length === 0 && (
                  <div className="no-entries">
                    <p>No timeline entries found</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Documents Tab */}
          {activeTab === 'documents' && (
            <div className="documents-tab">
              <h2>📄 Captured Documents</h2>
              
              {sessionDetails?.documents && sessionDetails.documents.length > 0 ? (
                <div className="documents-grid">
                  {sessionDetails.documents.map((doc, index) => (
                    <div key={index} className="document-card">
                      <div className="document-label">
                        {doc.type === 'front' ? '🪪 Front Side' : 
                         doc.type === 'back' ? '🔄 Back Side' : 
                         doc.type === 'face' ? '🤳 Face Capture' : '📄 Document'}
                      </div>
                      <div className="document-image-container">
                        <img 
                          src={`${API_BASE_URL}${doc.url}`} 
                          alt={`Document ${doc.type}`}
                          className="document-image"
                          onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            img.style.display = 'none';
                            // Show error message
                            const container = img.parentElement;
                            if (container && !container.querySelector('.image-error')) {
                              const errorDiv = document.createElement('div');
                              errorDiv.className = 'image-error';
                              errorDiv.innerHTML = '⚠️ Image not found';
                              container.appendChild(errorDiv);
                            }
                          }}
                          onLoad={(e) => {
                            (e.target as HTMLImageElement).style.display = 'block';
                          }}
                        />
                      </div>
                      <div className="document-filename">{doc.filename}</div>
                    </div>
                  ))}
                </div>
              ) : sessionDetails?.sessionDetails?.document ? (
                <div className="documents-grid">
                  {sessionDetails.sessionDetails.document.imageUrl && (
                    <div className="document-card">
                      <div className="document-label">🪪 Front Side</div>
                      <div className="document-image-container">
                        <img 
                          src={`${API_BASE_URL}${sessionDetails.sessionDetails.document.imageUrl}`} 
                          alt="Document Front"
                          className="document-image"
                        />
                      </div>
                    </div>
                  )}
                  {sessionDetails.sessionDetails.document.backImageUrl && (
                    <div className="document-card">
                      <div className="document-label">🔄 Back Side</div>
                      <div className="document-image-container">
                        <img 
                          src={`${API_BASE_URL}${sessionDetails.sessionDetails.document.backImageUrl}`} 
                          alt="Document Back"
                          className="document-image"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="no-data">
                  <span className="no-data-icon">📄</span>
                  <p>No documents available for this session</p>
                </div>
              )}
            </div>
          )}

          {/* OCR Data Tab */}
          {activeTab === 'ocr' && (
            <div className="ocr-tab">
              <h2>🔍 Extracted Data (OCR)</h2>
              
              {(sessionDetails?.ocrResults || sessionDetails?.sessionDetails?.document?.ocrResults) ? (
                <div className="ocr-results">
                  {(() => {
                    const ocr = sessionDetails?.ocrResults || sessionDetails?.sessionDetails?.document?.ocrResults;
                    const extractedData = ocr?.extractedData || {};
                    return (
                      <>
                        <div className="ocr-section">
                          <h3>📋 Personal Information</h3>
                          <div className="ocr-fields">
                            {extractedData.fullName && (
                              <div className="ocr-field">
                                <label>Full Name</label>
                                <span>{extractedData.fullName}</span>
                              </div>
                            )}
                            {extractedData.firstName && (
                              <div className="ocr-field">
                                <label>First Name</label>
                                <span>{extractedData.firstName}</span>
                              </div>
                            )}
                            {extractedData.lastName && (
                              <div className="ocr-field">
                                <label>Last Name</label>
                                <span>{extractedData.lastName}</span>
                              </div>
                            )}
                            {extractedData.dateOfBirth && (
                              <div className="ocr-field">
                                <label>Date of Birth</label>
                                <span>{extractedData.dateOfBirth}</span>
                              </div>
                            )}
                            {extractedData.gender && (
                              <div className="ocr-field">
                                <label>Gender</label>
                                <span>{extractedData.gender}</span>
                              </div>
                            )}
                            {extractedData.nationality && (
                              <div className="ocr-field">
                                <label>Nationality</label>
                                <span>{extractedData.nationality}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <div className="ocr-section">
                          <h3>🆔 Document Details</h3>
                          <div className="ocr-fields">
                            {extractedData.documentNumber && (
                              <div className="ocr-field">
                                <label>Document Number</label>
                                <span>{extractedData.documentNumber}</span>
                              </div>
                            )}
                            {extractedData.issueDate && (
                              <div className="ocr-field">
                                <label>Issue Date</label>
                                <span>{extractedData.issueDate}</span>
                              </div>
                            )}
                            {extractedData.expiryDate && (
                              <div className="ocr-field">
                                <label>Expiry Date</label>
                                <span>{extractedData.expiryDate}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {extractedData.address && (
                          <div className="ocr-section">
                            <h3>📍 Address</h3>
                            <div className="ocr-fields">
                              <div className="ocr-field full-width">
                                <label>Address</label>
                                <span>{extractedData.address}</span>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        <div className="ocr-section">
                          <h3>📊 OCR Confidence</h3>
                          <div className="confidence-bar-container">
                            <div 
                              className="confidence-bar" 
                              style={{ width: `${(ocr?.confidence || 0) * 100}%` }}
                            />
                            <span className="confidence-value">
                              {((ocr?.confidence || 0) * 100).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              ) : (
                <div className="no-data">
                  <span className="no-data-icon">🔍</span>
                  <p>No OCR data available for this session</p>
                </div>
              )}
            </div>
          )}

          {/* Report Tab */}
          {activeTab === 'report' && (
            <div className="report-tab">
              <h2>📋 Session Report</h2>
              
              {sessionDetails?.sessionDetails ? (
                <div className="report-content">
                  {/* Session Overview */}
                  <div className="report-section">
                    <h3>📌 Session Overview</h3>
                    <div className="report-fields">
                      <div className="report-field">
                        <label>Status</label>
                        <span className={`status-badge ${sessionDetails.sessionDetails.status}`}>
                          {sessionDetails.sessionDetails.status}
                        </span>
                      </div>
                      {sessionDetails.sessionDetails.userId && (
                        <div className="report-field">
                          <label>User ID</label>
                          <span>{sessionDetails.sessionDetails.userId}</span>
                        </div>
                      )}
                      {sessionDetails.sessionDetails.email && (
                        <div className="report-field">
                          <label>Email</label>
                          <span>{sessionDetails.sessionDetails.email}</span>
                        </div>
                      )}
                      {sessionDetails.sessionDetails.createdAt && (
                        <div className="report-field">
                          <label>Started</label>
                          <span>{new Date(sessionDetails.sessionDetails.createdAt).toLocaleString()}</span>
                        </div>
                      )}
                      {sessionDetails.sessionDetails.completedAt && (
                        <div className="report-field">
                          <label>Completed</label>
                          <span>{new Date(sessionDetails.sessionDetails.completedAt).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Verification Results */}
                  {sessionDetails.sessionDetails.verificationResults && (
                    <div className="report-section">
                      <h3>✅ Verification Results</h3>
                      <div className="verification-results">
                        <div className={`verification-item ${sessionDetails.sessionDetails.verificationResults.documentVerified ? 'pass' : 'fail'}`}>
                          <span className="verification-icon">
                            {sessionDetails.sessionDetails.verificationResults.documentVerified ? '✅' : '❌'}
                          </span>
                          <span className="verification-label">Document</span>
                        </div>
                        <div className={`verification-item ${sessionDetails.sessionDetails.verificationResults.secureVerificationVerified ? 'pass' : 'fail'}`}>
                          <span className="verification-icon">
                            {sessionDetails.sessionDetails.verificationResults.secureVerificationVerified ? '✅' : '❌'}
                          </span>
                          <span className="verification-label">Face Match</span>
                        </div>
                        <div className={`verification-item ${sessionDetails.sessionDetails.verificationResults.locationVerified ? 'pass' : 'fail'}`}>
                          <span className="verification-icon">
                            {sessionDetails.sessionDetails.verificationResults.locationVerified ? '✅' : '❌'}
                          </span>
                          <span className="verification-label">Location</span>
                        </div>
                        <div className={`verification-item ${sessionDetails.sessionDetails.verificationResults.overallVerified ? 'pass' : 'fail'}`}>
                          <span className="verification-icon">
                            {sessionDetails.sessionDetails.verificationResults.overallVerified ? '✅' : '❌'}
                          </span>
                          <span className="verification-label">Overall</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Face Match Details */}
                  {sessionDetails.sessionDetails.secureVerification && (
                    <div className="report-section">
                      <h3>🤳 Face Verification Details</h3>
                      <div className="report-fields">
                        <div className="report-field">
                          <label>Face Match Score</label>
                          <span>{((sessionDetails.sessionDetails.secureVerification.faceMatch?.matchScore || 0) * 100).toFixed(1)}%</span>
                        </div>
                        <div className="report-field">
                          <label>Liveness Confidence</label>
                          <span>{((sessionDetails.sessionDetails.secureVerification.liveness?.confidenceScore || 0) * 100).toFixed(1)}%</span>
                        </div>
                        <div className="report-field">
                          <label>Face Consistency</label>
                          <span>{((sessionDetails.sessionDetails.secureVerification.faceConsistency?.consistencyScore || 0) * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Location Details */}
                  {sessionDetails.sessionDetails.location && (
                    <div className="report-section">
                      <h3>📍 Location Details</h3>
                      <div className="report-fields">
                        {sessionDetails.sessionDetails.location.gps && (
                          <>
                            <div className="report-field">
                              <label>Latitude</label>
                              <span>{sessionDetails.sessionDetails.location.gps.latitude?.toFixed(6)}</span>
                            </div>
                            <div className="report-field">
                              <label>Longitude</label>
                              <span>{sessionDetails.sessionDetails.location.gps.longitude?.toFixed(6)}</span>
                            </div>
                          </>
                        )}
                        {sessionDetails.sessionDetails.location.ip && (
                          <div className="report-field">
                            <label>IP Location</label>
                            <span>
                              {sessionDetails.sessionDetails.location.ip.city}, 
                              {sessionDetails.sessionDetails.location.ip.country}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Overall Score */}
                  {sessionDetails.sessionDetails.overallScore !== undefined && (
                    <div className="report-section">
                      <h3>🏆 Overall Score</h3>
                      <div className="overall-score">
                        <div 
                          className="score-circle"
                          style={{
                            background: `conic-gradient(
                              ${sessionDetails.sessionDetails.overallScore >= 0.7 ? '#4caf50' : 
                                sessionDetails.sessionDetails.overallScore >= 0.5 ? '#ff9800' : '#f44336'} 
                              ${sessionDetails.sessionDetails.overallScore * 360}deg, 
                              #e0e0e0 0deg
                            )`
                          }}
                        >
                          <div className="score-inner">
                            {((sessionDetails.sessionDetails.overallScore || 0) * 100).toFixed(0)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : sessionDetails?.reportData ? (
                <div className="report-raw">
                  {sessionDetails.reportData.type === 'text' ? (
                    <pre className="report-text">{sessionDetails.reportData.content}</pre>
                  ) : (
                    <pre className="report-json">{JSON.stringify(sessionDetails.reportData, null, 2)}</pre>
                  )}
                </div>
              ) : (
                <div className="no-data">
                  <span className="no-data-icon">📋</span>
                  <p>No report data available for this session</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Event Inspector Panel */}
        <div className="inspector-panel">
          <div className="inspector-header">
            <h2>Event Details</h2>
          </div>
          
          {selectedEvent ? (
            <div className="inspector-content">
              <div className="inspector-field">
                <label>Type</label>
                <span className="type-badge">{selectedEvent.type}</span>
              </div>
              
              {selectedEvent.subType && (
                <div className="inspector-field">
                  <label>Sub-type</label>
                  <span>{selectedEvent.subType}</span>
                </div>
              )}
              
              <div className="inspector-field">
                <label>Timestamp</label>
                <span>{formatTimestamp(selectedEvent.timestamp)}</span>
              </div>
              
              <div className="inspector-field">
                <label>Event ID</label>
                <span className="event-id">{selectedEvent.id}</span>
              </div>
              
              {selectedEvent.type === 'backend_decision' && (
                <>
                  <div className="inspector-field">
                    <label>Result</label>
                    <span className={`result-badge ${selectedEvent.data.result ? 'pass' : 'fail'}`}>
                      {selectedEvent.data.result ? 'PASSED' : 'FAILED'}
                    </span>
                  </div>
                  {selectedEvent.data.score !== undefined && (
                    <div className="inspector-field">
                      <label>Score</label>
                      <span>{((selectedEvent.data.score || 0) * 100).toFixed(2)}%</span>
                    </div>
                  )}
                  {selectedEvent.data.confidence !== undefined && (
                    <div className="inspector-field">
                      <label>Confidence</label>
                      <span>{((selectedEvent.data.confidence || 0) * 100).toFixed(2)}%</span>
                    </div>
                  )}
                </>
              )}
              
              <div className="inspector-field full-width">
                <label>Raw Data</label>
                <pre className="raw-data">
                  {JSON.stringify(selectedEvent.data, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="inspector-empty">
              <p>Select an event from the timeline to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SessionReplayPage;

