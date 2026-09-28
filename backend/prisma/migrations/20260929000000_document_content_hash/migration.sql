-- Paso 3: huella del contenido para evitar documentos duplicados
ALTER TABLE "Document" ADD COLUMN "contentHash" TEXT;

CREATE INDEX "Document_contentHash_idx" ON "Document"("contentHash");
