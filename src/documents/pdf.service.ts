const PDFParser = require('pdf2json');

type PdfText = {
  R: { T: string }[];
};

type PdfPage = {
  Texts: PdfText[];
};

type PdfData = {
  Pages: PdfPage[];
};

export function extractTextFromPDF(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    pdfParser.on('pdfParser_dataError', (err: unknown) => {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
          ? err
          : JSON.stringify(err);

      reject(new Error(message));
    });

    pdfParser.on('pdfParser_dataReady', (pdfData: PdfData) => {
      let text = '';

      pdfData.Pages.forEach((page) => {
        page.Texts.forEach((textItem) => {
          if (textItem.R && textItem.R[0] && textItem.R[0].T) {
            try {
              // 🔥 intento normal
              text += decodeURIComponent(textItem.R[0].T) + ' ';
            } catch {
              // ⚠️ fallback si falla (PDF corrupto o raro)
              text += textItem.R[0].T + ' ';
            }
          }
        });
      });

      resolve(text);
    });

    pdfParser.loadPDF(filePath);
  });
}
