import type { CheckId, CheckResult, VerifyReport } from '@peaceos/core';

export const CHECK_COPY: Record<
  CheckId,
  {
    name: string;
    what: string;
    why: string;
    ok?: string;
    fail?: string;
    notDetermined?: string;
  }
> = {
  integrity: {
    name: 'Archivos íntegros',
    what: 'Comprueba que ningún archivo del paquete se ha modificado desde que se creó.',
    why: 'Si alguien hubiera cambiado una foto, un vídeo o un testimonio, esta comprobación lo detectaría.',
    ok: 'Todos los archivos están intactos.',
    fail: 'Al menos un archivo ha sido modificado.',
    notDetermined: 'No se pudo comprobar si los archivos están intactos.',
  },
  field_signature: {
    name: 'Firma de origen',
    what: 'Comprueba que el paquete lo firmó el dispositivo que documentó la evidencia y que esa firma es auténtica.',
    why: 'Garantiza que la evidencia viene de quien dice, sin que nadie haya podido suplantar su firma.',
    ok: 'La firma de origen es válida.',
    fail: 'La firma de origen no es válida o la clave no coincide.',
    notDetermined: 'No se pudo comprobar la firma de origen.',
  },
  org_countersignature: {
    name: 'Sello de la organización',
    what: 'Comprueba que la organización responsable ha respaldado el paquete con su propia firma.',
    why: 'Es la organización, con su reputación, la que avala esta evidencia.',
    ok: 'La organización ha sellado este paquete.',
    fail: 'No se pudo validar el sello de la organización.',
    notDetermined: 'No se puede comprobar sin la carpeta de organizaciones de confianza.',
  },
  org_identity: {
    name: 'Organización verificada',
    what: 'Comprueba que la organización que firma está en el registro público de confianza y es quien dice ser.',
    why: 'Confirma que detrás de la evidencia hay una organización identificable y verificable, no un anónimo.',
    ok: 'La organización está en el registro de confianza.',
    fail: 'La organización no aparece en el registro de confianza aportado.',
    notDetermined: 'Falta la carpeta de organizaciones de confianza para comprobarlo.',
  },
  timestamp: {
    name: 'Fecha y hora',
    what: 'Comprueba que existe una prueba de cuándo se creó el paquete, ligada a su contenido.',
    why: 'Impide fingir que algo se documentó antes o después de lo que realmente ocurrió.',
    ok: 'Hay una prueba de la fecha, ligada a este paquete. La confirmación definitiva en la red pública se comprueba aparte y aquí todavía no se ha confirmado.',
    fail: 'La prueba de fecha no corresponde a este paquete.',
    notDetermined: 'No se pudo comprobar la prueba de fecha.',
  },
  package_id: {
    name: 'Identificador correcto',
    what: 'Comprueba que el identificador del paquete corresponde exactamente a su contenido.',
    why: 'Un identificador que no cuadra sería señal de que el paquete se ha alterado o mezclado.',
    ok: 'El identificador corresponde al contenido.',
    fail: 'El identificador no corresponde al contenido.',
    notDetermined: 'No se pudo comprobar el identificador del paquete.',
  },
  custody: {
    name: 'Cadena de custodia',
    what: 'Comprueba que queda registrado quién manejó la evidencia y en qué orden, sin saltos.',
    why: 'Muestra el recorrido de la evidencia desde que se capturó, algo clave para que un tribunal la tome en serio.',
    ok: 'El recorrido está firmado, en orden y empieza en la captura.',
    fail: 'La cadena de custodia tiene un problema de orden, firma o inicio.',
    notDetermined: 'No se pudo comprobar la cadena de custodia.',
  },
  redactions: {
    name: 'Datos sensibles protegidos',
    what: 'Comprueba que los datos delicados están ocultos, pero comprometidos.',
    why: 'Permite proteger a las personas ahora y, aun así, demostrar esos datos ante un juez más adelante sin exponerlos aquí.',
    ok: 'Los datos sensibles están protegidos y siguen siendo demostrables.',
    fail: 'Un dato protegido no cuadra con su compromiso.',
    notDetermined: 'No se pudo comprobar la protección de datos sensibles.',
  },
};

export function getStatusLabel(check: CheckResult): 'Correcto' | 'Problema' | 'Sin comprobar' | 'Sin confirmar' {
  if (check.id === 'timestamp' && check.status === 'ok') return 'Sin confirmar';
  if (check.status === 'ok') return 'Correcto';
  if (check.status === 'fail') return 'Problema';
  return 'Sin comprobar';
}

export function getStatusDescription(check: CheckResult): string {
  if (check.id === 'timestamp' && check.status === 'ok') return 'Fecha ligada al paquete, pendiente de confirmación pública';
  if (check.status === 'ok') return 'Comprobado correctamente';
  if (check.status === 'fail') return 'Se comprobó y falló';
  return 'No se pudo comprobar';
}

export function getCheckCopy(check: CheckResult) {
  const copy = CHECK_COPY[check.id];
  if (check.id === 'custody' && check.status === 'ok' && /no custody events present/i.test(check.message)) {
    return { ...copy, result: 'Este paquete no incluye cadena de custodia.' };
  }
  if (check.id === 'redactions' && check.status === 'ok' && /no redactions present/i.test(check.message)) {
    return { ...copy, result: 'Este paquete no oculta ningún dato.' };
  }
  if (check.status === 'ok') return { ...copy, result: copy.ok ?? 'Comprobación correcta.' };
  if (check.status === 'fail') return { ...copy, result: copy.fail ?? 'La comprobación ha fallado.' };
  return { ...copy, result: copy.notDetermined ?? 'No se pudo completar esta comprobación.' };
}

export function getVerdictCopy(report: VerifyReport) {
  if (report.verdict === 'authentic') {
    return {
      tone: 'success' as const,
      title: 'Evidencia auténtica',
      text: 'Esta evidencia es genuina y no ha sido manipulada.',
    };
  }

  const hasFail = report.checks.some((check) => check.status === 'fail');
  if (!hasFail && report.checks.some((check) => check.status === 'not_determined')) {
    return {
      tone: 'warning' as const,
      title: 'Verificación incompleta',
      text: 'Falta información para terminar de comprobarlo (por ejemplo, la carpeta de organizaciones de confianza). Esto no significa que la evidencia sea falsa: significa que aún no se ha podido comprobar del todo.',
    };
  }

  return {
    tone: 'error' as const,
    title: 'Se han detectado problemas',
    text: 'No podemos confirmar que esta evidencia sea auténtica. Revisa las comprobaciones marcadas en rojo.',
  };
}
