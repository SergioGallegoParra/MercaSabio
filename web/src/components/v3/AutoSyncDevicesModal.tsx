"use client";

import { useEffect, useRef, useState } from "react";

import HearthIcon from "@/components/HearthIcon";
import { useWorkspace } from "@/components/v3/WorkspaceContext";

export function AutoSyncDevicesModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    credentials,
    syncState,
    lastSyncedAt,
    devices,
    joinByHouseholdCode,
    removeDevice,
    refreshWorkspace,
  } = useWorkspace();

  const dialogRef = useRef<HTMLDialogElement>(null);
  const [joinInput, setJoinInput] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setStatusMessage(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const householdCode = credentials?.householdCode ?? "Generando...";
  const magicLink =
    typeof window !== "undefined" && credentials?.householdCode
      ? `${window.location.origin}/?hogar=${encodeURIComponent(credentials.householdCode)}`
      : "";

  async function handleCopyMagicLink() {
    if (!magicLink) return;
    try {
      await navigator.clipboard.writeText(magicLink);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2400);
    } catch {
      setStatusMessage(`Copia este enlace: ${magicLink}`);
    }
  }

  async function handleJoinCode(e: React.FormEvent) {
    e.preventDefault();
    const code = joinInput.trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    const res = await joinByHouseholdCode(code);
    setBusy(false);
    if (res.ok) {
      setJoinInput("");
      setStatusMessage("¡Dispositivo enlazado! A partir de ahora sincroniza automáticamente.");
    } else {
      setStatusMessage(res.error ?? "Código no encontrado.");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="hearth-dialog"
      aria-labelledby="autosync-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="hearth-sheet ms-v3-product-sheet">
        <div className="hearth-sheet-handle" aria-hidden="true" />
        <div className="hearth-sheet-header">
          <div>
            <span className="ms-v3-kicker-tag">Sincronización automática PC ↔ Celular</span>
            <h3 id="autosync-dialog-title" className="hearth-sheet-title">
              Dispositivos del hogar
            </h3>
            <p className="hearth-pref-line">
              Enlazas una sola vez sin crear cuenta ni escanear códigos QR en cada mercado
            </p>
          </div>
          <button
            type="button"
            className="hearth-sheet-close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <HearthIcon name="close" size={18} />
          </button>
        </div>

        <div className="hearth-sheet-body">
          {/* Código permanente del hogar */}
          <section className="ms-v3-household-code-card">
            <div className="ms-v3-row-between">
              <span className="hearth-label">Tu Código de Hogar permanente</span>
              <span className={`ms-v3-sync-pill ${syncState}`}>
                {syncState === "synced"
                  ? "● Sincronizado"
                  : syncState === "syncing"
                    ? "↻ Guardando"
                    : syncState === "offline"
                      ? "Sin red · Local"
                      : "Modo local"}
              </span>
            </div>
            <div className="ms-v3-code-display tabular">{householdCode}</div>
            <p className="hearth-pref-line">
              Abre el enlace en tu otro equipo o ingresa este código una sola vez. Toda tu canasta, candados, perfil e historial quedan sincronizados en vivo.
            </p>
            <div className="ms-v3-code-actions">
              <button
                type="button"
                className="hearth-btn-primary"
                onClick={() => void handleCopyMagicLink()}
                disabled={!magicLink}
              >
                <HearthIcon name="content_copy" size={15} />
                <span>{copiedLink ? "¡Enlace copiado!" : "Copiar enlace de conexión"}</span>
              </button>
              <button
                type="button"
                className="hearth-btn-secondary"
                onClick={() => void refreshWorkspace()}
              >
                <HearthIcon name="refresh" size={15} />
              </button>
            </div>
            {lastSyncedAt && (
              <div className="hearth-pref-line" style={{ fontSize: "0.7rem" }}>
                Última sincronización: {new Date(lastSyncedAt).toLocaleTimeString("es-CO")}
              </div>
            )}
          </section>

          {/* Conectar este navegador a otro hogar existente */}
          <form className="hearth-card ms-v3-join-form" onSubmit={(e) => void handleJoinCode(e)}>
            <label className="hearth-label" htmlFor="join-household-input">
              ¿Ya tienes un código en otro dispositivo? Conéctate aquí:
            </label>
            <div className="ms-v3-join-row">
              <input
                id="join-household-input"
                type="text"
                className="hearth-input tabular"
                placeholder="Ej: HOGAR-7K9P2M"
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value)}
              />
              <button
                type="submit"
                className="hearth-btn-secondary"
                disabled={busy || !joinInput.trim()}
              >
                {busy ? "Enlazando..." : "Unirme"}
              </button>
            </div>
          </form>

          {statusMessage && (
            <div className="hearth-info-banner">
              <HearthIcon name="check_circle" size={16} />
              <span>{statusMessage}</span>
            </div>
          )}

          {/* Lista de dispositivos conectados */}
          <section>
            <h4 className="hearth-label" style={{ marginBottom: 6 }}>
              Dispositivos activos ({Math.max(1, devices.length)})
            </h4>
            <div className="ms-v3-device-list">
              {devices.length === 0 ? (
                <div className="ms-v3-device-row">
                  <HearthIcon name="laptop" size={18} className="hearth-text-primary" />
                  <div style={{ flex: 1 }}>
                    <strong>{credentials?.deviceName ?? "Este navegador"}</strong>
                    <p className="hearth-pref-line">Dispositivo actual activo</p>
                  </div>
                </div>
              ) : (
                devices.map((dev) => {
                  const isCurrent = dev.deviceId === credentials?.deviceId;
                  return (
                    <div key={dev.deviceId} className="ms-v3-device-row">
                      <HearthIcon
                        name={dev.deviceKind === "mobile" ? "smartphone" : "laptop"}
                        size={18}
                        className="hearth-text-primary"
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong>
                          {dev.deviceName} {isCurrent ? "(Este dispositivo)" : ""}
                        </strong>
                        <p className="hearth-pref-line">
                          Visto: {new Date(dev.lastSeenAt).toLocaleString("es-CO")}
                        </p>
                      </div>
                      {!isCurrent && (
                        <button
                          type="button"
                          className="hearth-icon-btn danger"
                          aria-label={`Desvincular ${dev.deviceName}`}
                          onClick={() => void removeDevice(dev.deviceId)}
                        >
                          <HearthIcon name="delete" size={15} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>

        <div className="hearth-sheet-footer">
          <button type="button" className="hearth-btn-primary" onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </dialog>
  );
}
