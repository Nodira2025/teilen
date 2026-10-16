export class AppError extends Error {
  constructor(message, status = 400, code = 'INVALID_INPUT') {
    super(message); this.status = status; this.code = code;
  }
}

export function digits(value) {
  if (typeof value !== 'string' || !/^[\d.\s-]+$/.test(value) || value.length > 30) {
    throw new AppError('Ingresá únicamente los números del DNI o CUIT/CUIL.');
  }
  return value.replace(/[.\s-]/g, '');
}

export function checkDigit(firstTen) {
  if (!/^\d{10}$/.test(firstTen)) return null;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const result = 11 - [...firstTen].reduce((sum, n, i) => sum + Number(n) * weights[i], 0) % 11;
  return result === 11 ? 0 : result === 10 ? null : result;
}

export function isValidCuit(cuit) {
  return /^\d{11}$/.test(cuit) && /^(20|23|24|27|30|33|34)/.test(cuit)
    && !/^0{8}$/.test(cuit.slice(2, 10)) && checkDigit(cuit.slice(0, 10)) === Number(cuit[10]);
}

export function resolveIdentity(document, prefix) {
  const value = digits(document);
  if (value.length === 11) {
    if (!isValidCuit(value)) throw new AppError('El CUIT/CUIL no es válido. Revisá los 11 dígitos.');
    return { cuit: value, method: 'provided', verifiedIdentity: false };
  }
  if (!/^\d{7,8}$/.test(value) || Number(value) === 0) throw new AppError('Ingresá un DNI de 7 u 8 dígitos, o un CUIT/CUIL de 11.');
  if (!['20', '23', '24', '27'].includes(prefix)) throw new AppError('Para completar el DNI, elegí el prefijo real del CUIL o ingresá el CUIL completo.');
  const firstTen = prefix + value.padStart(8, '0');
  const digit = checkDigit(firstTen);
  if (digit === null) throw new AppError('Ese prefijo no forma un CUIL válido con este DNI. Revisá la constancia o ingresá el CUIL completo.');
  return { cuit: firstTen + digit, method: 'calculated', verifiedIdentity: false };
}

export function validateLookup(body) {
  if (!body || body.consent !== true) throw new AppError('Confirmá que la consulta es propia o está autorizada.', 400, 'CONSENT_REQUIRED');
  const identity = resolveIdentity(body.document, body.prefix);
  if (identity.method === 'calculated' && body.confirmedIdentity !== true) {
    throw new AppError('Confirmá el CUIL calculado con la constancia del titular.', 400, 'IDENTITY_CONFIRMATION_REQUIRED');
  }
  return identity;
}
