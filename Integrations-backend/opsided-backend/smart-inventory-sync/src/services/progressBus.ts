import { EventEmitter } from 'events';

export interface ProgressEventPayload {
  jobId: string;
  userId: string;
  percentage: number;
  current: number;
  total: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  errors?: string[];
  warnings?: string[];
  timestamp: string;
}

class ProgressBus extends EventEmitter {
  emitProgress(payload: ProgressEventPayload) {
    this.emit('progress', payload);
  }
}

export const progressBus = new ProgressBus();







