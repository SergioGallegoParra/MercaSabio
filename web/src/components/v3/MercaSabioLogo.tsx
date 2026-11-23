"use client";

import React from "react";

interface IconProps {
  className?: string;
  size?: number;
}

const OWL_PATHS = (
  <>
    <path
      d="M54.7 16.2L67.3 16.7L78.9 22.0L87.8 31.0L90.7 36.3L93.4 44.3L96.3 43.3L100.6 39.9L102.1 39.9L103.8 41.6L103.8 50.3L100.4 56.6L94.1 89.5L90.7 95.8L87.1 99.4L81.3 102.8L74.0 104.2L45.5 104.2L39.7 103.3L32.9 99.9L28.3 95.3L24.5 87.1L19.1 56.6L15.8 49.8L15.8 42.1L17.9 39.9L22.8 43.3L26.2 44.3L30.7 32.4L38.7 23.5L45.5 19.1Z M55.2 22.0L44.5 26.4L37.5 32.9L34.1 38.7L32.7 43.1L32.9 45.3L52.3 45.3L60.0 48.2L67.3 45.3L86.8 45.0L86.4 41.1L83.9 35.8L75.0 26.4L64.4 22.0Z"
      fill="#FAF4EB"
    />
    <path
      d="M32.9 44.8L51.1 45.0L32.9 44.8Z M68.7 44.8L86.8 45.0L68.7 44.8Z M23.7 57.8L29.8 59.0L28.8 61.9L28.8 68.2L29.8 71.1L33.4 76.2L36.8 79.1L37.8 78.6L37.8 79.6L39.9 80.3L40.4 81.8L39.7 82.5L28.1 80.1L27.4 79.3L23.5 60.0Z M95.3 57.8L96.0 59.0L92.2 79.3L91.4 80.1L85.1 81.0L81.8 82.5L80.8 82.0L78.9 83.0L78.1 81.8L78.6 81.3L77.2 80.8L78.9 80.5L78.4 79.6L80.8 80.1L82.0 79.3L81.8 78.6L82.7 79.1L87.3 75.0L89.7 70.6L90.7 67.3L90.7 62.9L89.3 59.0Z"
      fill="#CDE4D3"
    />
    <path
      d="M100.1 45.3L100.9 45.5L100.4 48.9L97.2 53.0L93.8 54.4L89.7 54.7L93.4 48.6L95.8 48.2Z M18.9 45.7L23.3 48.2L25.7 48.6L29.8 54.7L25.2 54.4L21.8 52.5L19.1 48.9Z M86.1 48.6L90.2 48.9L86.1 51.1L73.1 51.5L68.2 53.5L63.6 58.1L61.5 63.1L57.6 63.1L55.9 58.1L49.4 52.5L46.5 51.5L34.9 51.5L30.3 49.4L50.8 49.1L56.1 51.1L59.5 54.0L62.9 51.1L68.2 49.1Z M28.6 83.9L34.9 85.4L41.6 89.3L46.2 94.8L48.2 99.6L40.7 99.4L33.4 95.5L29.8 90.5Z M89.5 83.9L90.7 84.2L90.7 86.1L89.3 90.9L84.7 96.5L76.4 99.9L71.4 99.6L73.3 94.3L78.4 88.8L84.7 85.4Z M53.2 99.9L66.5 100.1L53.2 99.9Z M45.5 103.8L74.3 104.0L45.5 103.8Z"
      fill="#3B5D44"
    />
    <path
      d="M56.1 16.2L63.4 16.2L68.2 17.2L73.5 19.1L79.8 23.0L84.9 27.6L88.8 32.9L93.4 44.8L96.7 43.3L100.6 40.4L102.5 40.4L103.8 42.6L103.8 49.4L102.3 53.2L100.4 55.6L94.6 87.1L93.1 91.4L91.2 94.8L86.1 99.9L78.9 103.3L76.4 103.8L43.1 103.8L38.7 102.8L33.9 100.4L29.3 96.3L26.9 92.9L24.9 88.0L19.1 55.2L17.7 53.7L15.8 48.9L16.2 41.6L17.5 40.4L18.9 40.4L23.3 43.8L26.2 44.8L28.3 37.8L30.7 32.9L37.8 24.5L46.0 19.1Z M56.6 21.6L48.4 24.0L41.6 28.3L35.6 35.3L33.2 40.7L32.4 45.3L50.3 45.3L55.2 46.2L59.5 48.6L63.9 46.2L69.2 45.3L87.3 45.0L85.9 39.2L83.9 35.3L81.0 31.5L76.0 26.9L67.3 22.5L62.9 21.6Z M100.1 45.3L98.7 46.7L93.4 48.6L89.7 54.7L93.8 54.4L97.2 53.0L100.4 48.9L100.9 45.5Z M18.9 45.7L19.1 48.9L21.8 52.5L25.2 54.4L29.8 54.7L25.7 48.6L23.3 48.2Z M86.1 48.6L85.6 49.1L68.2 49.1L62.9 51.1L59.5 54.0L56.1 51.1L50.8 49.1L30.3 49.4L34.9 51.5L46.5 51.5L49.4 52.5L51.8 54.0L55.9 58.1L57.6 63.1L61.5 63.1L63.6 58.1L68.2 53.5L73.1 51.5L86.1 51.1L90.2 48.9Z M41.1 54.9L37.3 56.4L34.1 59.5L32.7 62.9L32.7 67.7L34.1 71.1L37.3 74.3L40.2 75.7L44.0 76.2L48.4 74.7L51.1 72.6L53.5 67.7L53.5 63.4L52.5 60.5L49.4 56.9L44.5 54.9Z M75.0 54.9L70.6 56.4L67.0 60.0L65.6 66.3L67.5 71.6L70.2 74.3L73.1 75.7L77.4 76.2L80.8 75.2L85.4 71.1L86.8 67.7L86.8 63.4L85.4 60.0L82.2 56.9L79.3 55.4Z M23.3 57.3L23.0 59.5L26.9 79.3L28.1 80.5L30.5 80.5L37.8 82.5L42.6 85.4L48.2 90.9L51.5 96.7L52.0 99.2L53.2 100.4L66.3 100.4L69.4 93.4L75.5 86.4L81.8 82.5L89.0 80.5L91.4 80.5L92.6 78.9L96.5 58.5L96.3 57.3L93.4 58.3L88.8 58.5L90.2 62.4L90.2 68.2L89.3 71.1L87.3 74.5L84.7 77.2L80.8 79.1L74.0 79.6L68.7 77.6L65.1 74.5L63.1 71.6L62.2 67.3L60.0 66.0L57.6 66.0L55.4 72.6L51.3 77.2L45.5 79.6L40.7 79.6L34.4 76.7L32.2 74.5L29.8 70.2L29.3 61.5L30.3 58.5L26.2 58.3Z M43.1 60.2L44.5 60.2L45.3 61.0L44.3 61.9L45.0 64.6L46.9 65.1L48.6 63.9L48.6 67.7L46.9 69.9L44.5 70.9L40.7 69.9L38.5 66.3L39.5 62.4Z M73.5 60.7L77.2 61.0L76.2 61.9L76.2 63.9L77.4 65.1L80.5 64.4L80.5 66.8L79.6 68.7L76.0 70.9L73.1 70.4L70.4 67.3L70.4 63.9Z M28.6 83.9L29.8 90.5L33.4 95.5L40.7 99.4L48.2 99.6L46.2 94.8L41.6 89.3L34.9 85.4Z M89.5 83.9L84.7 85.4L78.4 88.8L73.3 94.3L71.4 99.6L76.4 99.9L81.3 98.4L84.7 96.5L89.3 90.9L90.7 86.1L90.7 84.2Z"
      fill="#1D402E"
      fillRule="evenodd"
    />
    <path
      d="M59.5 28.8L62.4 33.2L65.6 34.4L64.8 35.1L62.9 35.6L60.7 37.8L59.5 40.4L57.3 36.3L54.0 34.9L54.2 34.1L55.2 34.1L57.8 32.4Z M59.5 72.8L62.4 74.3L64.6 76.4L60.7 83.2L59.5 83.9L54.9 77.4L54.9 76.0L56.1 74.7Z"
      fill="#DEAD55"
    />
  </>
);

export function MercaSabioIsotipo({ size = 38, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="MercaSabio Isotipo"
    >
      <circle cx="60" cy="60" r="57" fill="#FAF4EB" stroke="#D5CEC2" strokeWidth="2.5" />
      {OWL_PATHS}
    </svg>
  );
}

export function MercaSabioAppIcon({ size = 40, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="MercaSabio App Icon"
    >
      <rect x="5" y="5" width="110" height="110" rx="27" fill="#FAF4EB" stroke="#1D402E" strokeWidth="6.5" />
      <g transform="translate(8,8) scale(0.867)">{OWL_PATHS}</g>
    </svg>
  );
}

export function MercaSabioMascot({ size = 36, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="13 13 94 94"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="MercaSabio Búho-Canasta"
    >
      {OWL_PATHS}
    </svg>
  );
}

function MercaSabioSparks() {
  return (
    <svg
      className="ms-logo-sparks"
      width={16}
      height={14}
      viewBox="0 0 22 20"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="4.5" cy="14" r="2.7" fill="#DEAD55" />
      <line x1="4.5" y1="8.2" x2="4.5" y2="2" stroke="#DEAD55" strokeWidth="2.6" strokeLinecap="round" />
      <line x1="9" y1="9.5" x2="13.5" y2="4.2" stroke="#DEAD55" strokeWidth="2.6" strokeLinecap="round" />
      <line x1="10.5" y1="13" x2="17" y2="11" stroke="#DEAD55" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function MercaSabioLogotipo({
  variant = "claro",
  compact = false,
  className = "",
}: {
  variant?: "claro" | "invertido";
  compact?: boolean;
  className?: string;
}) {
  const isInvertido = variant === "invertido";
  return (
    <div className={`ms-logo-lockup ${isInvertido ? "invertido" : "claro"} ${compact ? "compact" : ""} ${className}`}>
      <div className="ms-logo-mascot-box">
        <MercaSabioMascot size={compact ? 30 : 38} />
      </div>
      <div className="ms-logo-wordmark-col">
        <div className="ms-logo-wordmark hearth-headline">
          <span className={isInvertido ? "ms-word-merca-inv" : "ms-word-merca"}>Merca</span>
          <span className={isInvertido ? "ms-word-sabio-inv" : "ms-word-sabio"}>
            Sab
            <span className="ms-word-dotless-i">
              &#305;
              <MercaSabioSparks />
            </span>
            o
          </span>
        </div>
        {!compact && (
          <span className={`ms-logo-sub ${isInvertido ? "inv" : ""}`}>
            COMPARADOR INTELIGENTE
          </span>
        )}
      </div>
    </div>
  );
}
