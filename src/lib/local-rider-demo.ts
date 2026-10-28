import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { DOCUMENT_LABELS, type Fields } from './rider-application-policy';
import { localDemoDirectory } from './local-demo-files';
const pick = <T,>(values: readonly T[]) => values[randomInt(values.length)];
const first = ['Mateo', 'Liza', 'Renato', 'Ana', 'Joel', 'Carlo', 'Mika', 'Paolo', 'Diana', 'Ramon'];
const last = ['Dizon', 'Soriano', 'Villanueva', 'Mercado', 'Bautista', 'Reyes', 'Cruz', 'Ramos'];
const areas = ['Maniboc, Lingayen', 'Poblacion, Lingayen', 'Poblacion, Binmaley', 'Pantal, Dagupan City', 'Tapuac, Dagupan City', 'Calmay, Dagupan City'];
export function demoIdentity() {
  const id = randomUUID().slice(0, 8);
  return { name: `${pick(first)} ${pick(last)}`, email: `rider-${id}@rider-demo.example.invalid`, password: process.env.LOCAL_DEMO_PASSWORD || 'LocalDemo-Only-2026!' };
}
export function demoSelection() { return { vehicleClass: pick(['MOTORCYCLE', 'TRICYCLE', 'SEDAN']), services: pick([['DELIVERY'], ['RIDE'], ['DELIVERY', 'RIDE']]) }; }
export function demoFields(vehicle: string, name: string): Fields {
  const year = new Date().getUTCFullYear(), token = randomUUID().slice(0, 8).toUpperCase();
  const model = vehicle === 'SEDAN' ? pick([['Toyota', 'Vios'], ['Mitsubishi', 'Mirage']]) : vehicle === 'TRICYCLE' ? pick([['Bajaj', 'RE'], ['TVS', 'King']]) : pick([['Honda', 'Click 125i'], ['Yamaha', 'Mio Gear']]);
  return { legalName: name.replace(/^Demo /, ''), birthDate: `${year - randomInt(22, 51)}-${String(randomInt(1, 13)).padStart(2, '0')}-${String(randomInt(1, 28)).padStart(2, '0')}`, address: `Lot ${randomInt(1, 150)}, ${pick(areas)}, Pangasinan`, mobile: `0999000${String(randomInt(0, 10000)).padStart(4, '0')}`, emergencyName: `${pick(first)} ${pick(last)}`, emergencyRelationship: pick(['Sibling', 'Parent', 'Spouse']), emergencyPhone: `0999000${String(randomInt(0, 10000)).padStart(4, '0')}`, licenceNumber: `APP-LIC-${token}`, licenceCodes: vehicle === 'SEDAN' ? 'B' : vehicle === 'TRICYCLE' ? 'A1' : 'A', licenceExpiry: `${year + 3}-12-31`, nbiExpiry: `${year + 1}-12-31`, vehicleMake: model[0], vehicleModel: model[1], vehicleYear: String(year - randomInt(1, 7)), plateNumber: `F-${token.slice(0, 6)}`, registrationExpiry: `${year + 1}-12-31`, capacity: vehicle === 'SEDAN' ? '4' : vehicle === 'TRICYCLE' ? '2' : '1', displacement: vehicle === 'TRICYCLE' ? '200' : '125', ownership: pick(['OWNER', 'BORROWED', 'PURCHASED']), operatingArea: 'Lingayen - Binmaley - Dagupan, Pangasinan', permitNumber: `APP-PERMIT-${token}` };
}
const plain = (s: string) => s.normalize('NFKD').replace(/[^\x20-\x7e]/g, '-');
export async function demoDocument(kind: string, fields: Fields, vehicle: string, portrait?: Buffer) {
  if (kind === 'PROFILE') { if (!portrait) throw Error('Demo portrait missing.'); return portrait; }
  if (!DOCUMENT_LABELS[kind]) throw Error('Unknown demo document.');
  const pdf = await PDFDocument.create(), page = pdf.addPage(); page.setSize(595, 842);
  pdf.setTitle('DEMO / NOT VALID - ' + kind); pdf.setAuthor('Fetch-It Local Test Lab'); pdf.setSubject('Fictional software test document. No identity or legal value.');
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.09, .23, .19), muted = rgb(.38, .44, .4), orange = rgb(.75, .29, .1), line = rgb(.83, .87, .84);
  page.drawRectangle({ x: 0, y: 754, width: 595, height: 88, color: ink });
  page.drawText('FETCH-IT  /  LOCAL TEST LAB', { x: 38, y: 807, font: bold, size: 15, color: rgb(1, 1, 1) });
  page.drawText('SAMPLE DOCUMENT - NOT GOVERNMENT ISSUED', { x: 38, y: 780, font: bold, size: 10, color: rgb(1, .8, .6) });
  page.drawText('DEMO / NOT VALID', { x: 55, y: 299, font: bold, size: 47, rotate: degrees(35), color: rgb(.96, .89, .84), opacity: .8 });
  let y = 722;
  function text(value: string, size = 11, strong = false) {
    const font = strong ? bold : regular;
    const words = plain(value).split(/\s+/); let row = '';
    for (const word of words) { if (font.widthOfTextAtSize(row + ' ' + word, size) > 510) { page.drawText(row, { x: 38, y, font, size, color: ink }); y -= size + 6; row = word; } else row += (row ? ' ' : '') + word; }
    page.drawText(row, { x: 38, y, font, size, color: ink }); y -= size + 14;
  }
  text(DOCUMENT_LABELS[kind], 18, true);
  text(`Sample reference: DEMO-${kind}-${randomUUID().slice(0, 8).toUpperCase()}`, 10);
  page.drawLine({ start: { x: 38, y }, end: { x: 557, y }, thickness: 1, color: line }); y -= 28;
  if (portrait && ['LICENCE_FRONT', 'NBI'].includes(kind)) { const image = await pdf.embedPng(portrait); page.drawImage(image, { x: 447, y: y - 103, width: 95, height: 95 }); }
  const core = [['Applicant', fields.legalName], ['Home address', fields.address], ['Declared vehicle', vehicle === 'SEDAN' ? 'Car' : vehicle], ['Sample licence', fields.licenceNumber]];
  const vehicleRows = [['Make / model', `${fields.vehicleMake} ${fields.vehicleModel}`], ['Model year', fields.vehicleYear], ['Sample plate', fields.plateNumber], ['Ownership', fields.ownership], ['Registration valid until', fields.registrationExpiry]];
  const specific: Record<string, string[][]> = {
    LICENCE_FRONT: [['Birth date', fields.birthDate], ['Declared codes', fields.licenceCodes], ['Valid until', fields.licenceExpiry]],
    LICENCE_BACK: [['Declared codes', fields.licenceCodes], ['Restrictions', 'DEMO test entry only'], ['Emergency contact', fields.emergencyName]],
    NBI: [['Sample screening result', 'DEMO - NOT A CLEARANCE'], ['Sample validity', fields.nbiExpiry], ['Purpose', 'Local application review testing']],
    OR: [...vehicleRows, ['Sample amount', `PHP ${randomInt(12, 40) * 100}.00 - no money collected`]], CR: vehicleRows,
    OWNER_AUTH: [['Sample registered owner', 'Demo vehicle owner'], ['Authority', 'Test authorization only; no legal effect'], ['Vehicle', `${fields.vehicleMake} ${fields.vehicleModel} / ${fields.plateNumber}`]],
    OWNER_ID: [['Sample owner', 'Demo vehicle owner'], ['Reference', 'DEMO-OWNER-ID - no identification value']],
    DEED_OF_SALE: [['Sample seller', 'Demo previous owner'], ['Sample buyer', fields.legalName], ['Vehicle', fields.plateNumber], ['Legal effect', 'NONE - not notarized or executed']],
    PASSENGER_PERMIT: [['Reference', fields.permitNumber], ['Test area', fields.operatingArea], ['Authority', 'NONE - no franchise or operating permission']],
    PASSENGER_INSURANCE: [['Sample vehicle', fields.plateNumber], ['Coverage', 'NONE - no insurance contract'], ['Test period ends', fields.registrationExpiry]],
    MEDICAL: [['Sample assessment', 'DEMO - not a medical assessment'], ['Purpose', 'Document replacement testing only']],
    DRUG_TEST: [['Sample result', 'DEMO - no specimen or laboratory test'], ['Purpose', 'Document replacement testing only']],
  };
  for (const [key, value] of [...core, ...(specific[kind] || [])]) { text(key.toUpperCase(), 8, true); text(value || 'Demo entry', 11); }
  page.drawRectangle({ x: 38, y: 80, width: 519, height: 55, color: rgb(1, .96, .91), borderColor: orange, borderWidth: 1 });
  page.drawText('DEMO / NOT VALID', { x: 52, y: 112, font: bold, size: 13, color: orange });
  page.drawText('Fictional test data. No agency, official, insurer or laboratory issued this file.', { x: 52, y: 94, font: regular, size: 8, color: muted });
  page.drawText('Fetch-It local lab  |  1 / 1  |  Not for identity, legal or operational use', { x: 38, y: 44, font: regular, size: 8, color: muted });
  return Buffer.from(await pdf.save());
}
export async function demoPortrait() {
  const name = pick(['mateo', 'liza', 'renato', 'ana', 'joel']);
  return fs.readFile(path.join(localDemoDirectory(), 'portraits', `${name}.png`));
}
