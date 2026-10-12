const btnInvestigar = document.getElementById("btnInvestigar");
const btnDetener = document.getElementById("btnDetener");
const btnExportarPdf = document.getElementById("btnExportarPdf");
const btnCopiarMarkdown = document.getElementById("btnCopiarMarkdown");
const btnLimpiarHistorial = document.getElementById("btnLimpiarHistorial");
const pregunta = document.getElementById("pregunta");
const profundidad = document.getElementById("profundidad");

const actividad = document.getElementById("actividad");
const estadoActual = document.getElementById("estadoActual");
const previewContent = document.getElementById("previewContent");

const historial = document.getElementById("historial");
const listaHistorial = document.getElementById("listaHistorial");

const fuentesEnVivo = document.getElementById("fuentesEnVivo");
const fuentesFinales = document.getElementById("fuentesFinales");
const contadorFuentes = document.getElementById("contadorFuentes");
const contadorFuentesFinal = document.getElementById("contadorFuentesFinal");

const resultado = document.getElementById("resultado");
const reporte = document.getElementById("reporte");
const error = document.getElementById("error");

const HISTORIAL_KEY = "agenteInvestigador.historial";
const MAX_HISTORIAL = 6;

let fuentesConsultadas = [];
let reporteCompleto = "";
let preguntaActual = "";
let controladorActivo = null;
let investigacionActiva = false;
let investigacionCancelada = false;


btnInvestigar.addEventListener("click", investigar);
btnDetener.addEventListener("click", detenerInvestigacion);
btnExportarPdf.addEventListener("click", exportarPdf);
btnCopiarMarkdown.addEventListener("click", copiarMarkdown);
btnLimpiarHistorial.addEventListener("click", limpiarHistorial);

document.addEventListener("DOMContentLoaded", renderizarHistorial);


async function investigar() {
    if (investigacionActiva) {
        return;
    }

    const textoPregunta = pregunta.value.trim();

    if (!textoPregunta) {
        mostrarError("Escribe una pregunta de investigación.");
        return;
    }

    preguntaActual = textoPregunta;
    prepararInterfaz();

    controladorActivo = new AbortController();

    try {
        const respuesta = await fetch(
            "/api/investigar",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    pregunta: textoPregunta,
                    profundidad: profundidad.value
                }),
                signal: controladorActivo.signal
            }
        );

        if (!respuesta.body) {
            throw new Error("El navegador no pudo abrir el flujo de datos.");
        }

        if (!respuesta.ok) {
            await procesarStream(respuesta);
            return;
        }

        await procesarStream(respuesta);

    } catch (err) {
        if (err.name === "AbortError" || investigacionCancelada) {
            mostrarCancelacion();
        } else if (!navigator.onLine) {
            mostrarError("No hay conexión a Internet. Revisa tu red e inténtalo de nuevo.");
        } else {
            mostrarError(`No se pudo conectar con el servidor: ${err.message}`);
        }
    } finally {
        terminarEstadoActivo();
    }
}


function detenerInvestigacion() {
    if (!controladorActivo) {
        return;
    }

    investigacionCancelada = true;
    controladorActivo.abort();
    mostrarCancelacion();
    terminarEstadoActivo();
}


async function procesarStream(respuesta) {
    const reader = respuesta.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let buffer = "";

    while (true) {
        const { value, done } = await reader.read();

        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });

        const bloques = buffer.split("\n\n");
        buffer = bloques.pop();

        for (const bloque of bloques) {
            if (!bloque.trim()) {
                continue;
            }

            procesarEventoSSE(bloque, respuesta.status);
        }
    }

    if (buffer.trim()) {
        procesarEventoSSE(buffer, respuesta.status);
    }
}


function procesarEventoSSE(bloque, estadoHttp) {
    const lineas = bloque.split("\n");

    let tipo = "message";
    let data = "";

    lineas.forEach(linea => {
        if (linea.startsWith("event:")) {
            tipo = linea.substring(6).trim();
        }

        if (linea.startsWith("data:")) {
            data += linea.substring(5).trim();
        }
    });

    if (!data) {
        return;
    }

    let contenido;

    try {
        contenido = JSON.parse(data);
    } catch {
        mostrarError("El servidor envió una respuesta que no se pudo interpretar.");
        return;
    }

    if (tipo === "estado") {
        actualizarEstado(contenido.etapa, contenido.mensaje);
    }

    if (tipo === "fuente") {
        agregarFuente(contenido);
    }

    if (tipo === "texto") {
        reporteCompleto += contenido.delta;
        actualizarPreview(reporteCompleto);
    }

    if (tipo === "completado") {
        reporteCompleto = contenido.reporte || reporteCompleto;

        actualizarEstado(
            "finalizando",
            contenido.mensaje || "Investigación completada."
        );

        finalizarFlujo();
    }

    if (tipo === "error") {
        mostrarError(formatearError(contenido, estadoHttp));
    }
}


function formatearError(contenido, estadoHttp) {
    const mensaje = contenido.detalle
        ? `${contenido.mensaje} ${contenido.detalle}`
        : contenido.mensaje;

    if (contenido.tipo === "especializacion") {
        return mensaje;
    }

    if (estadoHttp === 400) {
        return mensaje || "La solicitud no es válida. Revisa la pregunta enviada.";
    }

    if (estadoHttp === 401 || estadoHttp === 403) {
        return "No se pudo autenticar la solicitud. Revisa la configuración de la API key.";
    }

    if (estadoHttp === 429) {
        return "Se alcanzó un límite de uso o demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo.";
    }

    if (estadoHttp >= 500) {
        return mensaje || "El servidor tuvo un problema interno al procesar la investigación.";
    }

    return mensaje || "Ocurrió un error durante la investigación.";
}


function prepararInterfaz() {
    fuentesConsultadas = [];
    reporteCompleto = "";
    investigacionActiva = true;
    investigacionCancelada = false;

    error.classList.add("d-none");
    resultado.classList.add("d-none");
    actividad.classList.remove("d-none");

    fuentesEnVivo.innerHTML = `
        <div id="sinFuentes" class="empty-sources">
            Las fuentes aparecerán aquí conforme el agente vaya consultándolas.
        </div>
    `;

    fuentesFinales.innerHTML = "";
    reporte.innerHTML = "";

    contadorFuentes.textContent = "0";
    contadorFuentesFinal.textContent = "0";

    previewContent.textContent =
        "El borrador aparecerá aquí mientras el agente redacta.";

    actualizarEstado(
        "analizando",
        "Analizando la pregunta de investigación..."
    );

    btnInvestigar.disabled = true;
    pregunta.disabled = true;
    profundidad.disabled = true;
    btnDetener.classList.remove("d-none");
}


function terminarEstadoActivo() {
    investigacionActiva = false;
    controladorActivo = null;
    btnInvestigar.disabled = false;
    pregunta.disabled = false;
    profundidad.disabled = false;
    btnDetener.classList.add("d-none");
}


function actualizarEstado(etapa, mensaje) {
    estadoActual.textContent = mensaje;

    const pasos = Array.from(
        document.querySelectorAll(".process-step")
    );

    const orden = [
        "analizando",
        "busqueda",
        "revision",
        "finalizando"
    ];

    const indiceActual = orden.indexOf(etapa);

    pasos.forEach(paso => {
        const indicePaso = orden.indexOf(
            paso.dataset.etapa
        );

        paso.classList.remove("active", "complete");

        if (indicePaso < indiceActual) {
            paso.classList.add("complete");
        }

        if (indicePaso === indiceActual) {
            paso.classList.add("active");
        }
    });
}


function actualizarPreview(texto) {
    const preview = limpiarMarkdownBasico(texto).trim();

    if (!preview) {
        return;
    }

    const resumen = preview.length > 1800
        ? `${preview.slice(0, 1800)}...`
        : preview;

    previewContent.textContent = resumen;
    previewContent.scrollTop = previewContent.scrollHeight;
}


function agregarFuente(fuente) {
    if (!fuente.url) {
        return;
    }

    const existe = fuentesConsultadas.some(
        item => item.url === fuente.url
    );

    if (existe) {
        return;
    }

    fuentesConsultadas.push(fuente);

    const placeholder = document.getElementById("sinFuentes");

    if (placeholder) {
        placeholder.remove();
    }

    const dominio = obtenerDominio(fuente.url);
    const calidad = clasificarFuente(fuente);
    const titulo = fuente.titulo && fuente.titulo !== fuente.url
        ? fuente.titulo
        : dominio;

    const elemento = document.createElement("article");
    elemento.className = "live-source-card";

    elemento.innerHTML = `
        <div class="source-icon">
            <i class="bi bi-link-45deg"></i>
        </div>

        <div>
            <a
                class="source-title"
                href="${escaparAtributo(fuente.url)}"
                target="_blank"
                rel="noopener noreferrer"
            >
                ${escaparHTML(titulo)}
            </a>

            <div class="source-domain">
                ${escaparHTML(dominio)}
            </div>

            <div class="source-quality">
                ${escaparHTML(calidad)}
            </div>
        </div>
    `;

    fuentesEnVivo.appendChild(elemento);
    fuentesEnVivo.scrollTop = fuentesEnVivo.scrollHeight;
    actualizarContadores();
}


function actualizarContadores() {
    const total = fuentesConsultadas.length;
    contadorFuentes.textContent = String(total);
    contadorFuentesFinal.textContent = String(total);
}


function finalizarFlujo() {
    const pasos = document.querySelectorAll(".process-step");

    pasos.forEach(paso => {
        paso.classList.remove("active");
        paso.classList.add("complete");
    });

    estadoActual.innerHTML = `
        <i class="bi bi-check-circle-fill text-success me-2"></i>
        Investigación completada.
    `;

    renderizarReporteFinal(reporteCompleto);
    renderizarFuentesFinales();
    guardarEnHistorial();

    resultado.classList.remove("d-none");
    resultado.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}


function mostrarCancelacion() {
    estadoActual.textContent = "La investigación fue detenida por el usuario.";

    document.querySelectorAll(".process-step").forEach(paso => {
        paso.classList.remove("active");
    });
}


function renderizarReporteFinal(markdown) {
    const parsed = parseStructuredMarkdown(markdown);

    let html = `
        <section class="report-hero">
            <div class="eyebrow text-white-50 mb-2">
                REPORTE FINAL
            </div>
            <div class="report-title">
                ${escaparHTML(parsed.title || "Reporte de investigación")}
            </div>
            <div class="report-lead">
                ${escaparHTML(extraerResumen(parsed.sections["1. Pregunta de investigación"] || ""))}
            </div>
        </section>
    `;

    const preguntaBody = parsed.sections["1. Pregunta de investigación"] || "";
    html += `
        <section class="report-grid-1">
            ${renderCard("bi-question-circle", "Pregunta de investigación", markdownToBasicHtml(preguntaBody))}
        </section>
    `;

    const planBody = parsed.sections["2. Plan de investigación"] || "";
    html += `
        <section class="report-grid-1">
            ${renderPlanCard(planBody)}
        </section>
    `;

    const hallazgosBody = parsed.sections["3. Hallazgos principales"] || "";
    html += `
        <section class="report-grid-1">
            ${renderFindingsCard(hallazgosBody)}
        </section>
    `;

    const comparacionBody = parsed.sections["4. Comparación de información"] || "";
    html += `
        <section class="report-grid-1">
            ${renderComparisonCard(comparacionBody)}
        </section>
    `;

    const coincidenciasBody = parsed.sections["5. Coincidencias y diferencias entre fuentes"] || "";
    const tendenciasBody = parsed.sections["6. Tendencias identificadas"] || "";
    html += `
        <section class="report-grid-2">
            ${renderCoincidenciasCard(coincidenciasBody)}
            ${renderTrendsCard(tendenciasBody)}
        </section>
    `;

    const conclusionesBody = parsed.sections["7. Conclusiones"] || "";
    html += `
        <section class="report-grid-1">
            ${renderCard("bi-patch-check", "Conclusiones", markdownToBasicHtml(conclusionesBody))}
        </section>
    `;

    reporte.innerHTML = html;
}


function renderCard(icono, titulo, bodyHtml) {
    return `
        <article class="report-card">
            <div class="report-card-header">
                <div class="report-card-icon">
                    <i class="bi ${icono}"></i>
                </div>

                <h3>${escaparHTML(titulo)}</h3>
            </div>

            <div class="report-card-body">
                ${bodyHtml || '<p class="mb-0 text-secondary">Sin contenido.</p>'}
            </div>
        </article>
    `;
}


function renderPlanCard(body) {
    const bullets = extractBullets(body);

    let contenido = "";

    if (bullets.length) {
        contenido = `
            <div class="plan-grid">
                ${bullets.map((item, index) => `
                    <div class="plan-step">
                        <div class="plan-number">${index + 1}</div>
                        <p>${escaparHTML(item)}</p>
                    </div>
                `).join("")}
            </div>
        `;
    } else {
        contenido = markdownToBasicHtml(body);
    }

    return renderCard(
        "bi-diagram-3",
        "Plan de investigación",
        contenido
    );
}


function renderFindingsCard(body) {
    const hallazgos = parseHallazgos(body);

    let contenido = "";

    if (hallazgos.length) {
        contenido = `
            <div class="findings-showcase">
                ${hallazgos.map((hallazgo, index) => {
                    const url = normalizarUrl(hallazgo.url);
                    const dominio = url ? obtenerDominio(url) : "";
                    const nombreFuente =
                        hallazgo.fuente ||
                        dominio ||
                        "Fuente consultada";

                    return `
                        <article class="finding-item">

                            <div class="finding-index">
                                ${String(index + 1).padStart(2, "0")}
                            </div>

                            <div class="finding-main">

                                <div class="finding-top">

                                    <div class="finding-heading">
                                        <span class="finding-eyebrow">
                                            HALLAZGO
                                        </span>

                                        <h4 class="finding-name">
                                            ${escaparHTML(hallazgo.nombre || `Hallazgo ${index + 1}`)}
                                        </h4>
                                    </div>

                                    <div class="finding-status">
                                        <i class="bi bi-check2-circle"></i>
                                        Evidencia encontrada
                                    </div>

                                </div>

                                <div class="finding-description-box">
                                    <div class="finding-section-label">
                                        <i class="bi bi-card-text me-2"></i>
                                        Descripción
                                    </div>

                                    <p class="finding-description-text">
                                        ${escaparHTML(hallazgo.descripcion || "Sin descripción disponible.")}
                                    </p>
                                </div>

                                <div class="finding-source-panel">

                                    <div class="finding-source-icon">
                                        <i class="bi bi-globe2"></i>
                                    </div>

                                    <div class="finding-source-info">
                                        <div class="finding-section-label">
                                            Fuente consultada
                                        </div>

                                        <div class="finding-source-name">
                                            ${escaparHTML(nombreFuente)}
                                        </div>

                                        ${dominio ? `
                                            <div class="finding-source-domain">
                                                ${escaparHTML(dominio)}
                                            </div>
                                        ` : ""}
                                    </div>

                                    ${url ? `
                                        <a
                                            class="finding-source-button"
                                            href="${escaparAtributo(url)}"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            Abrir fuente
                                            <i class="bi bi-box-arrow-up-right ms-2"></i>
                                        </a>
                                    ` : `
                                        <span class="finding-source-button disabled">
                                            URL no disponible
                                        </span>
                                    `}

                                </div>

                            </div>

                        </article>
                    `;
                }).join("")}
            </div>
        `;
    } else {
        contenido = `
            <div class="finding-fallback">
                ${markdownToBasicHtml(body)}
            </div>
        `;
    }

    return renderCard(
        "bi-stars",
        "Hallazgos principales",
        contenido
    );
}


function renderComparisonCard(body) {
    const table = parseMarkdownTable(body);

    let contenido = "";

    if (table && table.headers.length && table.rows.length) {
        contenido = `
            <div class="compare-table-wrap">
                <table class="compare-table">
                    <thead>
                        <tr>
                            ${table.headers.map(h => `<th>${escaparHTML(h)}</th>`).join("")}
                        </tr>
                    </thead>

                    <tbody>
                        ${table.rows.map(row => `
                            <tr>
                                ${row.map(cell => `<td>${escaparHTML(cell)}</td>`).join("")}
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;
    } else {
        contenido = markdownToBasicHtml(body);
    }

    return renderCard(
        "bi-table",
        "Comparación de información",
        contenido
    );
}


function renderCoincidenciasCard(body) {
    const bloques = parseSubsections(body);
    const coincidencias = extractBullets(
        bloques["Coincidencias"] || ""
    );
    const diferencias = extractBullets(
        bloques["Diferencias"] || ""
    );

    const contenido = `
        <div class="dual-lists">
            <div class="list-panel">
                <h4>
                    <i class="bi bi-check2-circle me-2 text-success"></i>
                    Coincidencias
                </h4>

                ${coincidencias.length
                    ? `<ul>${coincidencias.map(item => `<li>${escaparHTML(item)}</li>`).join("")}</ul>`
                    : "<p class='mb-0 text-secondary'>Sin datos disponibles.</p>"
                }
            </div>

            <div class="list-panel differences">
                <h4>
                    <i class="bi bi-arrow-left-right me-2 text-primary"></i>
                    Diferencias
                </h4>

                ${diferencias.length
                    ? `<ul>${diferencias.map(item => `<li>${escaparHTML(item)}</li>`).join("")}</ul>`
                    : "<p class='mb-0 text-secondary'>Sin datos disponibles.</p>"
                }
            </div>
        </div>
    `;

    return renderCard(
        "bi-shuffle",
        "Coincidencias y diferencias entre fuentes",
        contenido
    );
}


function renderTrendsCard(body) {
    const bullets = extractBullets(body);

    const contenido = bullets.length
        ? `<ul class="trend-list">${bullets.map(item => `<li>${escaparHTML(item)}</li>`).join("")}</ul>`
        : markdownToBasicHtml(body);

    return renderCard(
        "bi-graph-up-arrow",
        "Tendencias identificadas",
        contenido
    );
}


function renderizarFuentesFinales() {
    fuentesFinales.innerHTML = "";

    if (fuentesConsultadas.length === 0) {
        fuentesFinales.innerHTML = `
            <div class="col-12">
                <div class="alert alert-light mb-0">
                    No se recibieron URLs de fuentes para mostrar.
                </div>
            </div>
        `;
        return;
    }

    fuentesConsultadas.forEach((fuente, indice) => {
        const dominio = obtenerDominio(fuente.url);
        const calidad = clasificarFuente(fuente);
        const titulo = fuente.titulo && fuente.titulo !== fuente.url
            ? fuente.titulo
            : dominio;

        const columna = document.createElement("div");
        columna.className = "col-md-6 col-xl-4";

        columna.innerHTML = `
            <div class="source-ref-card">
                <div class="d-flex align-items-start gap-3">
                    <span class="counter-pill">${indice + 1}</span>

                    <div class="min-w-0">
                        <a
                            class="source-ref-link"
                            href="${escaparAtributo(fuente.url)}"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            ${escaparHTML(titulo)}
                        </a>

                        <div class="source-ref-url">
                            ${escaparHTML(fuente.url)}
                        </div>

                        <div class="source-quality mt-2">
                            ${escaparHTML(calidad)}
                        </div>
                    </div>
                </div>
            </div>
        `;

        fuentesFinales.appendChild(columna);
    });
}


function guardarEnHistorial() {
    if (!reporteCompleto.trim()) {
        return;
    }

    const item = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        pregunta: preguntaActual,
        reporte: reporteCompleto,
        fuentes: fuentesConsultadas,
        fecha: new Date().toISOString()
    };

    const registros = obtenerHistorial()
        .filter(registro => registro.pregunta !== item.pregunta);

    registros.unshift(item);
    localStorage.setItem(
        HISTORIAL_KEY,
        JSON.stringify(registros.slice(0, MAX_HISTORIAL))
    );

    renderizarHistorial();
}


function obtenerHistorial() {
    try {
        return JSON.parse(localStorage.getItem(HISTORIAL_KEY) || "[]");
    } catch {
        return [];
    }
}


function renderizarHistorial() {
    const registros = obtenerHistorial();

    if (!registros.length) {
        historial.classList.add("d-none");
        listaHistorial.innerHTML = "";
        return;
    }

    historial.classList.remove("d-none");
    listaHistorial.innerHTML = "";

    registros.forEach(registro => {
        const elemento = document.createElement("article");
        elemento.className = "history-item";

        elemento.innerHTML = `
            <div class="history-main">
                <div class="history-question">
                    ${escaparHTML(registro.pregunta)}
                </div>
                <div class="history-meta">
                    ${escaparHTML(formatearFecha(registro.fecha))} ·
                    ${registro.fuentes?.length || 0} fuentes
                </div>
            </div>

            <button class="btn btn-sm btn-outline-primary" type="button">
                <i class="bi bi-arrow-clockwise me-1"></i>
                Abrir
            </button>
        `;

        elemento.querySelector("button").addEventListener("click", () => {
            cargarDesdeHistorial(registro);
        });

        listaHistorial.appendChild(elemento);
    });
}


function cargarDesdeHistorial(registro) {
    preguntaActual = registro.pregunta || "";
    pregunta.value = preguntaActual;
    reporteCompleto = registro.reporte || "";
    fuentesConsultadas = registro.fuentes || [];

    error.classList.add("d-none");
    actividad.classList.add("d-none");
    resultado.classList.remove("d-none");

    renderizarReporteFinal(reporteCompleto);
    renderizarFuentesFinales();
    actualizarContadores();

    resultado.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}


function limpiarHistorial() {
    localStorage.removeItem(HISTORIAL_KEY);
    renderizarHistorial();
}


function exportarPdf() {
    if (!reporteCompleto.trim()) {
        mostrarError("No hay un reporte listo para exportar.");
        return;
    }

    window.print();
}


async function copiarMarkdown() {
    if (!reporteCompleto.trim()) {
        mostrarError("No hay un reporte listo para copiar.");
        return;
    }

    try {
        await navigator.clipboard.writeText(reporteCompleto);
        mostrarAvisoTemporal("Reporte Markdown copiado al portapapeles.");
    } catch {
        copiarMarkdownConFallback(reporteCompleto);
        mostrarAvisoTemporal("Reporte Markdown copiado al portapapeles.");
    }
}


function copiarMarkdownConFallback(texto) {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
}


function clasificarFuente(fuente) {
    const url = fuente?.url || "";
    const titulo = fuente?.titulo || "";
    const dominio = obtenerDominio(url).toLowerCase();
    const texto = `${dominio} ${titulo}`.toLowerCase();

    if (/\.(gov|gob)(\.|$)/.test(dominio) || texto.includes("gobierno")) {
        return "Fuente oficial";
    }

    if (
        dominio.endsWith(".edu") ||
        dominio.includes(".edu.") ||
        texto.includes("universidad") ||
        texto.includes("university")
    ) {
        return "Fuente académica";
    }

    if (
        texto.includes("docs.") ||
        texto.includes("developer") ||
        texto.includes("documentation") ||
        texto.includes("documentacion") ||
        texto.includes("nist") ||
        texto.includes("iso")
    ) {
        return "Documentación técnica";
    }

    if (
        texto.includes("ieee") ||
        texto.includes("acm") ||
        texto.includes("arxiv") ||
        texto.includes("research") ||
        texto.includes("journal")
    ) {
        return "Investigación especializada";
    }

    if (
        texto.includes("microsoft") ||
        texto.includes("google") ||
        texto.includes("amazon") ||
        texto.includes("ibm") ||
        texto.includes("cisco") ||
        texto.includes("oracle") ||
        texto.includes("openai")
    ) {
        return "Fuente empresarial";
    }

    if (
        texto.includes("wired") ||
        texto.includes("zdnet") ||
        texto.includes("techcrunch") ||
        texto.includes("mit technology review")
    ) {
        return "Medio especializado";
    }

    return "Fuente web";
}


function mostrarAvisoTemporal(mensaje) {
    error.textContent = mensaje;
    error.classList.remove("d-none", "alert-danger");
    error.classList.add("alert-success");

    window.setTimeout(() => {
        error.classList.add("d-none");
        error.classList.remove("alert-success");
        error.classList.add("alert-danger");
    }, 2600);
}


function parseStructuredMarkdown(markdown) {
    const text = markdown.replace(/\r/g, "").trim();
    const lines = text.split("\n");

    let title = "Reporte de investigación";
    const sections = {};

    let currentSection = null;

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();

        if (!line.trim()) {
            if (currentSection) {
                sections[currentSection] += "\n";
            }
            continue;
        }

        const titleMatch = line.match(/^#\s+(.*)$/);
        if (titleMatch) {
            title = titleMatch[1].trim();
            continue;
        }

        const sectionMatch = line.match(/^##\s+(.*)$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1].trim();
            sections[currentSection] = "";
            continue;
        }

        if (currentSection) {
            sections[currentSection] += (sections[currentSection] ? "\n" : "") + line;
        }
    }

    return { title, sections };
}


function parseHallazgos(text) {
    const hallazgos = [];

    const bloques = text
        .split(/(?=^###\s+Hallazgo\s+\d+)/gmi)
        .map(bloque => bloque.trim())
        .filter(Boolean);

    for (const bloque of bloques) {
        const encabezadoMatch = bloque.match(
            /^###\s+Hallazgo\s+\d+(?:\s*:\s*(.+))?\s*$/mi
        );

        if (!encabezadoMatch) {
            continue;
        }

        const nombreDesdeEncabezado = (encabezadoMatch[1] || "").trim();

        const nombre =
            extraerCampoHallazgo(bloque, "Nombre", ["Descripción", "Fuente", "URL"]) ||
            nombreDesdeEncabezado ||
            "Hallazgo";

        const descripcion =
            extraerCampoHallazgo(
                bloque,
                "Descripción",
                ["Fuente", "URL"]
            );

        let fuente =
            extraerCampoHallazgo(
                bloque,
                "Fuente",
                ["URL"]
            );

        let url =
            extraerCampoHallazgo(
                bloque,
                "URL"
            );

        const enlaceFuente = extraerEnlaceMarkdown(fuente);

        if (enlaceFuente.url && !url) {
            url = enlaceFuente.url;
        }

        if (enlaceFuente.markdown) {
            fuente = limpiarTextoFuente(
                fuente.replace(enlaceFuente.markdown, "")
            );
        } else {
            fuente = limpiarTextoFuente(fuente);
        }

        if (!url) {
            const urlMatch = bloque.match(
                /https?:\/\/[^\s)\]]+/i
            );

            if (urlMatch) {
                url = urlMatch[0];
            }
        }

        url = normalizarUrl(url);

        hallazgos.push({
            nombre: limpiarMarkdownTexto(nombre),
            descripcion: limpiarMarkdownTexto(descripcion),
            fuente: limpiarMarkdownTexto(fuente),
            url
        });
    }

    return hallazgos;
}


function extraerCampoHallazgo(bloque, campo, siguientes = []) {
    const inicio = new RegExp(
        `\\*\\*${escaparRegex(campo)}:\\*\\*\\s*`,
        "i"
    );

    const matchInicio = bloque.match(inicio);

    if (!matchInicio) {
        return "";
    }

    const start = matchInicio.index + matchInicio[0].length;
    let end = bloque.length;

    for (const siguiente of siguientes) {
        const resto = bloque.slice(start);

        const matchSiguiente = resto.match(
            new RegExp(
                `\\n\\s*\\*\\*${escaparRegex(siguiente)}:\\*\\*`,
                "i"
            )
        );

        if (matchSiguiente && start + matchSiguiente.index < end) {
            end = start + matchSiguiente.index;
        }
    }

    return bloque.slice(start, end).trim();
}


function escaparRegex(texto) {
    return String(texto).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
    );
}


function extraerEnlaceMarkdown(texto) {
    if (!texto) {
        return {
            markdown: "",
            texto: "",
            url: ""
        };
    }

    const match = texto.match(
        /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/
    );

    if (!match) {
        return {
            markdown: "",
            texto: "",
            url: ""
        };
    }

    return {
        markdown: match[0],
        texto: match[1].trim(),
        url: match[2].trim()
    };
}


function limpiarTextoFuente(texto) {
    return String(texto || "")
        .replace(/\(\s*\)/g, "")
        .replace(/\s{2,}/g, " ")
        .replace(/^[;,:.\s]+|[;,:.\s]+$/g, "")
        .trim();
}


function limpiarMarkdownTexto(texto) {
    return String(texto || "")
        .replace(/\*\*/g, "")
        .replace(/^[-*•]\s+/gm, "")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
}


function normalizarUrl(valor) {
    if (!valor) {
        return "";
    }

    let texto = String(valor).trim();

    const markdown = texto.match(
        /\[[^\]]*\]\((https?:\/\/[^)]+)\)/
    );

    if (markdown) {
        texto = markdown[1];
    }

    const directa = texto.match(
        /https?:\/\/[^\s)\]]+/i
    );

    if (!directa) {
        return "";
    }

    return directa[0]
        .replace(/[.,;]+$/, "")
        .trim();
}


function parseMarkdownTable(text) {
    const lines = text
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.startsWith("|"));

    if (lines.length < 3) {
        return null;
    }

    const headers = splitTableRow(lines[0]);
    const separator = splitTableRow(lines[1]);

    if (!headers.length || !separator.length) {
        return null;
    }

    const rows = lines.slice(2)
        .map(splitTableRow)
        .filter(row => row.length);

    return { headers, rows };
}


function splitTableRow(row) {
    return row
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map(cell => cell.trim())
        .filter(cell => cell.length > 0);
}


function parseSubsections(text) {
    const result = {};
    const regex = /^###\s+(.*)$/gm;

    let matches = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
        matches.push({
            title: match[1].trim(),
            index: match.index,
            end: regex.lastIndex
        });
    }

    if (!matches.length) {
        return result;
    }

    matches.forEach((item, index) => {
        const start = item.end;
        const end = index + 1 < matches.length
            ? matches[index + 1].index
            : text.length;

        result[item.title] = text.slice(start, end).trim();
    });

    return result;
}


function extractBullets(text) {
    return text
        .split("\n")
        .map(line => line.trim())
        .filter(line => /^[-*•]\s+/.test(line))
        .map(line => line.replace(/^[-*•]\s+/, "").trim());
}


function markdownToBasicHtml(text) {
    if (!text || !text.trim()) {
        return '<p class="mb-0 text-secondary">Sin contenido.</p>';
    }

    const lines = text.split("\n");
    let html = "";
    let inList = false;

    for (let raw of lines) {
        const line = raw.trim();

        if (!line) {
            if (inList) {
                html += "</ul>";
                inList = false;
            }
            continue;
        }

        if (/^[-*•]\s+/.test(line)) {
            if (!inList) {
                html += "<ul>";
                inList = true;
            }

            html += `<li>${formatInlineMarkdown(line.replace(/^[-*•]\s+/, ""))}</li>`;
        } else {
            if (inList) {
                html += "</ul>";
                inList = false;
            }

            html += `<p>${formatInlineMarkdown(line)}</p>`;
        }
    }

    if (inList) {
        html += "</ul>";
    }

    return html;
}


function formatInlineMarkdown(text) {
    return escaparHTML(text)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}


function limpiarMarkdownBasico(text) {
    return text
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/\*\*/g, "")
        .replace(/\|/g, " | ");
}


function extraerResumen(texto) {
    const clean = limpiarMarkdownBasico(texto).replace(/\s+/g, " ").trim();

    if (!clean) {
        return "Resumen generado a partir de las fuentes consultadas.";
    }

    return clean.length > 240
        ? `${clean.slice(0, 240)}...`
        : clean;
}


function obtenerDominio(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}


function mostrarError(mensaje) {
    error.classList.remove("alert-success");
    error.classList.add("alert-danger");
    error.textContent = mensaje || "Ocurrió un error.";
    error.classList.remove("d-none");

    if (!actividad.classList.contains("d-none")) {
        estadoActual.textContent = "La investigación se interrumpió.";
    }
}


function formatearFecha(fechaIso) {
    try {
        return new Intl.DateTimeFormat("es-MX", {
            dateStyle: "medium",
            timeStyle: "short"
        }).format(new Date(fechaIso));
    } catch {
        return "Fecha no disponible";
    }
}


function escaparHTML(texto) {
    const div = document.createElement("div");
    div.textContent = texto ?? "";
    return div.innerHTML;
}


function escaparAtributo(texto) {
    return String(texto ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
