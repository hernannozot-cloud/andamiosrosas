// Pure, DOM-free logic shared by script.js and the test suite in tests/.
// Exposed on a single global namespace (AR) so it can be loaded standalone
// by tests without needing the rest of the page.
(function (global) {
  const PRECIO_POR_DIA = 110; // tarifa por andamio/día a partir de 5 días
  const TARIFAS_ANDAMIO_CORTAS = { 1: 200, 2: 180, 3: 150, 4: 130 };
  const TOLUCA_LAT = 19.2926;
  const TOLUCA_LON = -99.6568;
  const RADIO_ENTREGA_GRATIS_KM = 20;
  const FEEDBACK_MAX_RATING = 5;

  // Precio por andamio/día según la duración total de la renta:
  // 1-4 días tienen tarifa escalonada más alta; 5+ días usan PRECIO_POR_DIA.
  function precioAndamioPorDia(dias) {
    return TARIFAS_ANDAMIO_CORTAS[dias] || PRECIO_POR_DIA;
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
    PRECIO_POR_DIA,
    TARIFAS_ANDAMIO_CORTAS,
    TOLUCA_LAT,
    TOLUCA_LON,
    RADIO_ENTREGA_GRATIS_KM,
    FEEDBACK_MAX_RATING,
    precioAndamioPorDia,
    distanciaKm,
    formatoMXN,
    validateFeedback,
    buildFeedbackMessage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
