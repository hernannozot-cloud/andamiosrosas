<?php
// Recibe los datos de los formularios de cotización del sitio y los manda por correo,
// para no perder al prospecto si no termina de enviar el mensaje en WhatsApp.
// Antes de subirlo: cambia DESTINO por el correo donde quieres recibir los avisos.
declare(strict_types=1);

const DESTINO = 'CAMBIA-ESTE-CORREO@ejemplo.com';     // dónde llegan los avisos
const REMITENTE = 'avisos@andamiosrosas.com';         // debe ser una cuenta de tu propio dominio
const DOMINIO = 'andamiosrosas.com';                  // solo se aceptan envíos desde este sitio
const MAX_POR_VENTANA = 5;                            // envíos permitidos por IP...
const VENTANA_SEGUNDOS = 600;                         // ...cada 10 minutos

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function responder(int $codigo, array $datos) {
    http_response_code($codigo);
    echo json_encode($datos, JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') responder(405, ['ok' => false]);

// Solo desde el propio sitio (bloquea formularios de otros dominios)
$origen = $_SERVER['HTTP_ORIGIN'] ?? ($_SERVER['HTTP_REFERER'] ?? '');
$host = strtolower((string) parse_url($origen, PHP_URL_HOST));
// ("localhost" es la app del celular, que carga el sitio desde el propio aparato)
if ($host !== DOMINIO && $host !== 'www.' . DOMINIO && $host !== 'localhost') responder(403, ['ok' => false]);

$crudo = file_get_contents('php://input', false, null, 0, 6000);
$d = json_decode($crudo ?: '', true);
if (!is_array($d)) responder(400, ['ok' => false]);

// Campo trampa: las personas no lo ven ni lo llenan; los robots sí
if (!empty($d['sitio_web'])) responder(200, ['ok' => true]);

// Límite de envíos por IP
$ip = $_SERVER['REMOTE_ADDR'] ?? 'desconocida';
$archivo = sys_get_temp_dir() . '/lead-' . md5($ip) . '.json';
$ahora = time();
$marcas = [];
if (is_file($archivo)) {
    $previas = json_decode((string) @file_get_contents($archivo), true);
    if (is_array($previas)) $marcas = array_values(array_filter($previas, fn($t) => is_int($t) && $t > $ahora - VENTANA_SEGUNDOS));
}
if (count($marcas) >= MAX_POR_VENTANA) responder(429, ['ok' => false]);
$marcas[] = $ahora;
@file_put_contents($archivo, json_encode($marcas), LOCK_EX);

function limpiar($v, int $max): string {
    $s = is_string($v) ? $v : '';
    $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', $s) ?? '';
    return trim(mb_substr($s, 0, $max));
}

$nombre = limpiar($d['nombre'] ?? '', 80);
$telefono = limpiar($d['telefono'] ?? '', 30);
$tipo = limpiar($d['tipo'] ?? 'cotización', 40);
$mensaje = limpiar($d['mensaje'] ?? '', 1500);
$origenAds = limpiar($d['origen'] ?? '', 60);
$pagina = limpiar($d['pagina'] ?? '', 120);

$digitos = preg_replace('/\D+/', '', $telefono) ?? '';
if ($nombre === '' || strlen($digitos) < 8 || strlen($digitos) > 15) responder(422, ['ok' => false]);

// El asunto no puede llevar saltos de línea (evita inyección de encabezados)
$nombreAsunto = preg_replace('/[\r\n]+/', ' ', $nombre) ?? '';
$asunto = mb_encode_mimeheader("Nuevo prospecto web: {$nombreAsunto}", 'UTF-8');

$lineas = ["Llegó una solicitud desde el sitio web ({$tipo}).", '', "Nombre: {$nombre}", "Teléfono: {$telefono}"];
if ($origenAds !== '') $lineas[] = "Origen: {$origenAds}";
if ($pagina !== '') $lineas[] = "Página: {$pagina}";
if ($mensaje !== '') { $lineas[] = ''; $lineas[] = "Mensaje:\n{$mensaje}"; }
$lineas[] = '';
$lineas[] = 'Si no te escribió por WhatsApp, llámale o mándale un mensaje a este teléfono.';
$cuerpo = implode("\n", $lineas);

$encabezados = implode("\r\n", [
    'From: Andamios Rosas <' . REMITENTE . '>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'X-Mailer: andamiosrosas-lead',
]);

$enviado = @mail(DESTINO, $asunto, $cuerpo, $encabezados, '-f' . REMITENTE);
responder($enviado ? 200 : 500, ['ok' => $enviado]);
