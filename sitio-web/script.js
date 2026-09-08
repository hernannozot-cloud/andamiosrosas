const WHATSAPP_NUMBER = '525539481162';
const DIAS_MINIMOS = 1;
const { TOLUCA_LAT, TOLUCA_LON, RADIO_ENTREGA_GRATIS_KM, precioAndamioPorDia, distanciaKm, formatoMXN } = AR;

// Zonas mas alejadas: por costo/logistica de entrega se maneja un minimo de
// dias de renta mas alto que el general (DIAS_MINIMOS).
const ZONAS_MINIMO_EXTENDIDO = [
  { nombre: 'Valle de Bravo', dias: 7 },
  { nombre: 'Ixtapan de la Sal', dias: 7 },
];

function normalizarTexto(texto) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// Si el texto de la zona coincide con una zona de minimo extendido, regresa
// esos dias minimos; si no, regresa el minimo general del sitio.
function getDiasMinimos(zonaTexto) {
  const zonaNormalizada = normalizarTexto(zonaTexto);
  const especial = ZONAS_MINIMO_EXTENDIDO.find(z => zonaNormalizada.includes(normalizarTexto(z.nombre)));
  return especial ? especial.dias : DIAS_MINIMOS;
}

// Dentro de la app nativa (Capacitor) los enlaces externos deben abrirse con el
// plugin Browser para que el handoff a WhatsApp funcione; en el sitio web normal
// se sigue usando window.open tal cual.
function abrirEnlaceExterno(url) {
  const capacitor = window.Capacitor;
  if (capacitor && capacitor.isNativePlatform && capacitor.isNativePlatform()) {
    capacitor.Plugins.Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

document.getElementById('year').textContent = new Date().getFullYear();

// Mobile nav toggle
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');
navToggle.addEventListener('click', () => {
  navLinks.classList.toggle('open');
});
navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => navLinks.classList.remove('open'));
});

// Quote form -> live price + build WhatsApp message
const form = document.getElementById('quoteForm');
const toast = document.getElementById('toast');
const quoteTotalBox = document.getElementById('quoteTotal');
const quoteTotalAmount = document.getElementById('quoteTotalAmount');
const quoteTotalDetail = document.getElementById('quoteTotalDetail');
const quoteTotalDelivery = document.getElementById('quoteTotalDelivery');
const quoteTotalAccesorios = document.getElementById('quoteTotalAccesorios');
const qtyInputs = [...document.querySelectorAll('.andamio-qty')];
const accesorioInputs = [...document.querySelectorAll('.accesorio-qty')];
let zonaCoords = null;

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

function getSeleccion() {
  return qtyInputs
    .map(input => ({ tipo: input.dataset.tipo, cantidad: parseInt(input.value, 10) || 0 }))
    .filter(item => item.cantidad > 0);
}

function getSeleccionAccesorios() {
  return accesorioInputs
    .map(input => ({
      tipo: input.dataset.tipo,
      cantidad: parseInt(input.value, 10) || 0,
      precio: parseFloat(input.dataset.precio),
    }))
    .filter(item => item.cantidad > 0);
}

// Quantity steppers
document.querySelectorAll('.qty-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    let val = parseInt(input.value, 10) || 0;
    val = btn.dataset.action === 'inc' ? val + 1 : Math.max(0, val - 1);
    input.value = val;
    input.closest('.andamio-pick-card').classList.toggle('is-selected', val > 0);
    calcularTotal();
  });
});

function calcularTotal() {
  const seleccion = getSeleccion();
  const totalCantidad = seleccion.reduce((sum, item) => sum + item.cantidad, 0);
  const dias = parseInt(form.dias.value, 10);
  const zona = zonaInput.value.trim();
  const diasMinimos = getDiasMinimos(zona);
  form.dias.min = diasMinimos;

  if (!totalCantidad || !dias || dias < diasMinimos || !zona) {
    quoteTotalBox.hidden = true;
    return null;
  }

  const accesorios = getSeleccionAccesorios();
  const precioAndamio = precioAndamioPorDia(dias);
  const totalAndamios = precioAndamio * totalCantidad * dias;
  const totalAccesorios = accesorios.reduce((sum, a) => sum + a.precio * a.cantidad * dias, 0);
  const total = totalAndamios + totalAccesorios;

  quoteTotalAmount.textContent = formatoMXN(total);
  quoteTotalDetail.textContent = `${formatoMXN(precioAndamio)}/día × ${totalCantidad} andamio${totalCantidad > 1 ? 's' : ''} × ${dias} día${dias > 1 ? 's' : ''}`;

  if (accesorios.length) {
    const partes = accesorios.map(a => `${a.tipo}: ${formatoMXN(a.precio)}/día × ${a.cantidad}`);
    quoteTotalAccesorios.textContent = `+ ${partes.join(' · ')}`;
    quoteTotalAccesorios.hidden = false;
  } else {
    quoteTotalAccesorios.hidden = true;
  }

  let dentroDeZona = false;
  if (zonaCoords) {
    const dist = distanciaKm(TOLUCA_LAT, TOLUCA_LON, zonaCoords.lat, zonaCoords.lon);
    dentroDeZona = dist <= RADIO_ENTREGA_GRATIS_KM;
  }

  if (dentroDeZona) {
    quoteTotalDelivery.textContent = '¡Entrega y Recolección gratis!';
    quoteTotalDelivery.classList.add('is-free');
  } else if (diasMinimos > DIAS_MINIMOS) {
    quoteTotalDelivery.textContent = `Por la distancia, en esta zona la renta mínima es de ${diasMinimos} días. Te contactaremos para darte el precio del transporte.`;
    quoteTotalDelivery.classList.remove('is-free');
  } else {
    quoteTotalDelivery.textContent = 'Te contactaremos de inmediato para darte el precio del servicio de transporte.';
    quoteTotalDelivery.classList.remove('is-free');
  }

  quoteTotalBox.hidden = false;
  return total;
}

form.dias.addEventListener('input', calcularTotal);

// Address autocomplete using OpenStreetMap (Nominatim) — free, no API key
const zonaInput = document.getElementById('zona');
const zonaSuggestions = document.getElementById('zonaSuggestions');
let zonaDebounce = null;
let zonaAbortController = null;

function hideZonaSuggestions() {
  zonaSuggestions.hidden = true;
  zonaSuggestions.innerHTML = '';
}

function renderZonaSuggestions(results) {
  zonaSuggestions.innerHTML = '';
  if (!results.length) {
    hideZonaSuggestions();
    return;
  }
  results.forEach(place => {
    const li = document.createElement('li');
    li.textContent = place.display_name;
    li.addEventListener('click', () => {
      zonaInput.value = place.display_name;
      zonaCoords = { lat: parseFloat(place.lat), lon: parseFloat(place.lon) };
      hideZonaSuggestions();

      const diasMinimosZona = getDiasMinimos(place.display_name);
      const diasActuales = parseInt(form.dias.value, 10) || 0;
      if (diasMinimosZona > DIAS_MINIMOS && diasActuales < diasMinimosZona) {
        form.dias.value = diasMinimosZona;
        showToast(`Por la distancia de entrega, la renta mínima para esta zona es de ${diasMinimosZona} días. Ajustamos los días de tu cotización.`);
      }

      calcularTotal();
    });
    zonaSuggestions.appendChild(li);
  });
  zonaSuggestions.hidden = false;
}

zonaInput.addEventListener('input', () => {
  const query = zonaInput.value.trim();
  clearTimeout(zonaDebounce);
  zonaCoords = null;
  calcularTotal();

  if (query.length < 4) {
    hideZonaSuggestions();
    return;
  }

  zonaDebounce = setTimeout(async () => {
    if (zonaAbortController) zonaAbortController.abort();
    zonaAbortController = new AbortController();

    // Soft bias toward Estado de México + CDMX (viewbox) without excluding matches elsewhere (bounded=0)
    const viewbox = '-100.60,20.29,-98.85,18.35';
    const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=mx&limit=5&addressdetails=0&accept-language=es&viewbox=${viewbox}&bounded=0&q=${encodeURIComponent(query)}`;

    try {
      const res = await fetch(url, { signal: zonaAbortController.signal });
      const data = await res.json();
      renderZonaSuggestions(data);
    } catch (err) {
      if (err.name !== 'AbortError') hideZonaSuggestions();
    }
  }, 450);
});

document.addEventListener('click', (e) => {
  if (!zonaInput.contains(e.target) && !zonaSuggestions.contains(e.target)) {
    hideZonaSuggestions();
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();

  const seleccion = getSeleccion();
  const dias = form.dias.value.trim();
  const zona = form.zona.value.trim();
  const nombre = form.nombre.value.trim();
  const telefono = form.telefono.value.trim();
  const comentarios = form.comentarios.value.trim();

  if (!nombre || !telefono || !seleccion.length) {
    showToast('Por favor completa nombre, teléfono y al menos un tipo de andamio.');
    return;
  }

  const diasMinimos = getDiasMinimos(zona);
  if (!dias || parseInt(dias, 10) < diasMinimos) {
    showToast(
      diasMinimos > DIAS_MINIMOS
        ? `Para esta zona la renta mínima es de ${diasMinimos} días. Ajusta los días para continuar.`
        : 'Indica cuántos días necesitas la renta.'
    );
    return;
  }

  const total = calcularTotal();
  const accesorios = getSeleccionAccesorios();

  const lines = ['Hola, quiero cotizar una renta de andamios:'];
  seleccion.forEach(item => lines.push(`• ${item.tipo}: ${item.cantidad}`));
  accesorios.forEach(item => lines.push(`• ${item.tipo}: ${item.cantidad}`));
  if (dias) lines.push(`• Días de renta: ${dias}`);
  if (zona) lines.push(`• Dirección: ${zona}`);
  if (total) {
    lines.push(`• Total estimado: ${formatoMXN(total)}`);
    lines.push(`• ${quoteTotalDelivery.textContent}`);
  }
  lines.push(`• Nombre: ${nombre}`);
  lines.push(`• Teléfono: ${telefono}`);
  if (comentarios) lines.push(`• Comentarios: ${comentarios}`);

  const message = encodeURIComponent(lines.join('\n'));
  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${message}`;

  // Google Ads: conversion "Solicitar cotizacion"
  if (typeof gtag === 'function') {
    gtag('event', 'conversion', {
      'send_to': 'AW-18382347257/fW7PCKnJ6e0cEPm3sb1E',
      'value': 1.0,
      'currency': 'MXN',
    });
  }

  abrirEnlaceExterno(url);
});

// Product photo lightbox
const lightboxOverlay = document.getElementById('lightboxOverlay');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxClose = document.getElementById('lightboxClose');

function openLightbox(src, alt) {
  lightboxImg.src = src;
  lightboxImg.alt = alt || '';
  lightboxOverlay.hidden = false;
  document.body.classList.add('modal-open');
}

function closeLightbox() {
  lightboxOverlay.hidden = true;
  document.body.classList.remove('modal-open');
  lightboxImg.src = '';
}

document.querySelectorAll('.card-photo, .andamio-pick-card img').forEach(img => {
  img.addEventListener('click', () => openLightbox(img.getAttribute('src'), img.getAttribute('alt')));
});

lightboxClose.addEventListener('click', closeLightbox);
lightboxOverlay.addEventListener('click', (e) => {
  if (e.target === lightboxOverlay) closeLightbox();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !lightboxOverlay.hidden) closeLightbox();
});

// Feedback modal
const feedbackFloat = document.getElementById('feedbackFloat');
const feedbackOverlay = document.getElementById('feedbackOverlay');
const feedbackForm = document.getElementById('feedbackForm');
const feedbackClose = document.getElementById('feedbackClose');
const feedbackCancel = document.getElementById('feedbackCancel');
const feedbackComentario = document.getElementById('feedbackComentario');
const starButtons = [...document.querySelectorAll('.star-btn')];
let feedbackRating = 0;

function renderStars() {
  starButtons.forEach(btn => {
    const val = parseInt(btn.dataset.value, 10);
    btn.classList.toggle('is-active', val <= feedbackRating);
    btn.setAttribute('aria-pressed', val <= feedbackRating ? 'true' : 'false');
  });
}

function openFeedbackModal() {
  feedbackOverlay.hidden = false;
  document.body.classList.add('modal-open');
}

function closeFeedbackModal() {
  feedbackOverlay.hidden = true;
  document.body.classList.remove('modal-open');
  feedbackForm.reset();
  feedbackRating = 0;
  renderStars();
}

feedbackFloat.addEventListener('click', openFeedbackModal);
feedbackClose.addEventListener('click', closeFeedbackModal);
feedbackCancel.addEventListener('click', closeFeedbackModal);

feedbackOverlay.addEventListener('click', (e) => {
  if (e.target === feedbackOverlay) closeFeedbackModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !feedbackOverlay.hidden) closeFeedbackModal();
});

starButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    feedbackRating = parseInt(btn.dataset.value, 10);
    renderStars();
  });
});

feedbackForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const comentario = feedbackComentario.value;
  const { valid, error } = AR.validateFeedback({ rating: feedbackRating, comentario });
  if (!valid) {
    showToast(error);
    return;
  }

  const message = encodeURIComponent(AR.buildFeedbackMessage({ rating: feedbackRating, comentario }));
  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${message}`;
  abrirEnlaceExterno(url);
  closeFeedbackModal();
});
