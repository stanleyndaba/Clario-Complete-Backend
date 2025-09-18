import { Response } from 'express';

class SSEHub {
  private connections: Map<string, Set<Response>> = new Map();

  addConnection(userId: string, res: Response): void {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId)!.add(res);
  }

  removeConnection(userId: string, res: Response): void {
    const set = this.connections.get(userId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) {
      this.connections.delete(userId);
    }
  }

  sendEvent(userId: string, event: string, data: any): void {
    const set = this.connections.get(userId);
    if (!set) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) {
      try {
        res.write(payload);
      } catch {}
    }
  }
}

export const sseHub = new SSEHub();
export default sseHub;


