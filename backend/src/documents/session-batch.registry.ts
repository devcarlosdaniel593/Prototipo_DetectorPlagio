import { Injectable } from '@nestjs/common';

export type SessionBatchDocument = {
  id: number;
  title: string;
  content: string;
  filePath: string;
};

/**
 * Registro en memoria de documentos temporales de un lote en curso.
 * No usa Prisma ni tablas nuevas; se limpia al finalizar el batch.
 */
@Injectable()
export class SessionBatchRegistryService {
  private batches = new Map<string, SessionBatchDocument[]>();

  createBatch(batchId: string): void {
    this.batches.set(batchId, []);
  }

  register(batchId: string, doc: SessionBatchDocument): void {
    const list = this.batches.get(batchId);
    if (list) list.push(doc);
  }

  getPeers(batchId: string, excludeId: number): SessionBatchDocument[] {
    return (this.batches.get(batchId) || []).filter((d) => d.id !== excludeId);
  }

  clear(batchId: string): void {
    this.batches.delete(batchId);
  }
}
