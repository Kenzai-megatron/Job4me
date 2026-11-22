import { strToU8, zipSync, type Zippable } from 'fflate';

// `@job4me/imports/testing`: synthetic files for tests (never real CVs, never real people).
// PDFs are written by hand with exact cross-reference offsets; archives come from fflate.

function pdfString(text: string): string {
  return `(${text.replace(/[\\()]/g, (char) => `\\${char}`)})`;
}

export interface PdfOptions {
  /** A password-protected PDF (standard security handler, unknown password). */
  encrypted?: boolean;
}

/** A PDF with one page per entry; each page is a list of lines in Helvetica. */
export function makePdf(pages: string[][], options: PdfOptions = {}): Buffer {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add('');
  const pageTree = add('');
  const font = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  const kids: number[] = [];
  for (const lines of pages) {
    const text = lines.map(
      (line, index) => `${index === 0 ? '' : '0 -16 Td '}${pdfString(line)} Tj`,
    );
    const stream = lines.length > 0 ? `BT /F1 12 Tf 72 770 Td ${text.join(' ')} ET` : '';
    const contents = add(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
    kids.push(
      add(
        `<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contents} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] =
    `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const hex = (bytes: number, seed: string) => seed.repeat(bytes).slice(0, bytes * 2);
  const encrypt = options.encrypted
    ? add(
        `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <${hex(32, '4f')}> /U <${hex(32, '55')}> >>`,
      )
    : null;

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  const extra = encrypt
    ? ` /Encrypt ${encrypt} 0 R /ID [<${hex(16, 'a1')}> <${hex(16, 'a1')}>]`
    : '';
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${extra} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** A ZIP archive from names and contents. */
export function makeZip(files: Record<string, string | Uint8Array>, level: 0 | 6 | 9 = 6): Buffer {
  const entries: Zippable = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] = [typeof content === 'string' ? strToU8(content) : content, { level }];
  }
  return Buffer.from(zipSync(entries));
}

export interface DocxOptions {
  /** Adds a VBA project, as in a .docm document. */
  vbaProject?: boolean;
  /** Declares the macro-enabled content type without the VBA part. */
  macroContentType?: boolean;
}

const MAIN_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const MACRO_TYPE = 'application/vnd.ms-word.document.macroEnabled.main+xml';

function xmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A minimal Word document, one paragraph per entry. */
export function makeDocx(paragraphs: string[], options: DocxOptions = {}): Buffer {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${xmlText(text)}</w:t></w:r></w:p>`)
    .join('');
  const files: Record<string, string | Uint8Array> = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/word/document.xml" ContentType="${options.macroContentType ? MACRO_TYPE : MAIN_TYPE}"/>` +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
    'word/document.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  };
  if (options.vbaProject) files['word/vbaProject.bin'] = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]);
  return makeZip(files);
}

/** Names of the synthetic people of the archive below; none of them may ever be read. */
export const THIRD_PARTY_NAMES = ['Camille Tierce', 'Sam Contact'];

/** A LinkedIn-like archive: profile files, plus connections and messages that must stay closed. */
export function makeLinkedinArchive(): Buffer {
  return makeZip({
    'Profile.csv':
      'First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location\n' +
      'Alex,Exemple,,Rue Fictive 1,1 Jan 1990,Analyste de données,"Analyse, rapports et tableaux de bord",Banque,1000,"Bruxelles, Région de Bruxelles-Capitale, Belgique"\n',
    'Positions.csv':
      'Company Name,Title,Description,Location,Started On,Finished On\n' +
      'Exemple SA,Analyste de données,Rapports mensuels,Bruxelles,Mar 2022,\n' +
      'Démo SPRL,Stagiaire,"Tableaux de bord, Excel",Liège,Sep 2021,Feb 2022\n',
    'Skills.csv': 'Name\nSQL\nPower BI\nPython\n',
    'Languages.csv':
      'Name,Proficiency\nFrançais,Native or bilingual proficiency\nNederlands,Professional working proficiency\n',
    'Jobs/Saved Jobs.csv':
      'Saved Date,Job Url,Job Title,Company Name\n' +
      '11/3/26 10:00 AM,https://www.linkedin.com/jobs/view/1,Data Analyst,Exemple SA\n',
    'Jobs/Job Applications.csv':
      'Application Date,Contact Email,Contact Phone Number,Company Name,Job Title,Job Url,Resume Name,Question And Answers\n' +
      '11/2/26 9:00 AM,alex@example.org,+32 470 00 00 00,Démo SPRL,Analyste BI,https://www.linkedin.com/jobs/view/2,cv.pdf,\n',
    'Connections.csv':
      'Notes:\n"Connections of the member"\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\n' +
      'Camille,Tierce,https://www.linkedin.com/in/x,camille@example.org,Ailleurs SA,Manager,1 Jan 2026\n',
    'messages.csv':
      'CONVERSATION ID,FROM,TO,DATE,CONTENT\n1,Sam Contact,Alex Exemple,2026-01-01,Bonjour\n',
  });
}

/** One highly compressible entry: a few kilobytes that inflate to `megabytes` MB. */
export function makeZipBomb(megabytes = 30): Buffer {
  return makeZip({ 'Positions.csv': new Uint8Array(megabytes * 1024 * 1024) }, 9);
}

const CENTRAL_SIGNATURE = 0x02014b50;

/** Edits every central directory record of an archive (flags at +8, uncompressed size at +24). */
export function patchCentralDirectory(
  zip: Buffer,
  patch: (record: { flags: number; uncompressedSize: number }) => {
    flags?: number;
    uncompressedSize?: number;
  },
): Buffer {
  const copy = Buffer.from(zip);
  for (let offset = 0; offset + 46 <= copy.length; offset += 1) {
    if (copy.readUInt32LE(offset) !== CENTRAL_SIGNATURE) continue;
    const change = patch({
      flags: copy.readUInt16LE(offset + 8),
      uncompressedSize: copy.readUInt32LE(offset + 24),
    });
    if (change.flags !== undefined) copy.writeUInt16LE(change.flags, offset + 8);
    if (change.uncompressedSize !== undefined) {
      copy.writeUInt32LE(change.uncompressedSize, offset + 24);
    }
  }
  return copy;
}
