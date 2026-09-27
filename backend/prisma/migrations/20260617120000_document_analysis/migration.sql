-- CreateTable
CREATE TABLE "DocumentAnalysis" (
    "id" SERIAL NOT NULL,
    "documentId" INTEGER NOT NULL,
    "overallSimilarity" DOUBLE PRECISION NOT NULL,
    "consistencyScore" DOUBLE PRECISION NOT NULL,
    "anomaliesDetected" INTEGER NOT NULL,
    "sourcesFound" INTEGER NOT NULL,
    "processingTimeMs" INTEGER NOT NULL,
    "semanticServiceStatus" TEXT NOT NULL,
    "detectedAsSimilar" BOOLEAN NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "systemClassification" TEXT NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAnalysis_documentId_key" ON "DocumentAnalysis"("documentId");

-- AddForeignKey
ALTER TABLE "DocumentAnalysis" ADD CONSTRAINT "DocumentAnalysis_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
