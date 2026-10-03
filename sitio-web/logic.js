// Pure, DOM-free logic shared by script.js and the test suite in tests/.
// Exposed on a single global namespace (AR) so it can be loaded standalone
// by tests without needing the rest of the page.
(function (global) {
  // Tarifa por andamio/día (MXN, sin IVA). Filas = cantidad total de andamios
  // (1-12), columnas = días de renta (1-30). Sale de la hoja "TABLA PROPUESTA"
  // de tracking-rentas-andamios.xlsx: la curva de 1 andamio por duración, con
  // descuento por volumen y un piso que garantiza recuperar el equipo en 12 meses.
  const TARIFAS_ANDAMIO = [
    [200, 180, 150, 130, 110, 110, 110, 110, 110, 100, 100, 100, 100, 90, 90, 90, 90, 90, 80, 80, 80, 80, 80, 70, 70, 70, 70, 70, 60, 60], // 1 andamio
    [195, 175, 145, 125, 110, 110, 110, 110, 110, 100, 100, 100, 100, 90, 90, 90, 90, 90, 80, 80, 80, 80, 80, 70, 70, 70, 70, 70, 60, 60], // 2 andamios
    [185, 170, 140, 120, 105, 105, 105, 105, 105, 95, 95, 95, 95, 85, 85, 85, 85, 85, 75, 75, 75, 75, 75, 65, 65, 65, 65, 65, 60, 60], // 3 andamios
    [180, 160, 135, 115, 100, 100, 100, 100, 100, 90, 90, 90, 90, 80, 80, 80, 80, 80, 75, 75, 75, 75, 75, 65, 65, 65, 65, 65, 55, 55], // 4 andamios
    [170, 155, 130, 110, 95, 95, 95, 95, 95, 85, 85, 85, 85, 80, 80, 80, 80, 80, 70, 70, 70, 70, 70, 60, 60, 60, 60, 60, 55, 55], // 5 andamios
    [160, 145, 120, 105, 90, 90, 90, 90, 90, 80, 80, 80, 80, 75, 75, 75, 75, 75, 65, 65, 65, 65, 65, 60, 60, 60, 60, 60, 50, 50], // 6 andamios
    [155, 140, 115, 100, 85, 85, 85, 85, 85, 80, 80, 80, 80, 70, 70, 70, 70, 70, 65, 65, 65, 65, 65, 55, 55, 55, 55, 55, 50, 50], // 7 andamios
    [145, 130, 110, 95, 80, 80, 80, 80, 80, 75, 75, 75, 75, 65, 65, 65, 65, 65, 60, 60, 60, 60, 60, 55, 55, 55, 55, 55, 45, 45], // 8 andamios
    [140, 125, 105, 90, 75, 75, 75, 75, 75, 70, 70, 70, 70, 65, 65, 65, 65, 65, 55, 55, 55, 55, 55, 50, 50, 50, 50, 50, 45, 45], // 9 andamios
    [130, 120, 100, 85, 75, 75, 75, 75, 75, 65, 65, 65, 65, 60, 60, 60, 60, 60, 55, 55, 55, 55, 55, 45, 45, 45, 45, 45, 45, 45], // 10 andamios
    [120, 110, 90, 80, 70, 70, 70, 70, 70, 60, 60, 60, 60, 55, 55, 55, 55, 55, 50, 50, 50, 50, 50, 45, 45, 45, 45, 45, 45, 45], // 11 andamios
    [120, 110, 90, 80, 70, 70, 70, 70, 70, 60, 60, 60, 60, 55, 55, 55, 55, 55, 50, 50, 50, 50, 50, 45, 45, 45, 45, 45, 45, 45], // 12 andamios
  ];
  const TOLUCA_LAT = 19.2926;
  const TOLUCA_LON = -99.6568;
  const RADIO_ENTREGA_GRATIS_KM = 20;
  const FEEDBACK_MAX_RATING = 5;

  // Precio por andamio/día según la duración de la renta y la cantidad total de
  // andamios del pedido. Fuera de la tabla se usa el último renglón/columna
  // (más de 12 andamios o más de 30 días) y por debajo de 1 se toma 1.
  function precioAndamioPorDia(dias, cantidad) {
    const fila = Math.min(Math.max(Math.floor(cantidad) || 1, 1), TARIFAS_ANDAMIO.length);
    const columna = Math.min(Math.max(Math.floor(dias) || 1, 1), TARIFAS_ANDAMIO[0].length);
    return TARIFAS_ANDAMIO[fila - 1][columna - 1];
  }

  function distanciaKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatoMXN(n) {
    return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
  }

  // Normaliza un teléfono mexicano capturado en el formulario (con espacios,
  // guiones, etc., con o sin lada de país) a formato E.164 (+52XXXXXXXXXX)
  // para las Conversiones mejoradas de Google Ads. Regresa null si no se
  // reconocen 10 dígitos locales válidos.
  function normalizarTelefonoE164(tel) {
    const digits = (tel || '').replace(/\D/g, '');
    if (digits.length === 10) return `+52${digits}`;
    if (digits.length === 12 && digits.startsWith('52')) return `+${digits}`;
    if (digits.length === 13 && digits.startsWith('521')) return `+${digits}`;
    return null;
  }

  // A feedback submission needs at least a rating or a comment.
  function validateFeedback({ rating, comentario }) {
    const hasRating = Number.isInteger(rating) && rating >= 1 && rating <= FEEDBACK_MAX_RATING;
    const hasComentario = !!(comentario && comentario.trim());
    if (!hasRating && !hasComentario) {
      return { valid: false, error: 'Agrega una calificación o un comentario antes de enviar.' };
    }
    return { valid: true, error: null };
  }

  function buildFeedbackMessage({ rating, comentario }) {
    const lines = ['Hola, quiero dejar una opinión sobre el servicio:'];
    const hasRating = Number.isInteger(rating) && rating >= 1 && rating <= FEEDBACK_MAX_RATING;
    if (hasRating) {
      const estrellas = '★'.repeat(rating) + '☆'.repeat(FEEDBACK_MAX_RATING - rating);
      lines.push(`• Calificación: ${estrellas} (${rating}/${FEEDBACK_MAX_RATING})`);
    }
    const comentarioLimpio = (comentario || '').trim();
    if (comentarioLimpio) lines.push(`• Comentario: ${comentarioLimpio}`);
    return lines.join('\n');
  }

  global.AR = {
    TARIFAS_ANDAMIO,
    TOLUCA_LAT,
    TOLUCA_LON,
    RADIO_ENTREGA_GRATIS_KM,
    FEEDBACK_MAX_RATING,
    precioAndamioPorDia,
    distanciaKm,
    formatoMXN,
    normalizarTelefonoE164,
    validateFeedback,
    buildFeedbackMessage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
