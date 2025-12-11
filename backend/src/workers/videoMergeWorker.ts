/**
 * Video Merge Worker
 * Background worker that combines video chunks into a single MP4 file
 * Uses ffmpeg for video processing
 */

import { spawn, exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { sessionTimelineService } from '../services/sessionTimelineService';

export type MergeStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'not_found';

interface MergeJob {
  sessionId: string;
  status: MergeStatus;
  progress?: number;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

class VideoMergeWorker {
  private jobs: Map<string, MergeJob> = new Map();
  private queue: string[] = [];
  private isProcessing: boolean = false;
  private ffmpegAvailable: boolean | null = null;

  constructor() {
    this.checkFfmpeg();
  }

  /**
   * Check if ffmpeg is available
   */
  private async checkFfmpeg(): Promise<boolean> {
    if (this.ffmpegAvailable !== null) {
      return this.ffmpegAvailable;
    }

    return new Promise((resolve) => {
      exec('ffmpeg -version', (error) => {
        this.ffmpegAvailable = !error;
        if (!this.ffmpegAvailable) {
          console.warn('[VideoMergeWorker] ffmpeg not found. Video merging will use fallback method.');
        } else {
          console.log('[VideoMergeWorker] ffmpeg detected and available');
        }
        resolve(this.ffmpegAvailable);
      });
    });
  }

  /**
   * Queue a session for video merge
   */
  queueMerge(sessionId: string): void {
    if (this.jobs.has(sessionId)) {
      const job = this.jobs.get(sessionId)!;
      if (job.status === 'processing' || job.status === 'completed') {
        console.log(`[VideoMergeWorker] Session ${sessionId} already ${job.status}`);
        return;
      }
    }

    this.jobs.set(sessionId, {
      sessionId,
      status: 'pending',
    });

    this.queue.push(sessionId);
    console.log(`[VideoMergeWorker] Queued session ${sessionId} for merge`);

    // Start processing if not already running
    this.processQueue();
  }

  /**
   * Process the merge queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const sessionId = this.queue.shift()!;
      await this.mergeSession(sessionId);
    }

    this.isProcessing = false;
  }

  /**
   * Merge video chunks for a session
   */
  private async mergeSession(sessionId: string): Promise<void> {
    const job = this.jobs.get(sessionId);
    if (!job) return;

    job.status = 'processing';
    job.startedAt = Date.now();

    console.log(`[VideoMergeWorker] Starting merge for session ${sessionId}`);

    try {
      const recordingsDir = sessionTimelineService.getRecordingsDir();
      const videosDir = sessionTimelineService.getVideosDir();
      const sessionDir = path.join(recordingsDir, sessionId);

      if (!fs.existsSync(sessionDir)) {
        throw new Error(`Session directory not found: ${sessionDir}`);
      }

      // Get all chunk files
      const chunkFiles = fs.readdirSync(sessionDir)
        .filter(f => f.startsWith('chunk-') && f.endsWith('.webm'))
        .sort((a, b) => {
          const numA = parseInt(a.replace('chunk-', '').replace('.webm', ''));
          const numB = parseInt(b.replace('chunk-', '').replace('.webm', ''));
          return numA - numB;
        });

      if (chunkFiles.length === 0) {
        throw new Error('No video chunks found');
      }

      console.log(`[VideoMergeWorker] Found ${chunkFiles.length} chunks to merge`);

      const outputPath = path.join(videosDir, `${sessionId}.mp4`);
      const hasFfmpeg = await this.checkFfmpeg();

      if (hasFfmpeg) {
        await this.mergeWithFfmpeg(sessionDir, chunkFiles, outputPath);
      } else {
        await this.mergeWithFallback(sessionDir, chunkFiles, outputPath);
      }

      // Verify output file exists
      if (!fs.existsSync(outputPath)) {
        throw new Error('Output video file not created');
      }

      // Update timeline service
      sessionTimelineService.markVideoMerged(sessionId, outputPath);

      job.status = 'completed';
      job.completedAt = Date.now();
      job.progress = 100;

      console.log(`[VideoMergeWorker] Merge completed for session ${sessionId}: ${outputPath}`);

    } catch (error: any) {
      job.status = 'failed';
      job.error = error.message;
      job.completedAt = Date.now();

      console.error(`[VideoMergeWorker] Merge failed for session ${sessionId}:`, error);
    }
  }

  /**
   * Merge using ffmpeg
   * MediaRecorder chunks are not independent files - only first chunk has headers.
   * We need to use filter_complex to properly concatenate them.
   */
  private async mergeWithFfmpeg(sessionDir: string, chunkFiles: string[], outputPath: string): Promise<void> {
    // First, try to combine all chunks into a single WebM using binary concatenation
    // This works because MediaRecorder chunks are actually contiguous data
    const combinedWebmPath = path.join(sessionDir, 'combined.webm');
    
    // Concatenate all chunk files into one WebM
    const writeStream = fs.createWriteStream(combinedWebmPath);
    for (const chunkFile of chunkFiles) {
      const chunkPath = path.join(sessionDir, chunkFile);
      const chunkData = fs.readFileSync(chunkPath);
      writeStream.write(chunkData);
    }
    
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      writeStream.end();
    });

    console.log(`[VideoMergeWorker] Combined ${chunkFiles.length} chunks into ${combinedWebmPath}`);

    // Now convert the combined WebM to MP4 using ffmpeg
    return new Promise((resolve, reject) => {
      const args = [
        '-i', combinedWebmPath,
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-preset', 'fast',
        '-crf', '23',
        '-movflags', '+faststart',
        '-y', // Overwrite output
        outputPath
      ];

      console.log(`[VideoMergeWorker] Running ffmpeg with args:`, args.join(' '));

      const ffmpeg = spawn('ffmpeg', args);
      
      let stderr = '';
      
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        // Log progress
        const progressMatch = data.toString().match(/time=(\d{2}:\d{2}:\d{2})/);
        if (progressMatch) {
          console.log(`[VideoMergeWorker] Progress: ${progressMatch[1]}`);
        }
      });

      ffmpeg.on('close', (code) => {
        // Cleanup combined webm
        try {
          fs.unlinkSync(combinedWebmPath);
        } catch (e) {
          // Ignore cleanup errors
        }

        if (code === 0) {
          resolve();
        } else {
          console.error(`[VideoMergeWorker] ffmpeg stderr:`, stderr);
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Fallback merge method (simple concatenation)
   * This produces a webm file instead of mp4 but doesn't require ffmpeg
   */
  private async mergeWithFallback(sessionDir: string, chunkFiles: string[], outputPath: string): Promise<void> {
    // Change output extension to webm for fallback
    const webmOutputPath = outputPath.replace('.mp4', '.webm');
    
    const writeStream = fs.createWriteStream(webmOutputPath);

    for (const chunkFile of chunkFiles) {
      const chunkPath = path.join(sessionDir, chunkFile);
      const chunkData = fs.readFileSync(chunkPath);
      writeStream.write(chunkData);
    }

    return new Promise((resolve, reject) => {
      writeStream.on('finish', () => {
        // Create a symlink or copy for the mp4 path (so URL still works)
        fs.copyFileSync(webmOutputPath, outputPath);
        resolve();
      });
      
      writeStream.on('error', reject);
      writeStream.end();
    });
  }

  /**
   * Get merge status for a session
   */
  getMergeStatus(sessionId: string): MergeStatus {
    const job = this.jobs.get(sessionId);
    if (!job) {
      // Check if video already exists
      if (sessionTimelineService.getMergedVideoPath(sessionId)) {
        return 'completed';
      }
      return 'not_found';
    }
    return job.status;
  }

  /**
   * Get job details
   */
  getJobDetails(sessionId: string): MergeJob | null {
    return this.jobs.get(sessionId) || null;
  }

  /**
   * Get queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Get all jobs
   */
  getAllJobs(): MergeJob[] {
    return Array.from(this.jobs.values());
  }
}

// Singleton instance
export const videoMergeWorker = new VideoMergeWorker();
export default videoMergeWorker;

