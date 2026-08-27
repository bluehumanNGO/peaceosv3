# PeaceOS · Fase 1 — Verify y el Paquete Verificable
### Especificación y plan de construcción del MVP

> Documento técnico, pero con una frase llana al inicio de cada sección para que también lo siga quien no programa.

> **Nota (desde M0):** este documento es el origen narrativo de la especificación,
> pero **`spec/` es ahora la fuente de verdad del formato** —
> [`spec/manifest.schema.json`](../spec/manifest.schema.json) para la forma del
> manifiesto y [`spec/CRYPTO_CONTRACT.md`](../spec/CRYPTO_CONTRACT.md) para los
> bytes exactos que se canonicalizan, hashean, firman y sellan. El manifiesto de
> ejemplo de la sección 2, más abajo, es **ilustrativo** y puede estar desfasado
> respecto al schema (p. ej. ya no refleja `public_key_ref`/`public_key_sha256`
> ni el formato final del compromiso de redacción). Ante cualquier discrepancia,
> gana `spec/`.

---

## 1. Qué construimos en la Fase 1

*En llano: un "sobre sellado" para evidencia y una herramienta para comprobar que el sello está intacto.*

Dos cosas, y solo dos:

1. **El Paquete Verificable (VEP):** un formato abierto que empaqueta una o varias evidencias junto con las pruebas criptográficas de que son auténticas, de cuándo existieron y de que no se han alterado.
2. **Verify:** la herramienta que, dado un VEP, comprueba todo eso y emite un veredicto claro —sin que el que comprueba tenga que fiarse de Blue Human ni de nadie.

**Qué promesa cumple esta fase.** Cumple la promesa 2 (*la verdad se puede demostrar*). La promesa 1 (*documentar no expone a nadie*) se cumple del todo con Capture y Núcleo, pero el VEP ya incorpora **redacción**, que es el primer ladrillo de esa protección.

**Por qué empezamos aquí.** Es lo más diferencial, lo más barato de arrancar, lo que da prestigio ante tribunales y mecanismos, y lo único que aporta valor desde el día uno: puede verificar evidencia recogida con *cualquier* herramienta, no solo la nuestra.

## 2. El Paquete Verificable (VEP)

*En llano: una carpeta que contiene la evidencia y sus "sellos".*

### Estructura

```
caso-x.vep/                 (un contenedor, p. ej. un .zip)
├── manifest.json           el corazón: describe todo y lo enlaza por su huella
├── assets/                 los archivos de evidencia (o ausentes si se redactan)
│   └── testimonio_01.mp4
├── signatures/             firmas separadas del manifiesto y de cada evento
│   ├── manifest.sig        firma seudónima de terreno
│   ├── captured-01.sig
│   └── org-countersign.sig el sello de la organización (raíz de confianza)
├── timestamps/             pruebas de sello de tiempo
│   └── manifest.ots
└── keys/                   ref. al registro de transparencia (directorio público append-only)
```

### El manifiesto (ejemplo)

```json
{
  "vep_version": "0.1",
  "package_id": "b1f7…-uuid",
  "created_at": "2026-03-14T10:22:00Z",
  "assets": [
    {
      "filename": "testimonio_01.mp4",
      "media_type": "video/mp4",
      "size_bytes": 48213004,
      "sha256": "9f2c…",
      "captured_at": "2026-03-12T16:41:00Z",
      "capture_claim": {
        "app": "peaceos-capture",
        "device_key_id": "field-01",
        "location_precision": "redacted"
      }
    }
  ],
  "custody": [
    { "event": "captured", "actor": "field-01", "at": "2026-03-12T16:41:00Z", "sig_ref": "signatures/captured-01.sig" },
    { "event": "imported", "actor": "coord-02", "at": "2026-03-13T09:00:00Z", "sig_ref": "signatures/imported-02.sig" }
  ],
  "redactions": [
    { "field": "witness_identity", "commitment": "sha256(salt||valor)=7d0a…", "status": "withheld" }
  ],
  "timestamps": [
    { "type": "opentimestamps", "target": "manifest_sha256", "proof_ref": "timestamps/manifest.ots" }
  ],
  "signature": { "alg": "ed25519", "key_id": "field-01", "sig_ref": "signatures/manifest.sig" },
  "org": {
    "org_id": "org-recolectora",
    "key_id": "org-2026",
    "transparency_ref": "git:keys@<commit-hash> + timestamps/org-key.ots",
    "countersig_ref": "signatures/org-countersign.sig"
  }
}
```

### Las piezas y para qué sirve cada una

- **`sha256` de cada asset** — la huella digital. Cambia un solo bit del archivo y la huella no cuadra. Detecta cualquier manipulación.
- **`signature` del manifiesto** — la firma seudónima de terreno; prueba que ese dispositivo lo creó y que no se ha tocado desde entonces.
- **`org` (contrafirma)** — el sello de la organización, su raíz de confianza pública anclada en el registro de transparencia. Es en quien se apoya el tercero que verifica, no en el documentador.
- **`timestamps`** — prueba que el manifiesto (y por tanto las huellas de los archivos) existía en una fecha; hace imposible "backdatear".
- **`custody`** — la cadena de custodia: cada paso (capturado, importado, exportado) firmado por su actor. Demuestra el recorrido.
- **`redactions`** — para lo sensible (identidades). En lugar del dato, se guarda un **compromiso**: la huella de `salt + valor`. Así el paquete se verifica igual sin contener la identidad, y si algún día hace falta revelarla ante un juez, se puede demostrar que coincide con lo comprometido. Este es el puente hacia la promesa 1.

## 3. Verify: el validador

*En llano: metes el paquete y te dice, punto por punto, si el sello aguanta.*

Dado un VEP, Verify ejecuta estas comprobaciones y reporta cada una por separado:

1. **Integridad** — recalcula el SHA-256 de cada archivo presente y lo compara con el manifiesto.
2. **Firma del manifiesto** — verifica la firma seudónima de terreno con su clave pública.
3. **Contrafirma organizacional** — verifica el sello de la organización sobre el paquete.
4. **Identidad e inclusión en transparencia** — resuelve la clave organizacional contra el registro público append-only, comprueba su inclusión y da el nivel de confianza; la clave de terreno se mantiene seudónima.
5. **Sello de tiempo** — valida la prueba OpenTimestamps/RFC 3161 sobre la huella del manifiesto.
6. **Cadena de custodia** — verifica la firma y el orden de cada evento.
7. **Redacciones** — confirma qué campos se han retirado y que su compromiso está presente.

Salida: un **veredicto claro** ("auténtico y sin alterar" / "problemas detectados"), un informe legible para humanos y un resultado en JSON para máquinas.

Tres formas de usarlo, la misma lógica debajo:
- **CLI** (línea de comandos) — para técnicos y automatización.
- **Portal web** — arrastras el paquete y ves el informe. Para investigadores y periodistas.
- **Librería** — para integrarlo en otras herramientas.

```
peaceos-verify create --in ./evidencia/ --key field-01.key --org org-2026.key --out caso-x.vep
peaceos-verify check caso-x.vep
# → Integridad: OK · Firma terreno: OK (field-01, seudónima)
#   Contrafirma org: OK (org-recolectora, en transparencia)
#   Sello de tiempo: OK (2026-03-12) · Custodia: OK (2 eventos)
#   Redacciones: witness_identity (retirada) · Veredicto: AUTÉNTICO
```

## 4. Modelo de confianza y límites honestos

*En llano: Verify prueba que la evidencia no se ha tocado; no prueba que lo que se ve sea verdad.*

Esto hay que decirlo con toda claridad, porque exagerar aquí destruiría la credibilidad y sería peligroso ante un tribunal:

- Verify **sí prueba**: que un archivo no se ha alterado desde su captura, que existía en una fecha, y quién lo firmó (con la fuerza que tenga el vínculo clave↔identidad).
- Verify **no prueba**: que el hecho grabado ocurriera como se afirma. Procedencia no es veracidad. Es evidencia a prueba de manipulación, no un juicio sobre los hechos.
- La fuerza de "quién lo firmó" descansa en la **organización**, no en el documentador: se prueba que una organización con identidad verificable en el registro de transparencia respalda el paquete, mientras la persona de terreno permanece seudónima y protegida (sección 6).

Aun con esos límites, en la era de las falsificaciones esto es enorme: convierte "confía en mí" en "compruébalo tú".

## 5. Sobre qué construimos (no reinventar)

*En llano: usamos piezas que ya existen y están probadas, no fabricamos criptografía casera.*

- **Huellas:** SHA-256.
- **Firmas:** Ed25519 (vía libsodium). Simple, rápido, estándar.
- **Sello de tiempo:** OpenTimestamps (gratuito, anclado y sin necesidad de confiar en nadie) + opcionalmente una autoridad RFC 3161 para inmediatez.
- **Procedencia y captura:** alineados con el estándar **C2PA** de procedencia de contenido y con **ProofMode** (captura verificable en móvil, orientada a derechos humanos).
- **Conjuntos y redacción:** árbol de Merkle para poder probar que un elemento pertenece al conjunto y redactar otros sin romper la verificación.

Reconocer estas bases en público, cuando se publique, es parte de ganarse el respeto del sector.

## 6. Modelo de identidad y confianza (decidido)

*En llano: la persona del terreno queda protegida y en el anonimato; la organización pone su nombre y su reputación, de forma pública y auditable.*

El reto: necesitamos una identidad sólida para que un tribunal confíe, pero atar la firma a la identidad real de quien documenta sobre el terreno lo pondría en peligro (rompería la promesa 1). La solución son **dos niveles**:

**Nivel 1 — Claves de terreno, seudónimas.** Cada dispositivo o documentador genera su propia clave Ed25519. La confianza no viene de "quién eres", sino de la **continuidad** (la misma clave produjo estas capturas de forma consistente) y de que la organización la **atesta**. Nunca se vincula a una identidad real pública. Esto protege a la persona.

**Nivel 2 — Clave organizacional, la raíz de confianza (pública y fuerte).** Al exportar un paquete, la organización lo **contrafirma** con su clave organizacional, poniendo su reputación detrás. Esa clave pública se ancla en un **registro de transparencia**: un directorio *append-only*, público y auditable por cualquiera. El tercero que verifica no confía en el nombre del documentador —que no conoce—, sino en la identidad verificable de la organización más el anclaje temporal.

**Qué construimos en v0.1 (y por qué es lo serio):** no montamos infraestructura pesada el día uno, pero adoptamos la lógica de transparencia desde el principio. La clave organizacional vive en un **directorio público, firmado y append-only** —un repositorio git público *es* un registro append-only con historial completo—, y cada actualización se ancla con OpenTimestamps. Es un registro de transparencia simple y honesto, **migrable** a uno formal (Sigstore/Rekor) cuando escaléis. Elegimos esto, y no un simple "directorio de claves en el que confiar", porque **el modelo de confianza tiene que encarnar la tesis del producto**: PeaceOS existe para que no tengas que fiarte de nadie. La transparencia pública auditable *es* la seriedad que buscamos.

**Implicación para el formato:** el manifiesto incorpora una **contrafirma organizacional** y una referencia al registro de transparencia; las claves de terreno van atestadas por la organización sin revelar identidades.

### Otras decisiones de diseño (cerradas)

- **C2PA ahora o después.** Manifiesto compatible en espíritu con C2PA, pero JSON simple en v0.1 para ir rápido, con ruta de migración clara.
- **Ancla temporal.** OpenTimestamps como ancla principal (sin confianza); RFC 3161 opcional para inmediatez.
- **Dónde corre Verify.** Portal alojado *y* verificador local/offline, destacando el local, porque es el que sostiene el relato de confianza.

## 7. Alcance del MVP (v0.1)

**Dentro:**
- Esquema del manifiesto v0.1.
- CLI `create` y `check` (integridad + firma + sello de tiempo).
- Cadena de custodia y compromisos de redacción.
- Portal web de validación (arrastrar y soltar).
- Documentación, repositorio de código abierto y licencia.
- Un piloto con una organización real.

**Fuera (a propósito, para fases siguientes):**
- La app móvil Capture.
- El Núcleo / gestión de casos.
- Interoperabilidad C2PA completa.
- Registro de transparencia formal (Sigstore/Rekor). En v0.1 basta el directorio público append-only en git + OpenTimestamps.
- Cualquier capa de IA.

## 8. Hitos de construcción

- **M0 — Especificación.** Fijar primitivas (Ed25519, SHA-256, OpenTimestamps, JSON) y cerrar el esquema del manifiesto v0.1.
- **M1 — Núcleo de Verify.** CLI `create` + `check` con integridad, firma y sello de tiempo.
- **M2 — Custodia y redacción.** Eventos de custodia firmados y compromisos de redacción.
- **M3 — Portal web.** Validador de arrastrar y soltar, con informe legible.
- **M4 — Publicación y piloto.** Documentar, publicar en abierto y probar con una organización real.

## 9. Definición de "hecho"

El MVP está terminado cuando **una persona ajena puede coger un paquete PeaceOS, pasarlo por Verify y confirmar por su cuenta que la evidencia es auténtica y no ha sido manipulada** — sin fiarse de la palabra de Blue Human. Con el código en abierto, documentado, y validado al menos una vez con una organización real y una evidencia real.

## 10. Riesgos y siguiente decisión

- **Riesgo principal (ya decidido):** el modelo de identidad. Resuelto con el modelo de dos niveles de la sección 6 (terreno seudónimo + organización pública y auditable). Queda implementarlo bien.
- **Riesgo de alcance:** la tentación de añadir Capture o Núcleo antes de tiempo. Disciplina: v0.1 es solo Verify + VEP.
- **Cuestión legal:** la admisibilidad ante cada foro la valida un jurista; este documento cubre la solidez técnica, no la garantía jurídica.

**Con la sección 6 ya cerrada**, la vía está despejada para empezar por M0-M1: fijar el esquema del manifiesto (ya con la contrafirma organizacional) y sacar el CLI mínimo de verificación.